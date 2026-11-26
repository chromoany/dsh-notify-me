# Posts or withdraws one Windows toast for dsh-notify-me.
#
# Called by lib/win-toast.js (host half) as:
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File win-toast.ps1 \
#       -Base64 <base64 JSON payload> [-RemoveTag <history tag>]
#
# The toast is posted under dsh-notify-me's own AUMID: lib/win-toast.js
# registers it (a DisplayName, an IconUri app logo and a CustomActivator) before
# the first toast goes out. Borrowing the DSH shell's AUMID instead made Windows
# route every activation to DSH's COM activator, which silently dropped it — the
# buttons only dismissed the toast (issue #41). On Windows 11 the CustomActivator
# names an empty CLSID and clicks come back through the dsh-notify-me:// handler
# registered in HKCU; on Windows 10 it names a real COM server
# (lib/win-toast-activator.ps1) and the buttons activate in the background
# instead.

param(
    [Parameter(Mandatory = $true)][string]$Base64,
    [string]$RemoveTag = ""
)

$ErrorActionPreference = "Stop"

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

function XmlEscape([string]$Value) {
    if ($null -eq $Value) { return "" }
    return $Value.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace('"', "&quot;").Replace("'", "&apos;")
}

$payloadText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Base64))
$payload = $payloadText | ConvertFrom-Json
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($payload.aumid)

if ($RemoveTag -ne "") {
    [Windows.UI.Notifications.ToastNotificationManager]::History.Remove($RemoveTag, "dsh-notify-me", $payload.aumid)
    exit 0
}

$title = XmlEscape $payload.title
$body = XmlEscape $payload.body

$visual = '<visual><binding template="ToastGeneric"><text>' + $title + '</text><text>' + $body + '</text></binding></visual>'

# How a click comes back depends on the Windows branch (see lib/win-toast.js):
# Windows 11 dispatches the protocol handler registered for dsh-notify-me://,
# while Windows 10 has no protocol activation for an unpackaged app and hands the
# click to the COM server named by the AUMID's CustomActivator instead. Buttons
# reach that server as background activations.
$activation = "protocol"
if ($payload.comActivation) { $activation = "background" }
$activationAttribute = ' activationType="' + $activation + '"'

$actions = ""
if ($payload.approveToken) {
    $approveArgs = "dsh-notify-me://approve?token=" + $payload.approveToken
    $rejectArgs = "dsh-notify-me://reject?token=" + $payload.rejectToken
    $actions = '<actions><action content="' + (XmlEscape $payload.approveText) + '"' + $activationAttribute + ' arguments="' + $approveArgs + '"/><action content="' + (XmlEscape $payload.rejectText) + '"' + $activationAttribute + ' arguments="' + $rejectArgs + '"/></actions>'
}

# Body click: always go through our own protocol handler. The host records the
# click for the page, which raises the window through the host route (the only
# way that works on Windows) and switches to the session when there is one.
# dsh://open used to be the launch target with no session; it never raised a
# minimized or tray-hidden window (issue #40), and when the shell had not
# registered it every click opened the Store dialog instead (issue #54), so the
# handler now records the click and launches nothing.
if ($payload.session) {
    $launch = ' launch="dsh-notify-me://open?session=' + [Uri]::EscapeDataString($payload.session) + '"' + $activationAttribute
} else {
    $launch = ' launch="dsh-notify-me://open"' + $activationAttribute
}

# Two alerts have to outlive the platform's own few seconds: an unanswered
# approval, and any alert under the "never close" policy — the page channel used
# to hold those itself. The "reminder" scenario is the only toast shape Windows
# does not fold into Action Center after its short duration, so those stay on
# screen until the page withdraws them (issue #53). Reminder toasts loop their
# sound unless told not to, so the cue is pinned either way: silent while the
# plugin owns the audio, a single default chime when the platform does.
$scenario = ""
$audio = ""
if ($payload.approveToken -or $payload.persist) {
    $scenario = ' scenario="reminder"'
    if ($payload.sound) { $audio = '<audio loop="false"/>' } else { $audio = '<audio silent="true"/>' }
} elseif (-not $payload.sound) {
    $audio = '<audio silent="true"/>'
}

$xml = '<toast' + $scenario + $launch + '>' + $visual + $actions + $audio + '</toast>'

$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
$toast.Group = "dsh-notify-me"
if ($payload.tag) { $toast.Tag = $payload.tag }
$notifier.Show($toast)
