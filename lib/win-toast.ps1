# Posts or withdraws one Windows toast for dsh-notify-me.
#
# Called by lib/win-toast.js (host half) as:
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File win-toast.ps1 \
#       -Base64 <base64 JSON payload> [-RemoveTag <history tag>]
#
# The toast itself needs no registration: the AUMID is the one the DSH desktop
# shell already owns (it shows the update prompt). Approval buttons use
# protocol activation, so the click leaves the app and comes back through the
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

# Body click: raise DSH. With a session id it goes through our protocol handler
# so the page can switch to that conversation; without one, straight to dsh://open.
if ($payload.session) {
    $launch = ' launch="dsh-notify-me://open?session=' + [Uri]::EscapeDataString($payload.session) + '" activationType="protocol"'
} else {
    $launch = ' launch="dsh://open" activationType="protocol"'
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
