# focus-window.ps1 - bring the DSH (Electron) main window to the foreground on Windows.
#
# Contract:
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File focus-window.ps1 -ProcessId 12345
#   * -ProcessId <int>: pid of the window owner (the Electron browser process).
#   * -ProcessId 0 or omitted: auto-detect the Electron shell process by process name
#     or window title containing "DeepSeek".
#   * stdout: optional "DETAIL: ..." lines for troubleshooting, the LAST line is
#     exactly "FOCUSED=1" or "FOCUSED=0".
#   * always exits 0 (no window found / internal error also prints FOCUSED=0 and exits 0).
#
# Window selection: pid match, IsWindowVisible, GW_OWNER == 0, no WS_EX_TOOLWINDOW.
# Candidates are ranked: process-name match, then class Chrome_WidgetWin_1, then
# the largest window area (GetWindowRect). Never just the first enumer matched.
#
# Raise order (adaptive):
#   1. already foreground -> done (no flicker for the common case)
#   2. IsIconic -> ShowWindow(SW_RESTORE), then Alt tap + SetForegroundWindow
#   3. Alt tap + SetForegroundWindow
#   4. HWND_TOPMOST pulse without activation: Windows ignores a plain HWND_TOP
#      raise for another process's window, but honours a topmost change; dropping
#      back to HWND_NOTOPMOST leaves the window at the top of the normal band, so
#      a refused foreground lock still leaves it visible instead of buried
#   5. final Alt tap + SetForegroundWindow
# The Alt tap (keybd_event VK_MENU down/up) gives the calling thread foreground
# permission so SetForegroundWindow is not refused by the foreground lock rule.
# Never minimize: a non-activated SW_RESTORE only shows the window, and Windows
# puts it back at its remembered z-order position - the bottom when it was
# buried - so a minimize/restore "retry" sinks the window instead of raising it
# (issue #42).
#
# ASCII only, UTF-8 without BOM (Windows PowerShell 5.1 safe).

param(
    [int]$ProcessId = 0
)

$ErrorActionPreference = 'Continue'
$script:Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$script:Status = 'FOCUSED=0'

# Write one line to stdout. [Console]::Out is used so that nothing from the
# PowerShell formatting pipeline can leak into the parsed output.
function Out-Line([string]$Text) {
    try { [Console]::Out.WriteLine($Text) } catch { Write-Output $Text }
}

# Keep all output pure ASCII so the caller can decode it with any code page.
function To-Ascii([string]$Text) {
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    return [regex]::Replace($Text, '[^\x20-\x7E]', '?')
}

function Short-Text([string]$Text, [int]$Max) {
    $s = To-Ascii $Text
    if ($s.Length -gt $Max) { return $s.Substring(0, $Max) + '...' }
    return $s
}

