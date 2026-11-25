# COM local server for dsh-notify-me's approval toasts.
#
# Windows 10 never dispatches `activationType="protocol"` for an unpackaged
# desktop app: with a stub CustomActivator (a CLSID that has no LocalServer32)
# the toast pops up and the click is dropped on the floor (microsoft-ui-xaml
# #1939 -- fixed in 18967, i.e. Windows 11; nothing was backported to the
# 19041/19045 branch). The shell only delivers the activation when the AUMID's
# CustomActivator names a real COM server, so on Windows 10 lib/win-toast.js
# registers this script as that server's LocalServer32:
#
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
#       -File win-toast-activator.ps1 -ActionDir <actions dir>   (COM appends -Embedding)
#
# The server implements INotificationActivationCallback -- the interface the
# toast platform calls, and the one the reporter of issue #58 got stuck on. The
# IID below is the real one: Windows ships a proxy for it under
# HKLM\Software\Classes\Interface, so no self-built proxy/stub is needed. The
# GUID quoted in issue #58 (`...-75CFF7E24005`) does not name any interface;
# registering it fails the cross-process QueryInterface and Activate can never
# arrive.
#
# Every activation is recorded as `dsh-notify-me://<invokedArgs>` in the actions
# directory the page already polls, so the approval pipeline downstream of the
# click is the same code path Windows 11 uses (lib/win-toast.js takeActions).
# The process exits after ACTIVE_MINUTES so a long-lived user session does not
# keep a stray PowerShell around; a later click starts it again on demand.
#
# Pure ASCII on purpose: Windows PowerShell 5.1 decodes a BOM-less script with
# the ANSI code page, so any non-ASCII byte here would arrive mangled.

$ErrorActionPreference = "Stop"

$actionDir = ""
for ($i = 0; $i -lt $args.Length - 1; $i++) {
    if ($args[$i] -eq "-ActionDir") { $actionDir = $args[$i + 1] }
}
if ($actionDir -eq "") { exit 2 }

$CLSID = "F0C6A9D2-4B7E-4D1A-9C53-8E2B6F7A0D41"
$ACTIVE_MINUTES = 10

$source = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace DshNotifyMe
{
    [ComImport]
    [Guid("00000001-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IClassFactory
    {
        [PreserveSig]
        int CreateInstance(IntPtr outer, ref Guid riid, out IntPtr obj);
        [PreserveSig]
        int LockServer(bool lockIt);
    }

    [ComVisible(true)]
    [Guid("53E31837-6600-4A81-9395-75CFFE746F94")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface INotificationActivationCallback
    {
        void Activate(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string invokedArgs,
            IntPtr data,
            uint count);
    }

    public static class Inbox
    {
        public static string ActionDir = "";

        public static void Record(string invokedArgs)
        {
            string dir = ActionDir;
            if (dir == null || dir.Length == 0) return;
            string text = invokedArgs == null ? "" : invokedArgs.Trim();
            if (text.Length == 0) return;
            if (!text.StartsWith("dsh-notify-me://", StringComparison.OrdinalIgnoreCase)) {
                text = "dsh-notify-me://" + text;
            }
            Directory.CreateDirectory(dir);
            string name = DateTime.UtcNow.Ticks.ToString() + "-" + Guid.NewGuid().ToString("N");
            File.WriteAllText(Path.Combine(dir, name), text, new UTF8Encoding(false));
            Server.Touch();
        }
    }

    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    public class NotifyActivator : INotificationActivationCallback
    {
        public void Activate(string appUserModelId, string invokedArgs, IntPtr data, uint count)
        {
            try { Inbox.Record(invokedArgs); } catch (Exception) { }
        }
    }

    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    public class Factory : IClassFactory
    {
        public int CreateInstance(IntPtr outer, ref Guid riid, out IntPtr obj)
        {
            obj = IntPtr.Zero;
            if (outer != IntPtr.Zero) return unchecked((int)0x80040110);
            IntPtr unk = Marshal.GetIUnknownForObject(new NotifyActivator());
            try { return Marshal.QueryInterface(unk, ref riid, out obj); }
            finally { Marshal.Release(unk); }
        }

        public int LockServer(bool lockIt) { return 0; }
    }

    public static class Server
    {
        [DllImport("ole32.dll")]
        static extern int CoRegisterClassObject(ref Guid clsid, IClassFactory factory, uint ctx, uint flags, out uint cookie);
        [DllImport("ole32.dll")]
        static extern int CoRevokeClassObject(uint cookie);
        [DllImport("user32.dll")]
        static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
        [DllImport("user32.dll")]
        static extern bool TranslateMessage(ref MSG msg);
        [DllImport("user32.dll")]
        static extern IntPtr DispatchMessage(ref MSG msg);
        [DllImport("user32.dll")]
        static extern void PostQuitMessage(int code);

        [StructLayout(LayoutKind.Sequential)]
        public struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int x;
            public int y;
        }

        static readonly object Gate = new object();
        static Timer Idle;
        static int Minutes = 10;

        static void Quit(object state)
        {
            PostQuitMessage(0);
        }

        public static void Touch()
        {
            lock (Gate) {
                if (Idle == null) return;
                Idle.Change(Timeout.Infinite, Timeout.Infinite);
                Idle.Change(Minutes, Timeout.Infinite);
            }
        }

        public static int Run(string actionDir, string clsid, int minutes)
        {
            Inbox.ActionDir = actionDir;
            Minutes = minutes * 60 * 1000;
            Guid id = new Guid(clsid);
            uint cookie;
            int hr = CoRegisterClassObject(ref id, new Factory(), 4 /* CLSCTX_LOCAL_SERVER */, 1 /* REGCLS_MULTIPLEUSE */, out cookie);
            if (hr != 0) {
                Console.Error.WriteLine("CoRegisterClassObject failed 0x" + hr.ToString("X8"));
                return 3;
            }
            Idle = new Timer(new TimerCallback(Quit), null, Minutes, Timeout.Infinite);
            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
            Idle.Dispose();
            CoRevokeClassObject(cookie);
            return 0;
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $source -Language CSharp | Out-Null
} catch {
    [Console]::Error.WriteLine("dsh-notify-me activator: Add-Type failed: " + $_.Exception.ToString())
    exit 4
}

exit [DshNotifyMe.Server]::Run($actionDir, $CLSID, $ACTIVE_MINUTES)
