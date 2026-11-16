# Posts or withdraws one Windows toast for dsh-notify-me.
#
# Called by lib/win-toast.js (host half) as:
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File win-toast.ps1 \
#       -Base64 <base64 JSON payload> [-RemoveTag <history tag>]
#
# The toast is posted under dsh-notify-me's own AUMID: lib/win-toast.js
# registers it (a DisplayName plus a stub CustomActivator with no LocalServer32)
# before the first toast goes out. Borrowing the DSH shell's AUMID instead made
# Windows route every activation to DSH's COM activator, which silently dropped
# it — the buttons only dismissed the toast (issue #41). Approval buttons and
# the body both use protocol activation, so the click comes back through the
# dsh-notify-me:// handler registered in HKCU (see lib/win-toast.js).

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

$actions = ""
if ($payload.approveToken) {
    $approveArgs = "dsh-notify-me://approve?token=" + $payload.approveToken
    $rejectArgs = "dsh-notify-me://reject?token=" + $payload.rejectToken
    $actions = '<actions><action content="' + (XmlEscape $payload.approveText) + '" activationType="protocol" arguments="' + $approveArgs + '"/><action content="' + (XmlEscape $payload.rejectText) + '" activationType="protocol" arguments="' + $rejectArgs + '"/></actions>'
}

# Body click: always go through our own protocol handler. The host records the
# click for the page, which raises the window through the host route (the only
# way that works on Windows) and switches to the session when there is one.
# dsh://open used to be the launch target with no session; it never raised a
# minimized or tray-hidden window (issue #40).
if ($payload.session) {
    $launch = ' launch="dsh-notify-me://open?session=' + [Uri]::EscapeDataString($payload.session) + '" activationType="protocol"'
} else {
    $launch = ' launch="dsh-notify-me://open" activationType="protocol"'
}

$audio = ""
if (-not $payload.sound) { $audio = '<audio silent="true"/>' }

$xml = '<toast' + $launch + '>' + $visual + $actions + $audio + '</toast>'

$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
$toast.Group = "dsh-notify-me"
if ($payload.tag) { $toast.Tag = $payload.tag }
$notifier.Show($toast)