try {
    # ------------------------------------------------------------------ native
    if (-not ('FocusNative' -as [type])) {
        $cs = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class FocusNative
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public const uint GW_OWNER = 4;
    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int SW_RESTORE = 9;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    public const byte VK_MENU = 0x12;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const string TARGET_CLASS = "Chrome_WidgetWin_1";

    public class WinInfo
    {
        public IntPtr Hwnd;
        public int Pid;
        public bool Visible;
        public bool HasOwner;
        public bool Iconic;
        public string ClassName;
        public string Title;
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
        public long Area;
        public int ExStyle;
        public bool ToolWindow;
    }

    public static string ClassOf(IntPtr hWnd)
    {
        StringBuilder sb = new StringBuilder(256);
        GetClassName(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    public static string TitleOf(IntPtr hWnd)
    {
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    public static long AreaOf(IntPtr hWnd)
    {
        RECT r;
        if (!GetWindowRect(hWnd, out r)) { return -1; }
        long w = (long)r.Right - (long)r.Left;
        long h = (long)r.Bottom - (long)r.Top;
        if (w < 0) { w = -w; }
        if (h < 0) { h = -h; }
        return w * h;
    }

    public static List<WinInfo> ListTopWindows()
    {
        List<WinInfo> list = new List<WinInfo>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            WinInfo wi = new WinInfo();
            wi.Hwnd = hWnd;
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            wi.Pid = (int)pid;
            wi.Visible = IsWindowVisible(hWnd);
            wi.HasOwner = GetWindow(hWnd, GW_OWNER) != IntPtr.Zero;
            wi.Iconic = IsIconic(hWnd);
            wi.ClassName = ClassOf(hWnd);
            wi.Title = TitleOf(hWnd);
            RECT r;
            if (GetWindowRect(hWnd, out r))
            {
                wi.Left = r.Left;
                wi.Top = r.Top;
                wi.Right = r.Right;
                wi.Bottom = r.Bottom;
            }
            wi.Area = AreaOf(hWnd);
            wi.ExStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
            wi.ToolWindow = (wi.ExStyle & WS_EX_TOOLWINDOW) != 0;
            list.Add(wi);
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
'@
        Add-Type -TypeDefinition $cs -Language CSharp -ErrorAction Stop
    }
    Out-Line ("DETAIL: loaded native helpers in " + $script:Stopwatch.ElapsedMilliseconds + " ms")

    # ------------------------------------------------------------- find window
    $autoMode = ($ProcessId -le 0)
    $allWindows = [FocusNative]::ListTopWindows()
    $autoPids = @{}
    if ($autoMode) {
        foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
            if ($p.ProcessName -match 'DeepSeek|Harness') { $autoPids[[int]$p.Id] = $true }
        }
        $pidList = @($autoPids.Keys | Sort-Object) -join ','
        Out-Line ("DETAIL: auto-detect mode, matched process pids: " + $pidList)
    } else {
        Out-Line ("DETAIL: explicit mode, target pid: " + $ProcessId)
    }

    $candidates = @()
    foreach ($w in $allWindows) {
        if ($w.HasOwner) { continue }
        if ($w.ToolWindow) { continue }
        $titleMatch = ($w.Title -like '*DeepSeek*')
        $isProcMatch = $false
        if ($autoMode) {
            if ($autoPids.ContainsKey([int]$w.Pid)) {
                $isProcMatch = $true
            } elseif (-not $titleMatch) {
                continue
            }
        } else {
            if ([int]$w.Pid -ne $ProcessId) { continue }
            $isProcMatch = $true
        }
        # A window hidden with SW_HIDE (the tray toggle) is still the window the
        # user wants back. Keep it only when it belongs to the DSH process, so a
        # hidden window that merely mentions DeepSeek in its title is not shown
        # to the user (issue #40).
        if (-not $w.Visible -and -not $isProcMatch) { continue }
        $isClassTarget = ($w.ClassName -eq [FocusNative]::TARGET_CLASS)
        $candidates += [pscustomobject]@{
            Hwnd          = $w.Hwnd
            Pid           = [int]$w.Pid
            ClassName     = $w.ClassName
            Title         = $w.Title
            Area          = [long]$w.Area
            Iconic        = [bool]$w.Iconic
            Visible       = [bool]$w.Visible
            IsClassTarget = [bool]$isClassTarget
            IsProcMatch   = [bool]$isProcMatch
        }
    }
    Out-Line ("DETAIL: candidates=" + $candidates.Count)

    if ($candidates.Count -eq 0) {
        Out-Line 'DETAIL: no candidate window found'
    } else {
        $sortSpec = @(
            @{ Expression = { [int]$_.IsProcMatch }; Descending = $true }
            @{ Expression = { [int]$_.Visible }; Descending = $true }
            @{ Expression = { [int]$_.IsClassTarget }; Descending = $true }
            @{ Expression = { [long]$_.Area }; Descending = $true }
        )
        $ranked = @($candidates | Sort-Object -Property $sortSpec)
        $idx = 0
        foreach ($c in $ranked) {
            $idx++
            Out-Line ("DETAIL: candidate #{0} hwnd=0x{1:X} pid={2} class={3} area={4} iconic={5} visible={6} procMatch={7} title={8}" -f `
                $idx, $c.Hwnd.ToInt64(), $c.Pid, $c.ClassName, $c.Area, $c.Iconic, $c.Visible, $c.IsProcMatch, (Short-Text $c.Title 70))
        }

        $chosen = $ranked[0]
        $reason = 'largest area among the remaining candidates'
        if ($chosen.IsClassTarget) { $reason = 'preferred class Chrome_WidgetWin_1, largest area among those' }
        if (-not $chosen.IsProcMatch) { $reason = 'title match only (no process-name match), largest area among those' }
        if (-not $chosen.Visible) { $reason = 'tray-hidden DSH window, ' + $reason }
        Out-Line ("DETAIL: selected hwnd=0x{0:X} pid={1} class={2} area={3} visible={4} ({5})" -f `
            $chosen.Hwnd.ToInt64(), $chosen.Pid, $chosen.ClassName, $chosen.Area, $chosen.Visible, $reason)

        $hwnd = [IntPtr]$chosen.Hwnd
        if (-not $chosen.Visible) {
            Out-Line 'DETAIL: step 0: window is tray-hidden, ShowWindow(SW_SHOW)'
            [void][FocusNative]::ShowWindow($hwnd, [FocusNative]::SW_SHOW)
            Start-Sleep -Milliseconds 50
        }
        $fg0 = [FocusNative]::GetForegroundWindow()
        $iconic0 = [FocusNative]::IsIconic($hwnd)
        Out-Line ("DETAIL: initial foreground=0x{0:X} iconic={1}" -f $fg0.ToInt64(), $iconic0)

        # ---------------------------------------------------------- raise logic
        function Test-Foreground([IntPtr]$Handle, [int]$TimeoutMs) {
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
                if ([FocusNative]::GetForegroundWindow() -eq $Handle) { return $true }
                Start-Sleep -Milliseconds 25
            }
            return ([FocusNative]::GetForegroundWindow() -eq $Handle)
        }

        function Invoke-AltTap {
            [FocusNative]::keybd_event([byte][FocusNative]::VK_MENU, [byte]0, [uint32]0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 15
            [FocusNative]::keybd_event([byte][FocusNative]::VK_MENU, [byte]0, [uint32][FocusNative]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 15
        }

        function Invoke-AltForeground([IntPtr]$Handle) {
            Invoke-AltTap
            [void][FocusNative]::SetForegroundWindow($Handle)
        }

        $focused = $false
        if ($fg0 -eq $hwnd) {
            $focused = $true
            Out-Line 'DETAIL: step 1: window is already foreground, nothing to do'
        } else {
            if ($iconic0) {
                Out-Line 'DETAIL: step 2: window is iconic, ShowWindow(SW_RESTORE) + Alt tap + SetForegroundWindow'
                [void][FocusNative]::ShowWindow($hwnd, [FocusNative]::SW_RESTORE)
                Start-Sleep -Milliseconds 50
                Invoke-AltForeground $hwnd
                $focused = Test-Foreground $hwnd 220
            }
            if (-not $focused) {
                Out-Line 'DETAIL: step 3: Alt tap + SetForegroundWindow'
                Invoke-AltForeground $hwnd
                $focused = Test-Foreground $hwnd 170
            }
            if (-not $focused) {
                # Surface the window without activating it. A plain HWND_TOP raise
                # is ignored for another process's window, but the topmost band is
                # honoured: pulse HWND_TOPMOST briefly, then drop back to
                # HWND_NOTOPMOST, which leaves the window at the top of the normal
                # band while the foreground lock keeps the keyboard focus where it
                # was. A minimize/restore pair instead only shows the window and
                # lets Windows restore its old (bottom) position - issue #42.
                Out-Line 'DETAIL: step 4: SetWindowPos(HWND_TOPMOST) pulse without activation'
                $raiseFlags = [FocusNative]::SWP_NOSIZE -bor [FocusNative]::SWP_NOMOVE -bor `
                    [FocusNative]::SWP_NOACTIVATE -bor [FocusNative]::SWP_SHOWWINDOW
                [void][FocusNative]::SetWindowPos($hwnd, [FocusNative]::HWND_TOPMOST, 0, 0, 0, 0, [uint32]$raiseFlags)
                Start-Sleep -Milliseconds 120
                [void][FocusNative]::SetWindowPos($hwnd, [FocusNative]::HWND_NOTOPMOST, 0, 0, 0, 0, [uint32]$raiseFlags)
                Start-Sleep -Milliseconds 60
            }
            if (-not $focused) {
                Out-Line 'DETAIL: step 5: final Alt tap + SetForegroundWindow'
                Invoke-AltForeground $hwnd
                $focused = Test-Foreground $hwnd 180
            }
        }

        $fg1 = [FocusNative]::GetForegroundWindow()
        $iconic1 = [FocusNative]::IsIconic($hwnd)
        Out-Line ("DETAIL: final foreground=0x{0:X} target=0x{1:X} iconic={2}" -f $fg1.ToInt64(), $hwnd.ToInt64(), $iconic1)
        if ($fg1 -eq $hwnd) {
            $focused = $true
        } else {
            $focused = $false
        }
        if ($focused) { $script:Status = 'FOCUSED=1' } else { $script:Status = 'FOCUSED=0' }
    }
} catch {
    Out-Line ('DETAIL: exception ' + (To-Ascii $_.Exception.Message))
    $script:Status = 'FOCUSED=0'
}

Out-Line ('DETAIL: elapsed_ms=' + $script:Stopwatch.ElapsedMilliseconds)
Out-Line $script:Status
exit 0
