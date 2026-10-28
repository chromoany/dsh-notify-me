<div align="center">

<img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/brand/icon-app-128.png" width="76" height="76" alt="dsh-notify-me">

# dsh-notify-me

**Step away from DSH and know when to come back.**

[简体中文](README.md) | English

[![npm version](https://img.shields.io/npm/v/dsh-notify-me?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-notify-me)
[![npm downloads](https://img.shields.io/npm/dm/dsh-notify-me?style=flat-square&label=downloads%2Fmonth&color=1F883D)](https://www.npmjs.com/package/dsh-notify-me)
[![npm total downloads](https://img.shields.io/npm/dt/dsh-notify-me?style=flat-square&label=total%20downloads&color=1F883D)](https://www.npmjs.com/package/dsh-notify-me)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![test](https://github.com/chromoany/dsh-notify-me/actions/workflows/test.yml/badge.svg)](https://github.com/chromoany/dsh-notify-me/actions/workflows/test.yml)
[![DSH Web and Desktop](https://img.shields.io/badge/DSH-Web%20%7C%20Desktop-blue?style=flat-square)](#installation)
[![Package size](https://img.shields.io/npm/unpacked-size/dsh-notify-me?style=flat-square&label=package%20size)](https://www.npmjs.com/package/dsh-notify-me)
[![DSH Compatibility](https://img.shields.io/badge/DSH-tested%200.2.1--rc.2-6366f1.svg?style=flat-square)](#compatibility)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

</div>

[Install](#installation) · [Preview](#ui-preview) · [Settings](#configure-it-from-dsh-settings) · [Compatibility](#compatibility) · [Known limitations](#known-limitations) · [Changelog](CHANGELOG.md)

A notification plugin for DSH Web / Desktop, so you can afford to keep full access off without watching the page all day.

- **When input is needed:** approval, plan review, and questions get a notification, a sound, and a title marker.
- **When a background reply finishes:** come back for the result; clicking the notification returns to that conversation. Pick "background only", "quiet for the open one", or "always".
- **When you walk off but the window stays in front:** over 3 minutes without input counts as away, and the alert still fires as usual; the toast that arrived does not clear itself before you come back.
- **When you leave your computer:** optionally forward alerts to Discord, Bark, Gotify, Feishu group bots, ServerChan, WxPusher, or your own webhook.
- **When you close the page entirely:** optional host-side fallback — with no page open the host process keeps pushing "needs you" / "reply finished" to your gateway; or turn on just the same-origin relay so the page can reach an authenticated gateway. Both are off by default and configured in the profile's patch layer (see "After the page closes" under [Advanced](#advanced)).

> The page or desktop app has to stay running (background / minimized is fine); system notifications need notification permission. Approval buttons rely on a Service Worker, so only Web has them — Desktop notifications carry no buttons, and clicking one takes you back to the conversation to decide. With host-side fallback enabled you still get external push once the page is closed — local toasts and the approval buttons still need the page.

## UI Preview

![Plain DSH notification shown through Edge on Windows, without approval buttons](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/notify-toast.png)

*Plain notification example · Windows / Edge · no approval buttons.* [View full size](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/notify-toast.png)

<details>
<summary>See the settings interface</summary>

![The Notify me settings page: header, how you get told, when to alert, try it, and the collapsed Advanced block](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/settings-en.png)

Just the plugin's own panel (the real component, on the same dark theme as the host), without the DSH navigation sidebar; row explanations only appear once the pointer rests on the title text, which is why only the titles show here.

</details>

## Installation

### DSH Web

With the DSH CLI already installed, run in a terminal:

```sh
# Install and auto-mount into the web profile
dsh plugin --profile web add dsh-notify-me
```

Restart `dsh web`, then hard-refresh the page (Ctrl+Shift+R on Windows / Linux, Cmd+Shift+R on macOS). If you use another Web profile, replace `web` with its actual name.

### DSH Desktop

1. Open **Plugins → Add plugin** in the desktop application.
2. Enter the npm package name `dsh-notify-me`, follow the installation prompts, and confirm that the plugin is enabled.
3. Quit DSH Desktop completely and relaunch it so the plugin loads.

The Electron application manages the `desktop` profile. Do not change the Web command above to `--profile desktop`: the CLI rejects that operation. Installing into the Web profile does not automatically install the plugin into Desktop.

## First-use check

1. Click once in the DSH page and allow notifications when prompted. If you declined before, allow them in the browser's site settings. The operating system also has to allow notifications from the browser / DSH Desktop.
2. Open **Settings → Notify me**. Confirm that the section and the plugin version at its foot appear, and leave "Enable reminders" and "Sound" on.
3. Click **Test "reply finished"** on the settings page. A test notification should appear and play a sound according to your current sound settings. This local test is not forwarded to any external endpoint, and the "also alert while the window is in front" switch does not apply to it.

Web users can also test the approval buttons, which then appear on the notification. Desktop cannot get a Service Worker, so this test sends a plain notification; real approval alerts work the same way — the toast fires, and clicking it takes you back to the conversation to decide.

**Optional console check** — in environments with DevTools, you can also run:

```js
window.__dshNotifyMe.test("done")        // "reply finished" sample
window.__dshNotifyMe.test("attention")   // "needs you" sample
window.__dshNotifyMe.test("approval")    // Approve / Reject when the bridge is available; a plain notification otherwise (which is what Desktop gets)
window.__dshNotifyMe.debug()             // bridge ("active" = buttons work), raiseChannel, the last raise attempt in raiseLast, a refused toast's platform message in lastToastReject, configStored for whether the settings really persisted, and hostBridge for host coordination
```

If no test notification appears, check in this order: whether the notification permission was declined (click once on the page and choose **Allow**; or address-bar lock → Site settings → Notifications → Allow → reload), whether DSH was restarted after installing, and whether the browser's notifications are switched off in the OS settings.

## Why you need it

- **Without full access (`workspace-write` + ask):** keep approval before actions, but a missed request leaves the agent waiting.
- **With full access:** fewer approval interruptions, at the cost of losing the ability to intercept beforehand.

dsh-notify-me decouples **supervision** from **sitting in front of the screen**: it pulls you back with a system notification only when a decision is genuinely needed (approval / plan review / question) or a reply finishes — **so you can afford to keep full access off** instead of trading away interception for speed. It does not lower the risk of full access itself (it is not a sandbox); it reduces the time spent waiting on missed approvals in ask-mode.

## What it alerts about

| Event | Default behavior |
| --- | --- |
| 🔔 Input needed | Alerts even in the foreground; the conversation on screen keeps only a title marker |
| ✅ Reply finished | Alerts while the page is hidden / backgrounded (or "quiet for the open one" / "always") |

**Input needed** covers approval requests, plan review, and questions (`ask_user_question`). The approve / reject quick decision only works on Web, where the toast carries the buttons; on Desktop, click the notification to decide in the conversation (see [Known limitations](#known-limitations)).

**Reply finished** also covers background sessions. A finished but unread session keeps the `✅ Reply finished ·` title marker until opened. Title markers are independent of the alert policy.

The first line of the alert body is the session title: the conversation you have open is treated like any other, instead of falling back to "Current conversation"; the placeholder only appears for a brand-new session whose title the host has not published yet.

> **Background** subagent child sessions are **not** alerted about by default: DSH lists each of them as its own session, but they are steps inside the parent conversation's turn, so an alert for them is only noise. The subagent session you have open is not part of this and alerts as usual. Settings → "Ignore subagent sessions" turns the mute off.

## Configure it from DSH Settings

Open **Settings → Notify me**. The page lays out three blocks — how you get told, when to alert, and try it — and the knobs you rarely change fold into **Advanced** at the bottom, one click to open. Rows show only a title; the explanation pops up in a small box when the pointer rests on the title text (only the title itself triggers it, not the empty rest of the row; for touch or keyboard a hidden copy is kept for screen readers). Rows marked with ▸ open a sub-item on click.

### How you get told

- **Enable reminders** — master switch: off means no toasts, no sound, and the tab title is left alone;
- **Sound / Volume** — the switch toggles directly; the volume slider is folded into that row and revealed by clicking the title (▸ becomes ▾). What it actually plays is decided by Advanced → Alert sound source;
- **Decide approvals from the toast** (on by default) — approvals carry Approve / Reject, one click settles the request without switching back. Web gets a system notification with buttons; Desktop `dsh-app://` cannot register a Service Worker, so the notification has no buttons and you click it to decide in the conversation. The line under "Try it" states truthfully whether the current environment can provide buttons.

### When to alert

- **Also alert "needs you" while the window is in front** (on by default): off means you only hear it once the window goes to the background;
- **Stay quiet for the conversation on screen** (on by default): a wait in the conversation you are looking at keeps only the tab marker, and is delivered once you leave;
- **When "reply finished" alerts** (default "background only"): background only / quiet for the open one / always — pick one;
- **Dismiss the toast automatically** (default "keep while away"): keep while away / always close / never close — pick one;
- **Ignore subagent sessions** (on by default): skips background subagent sessions, while the one you have open still alerts;
- **Click a toast to open that conversation** (on by default): switches to that conversation and brings the window forward — on Windows through the host route, on macOS / Linux through the `dsh://open` deep link — and with several tabs only one is raised.

<details>
<summary>Edge cases behind the switches</summary>

- **What counts as background**: switching to another app, being covered by another window, or minimizing all count; a window left in front with 3 minutes of no keyboard or mouse input counts too, and `idleMinutes: 0` falls back to looking only at the window.
- **When "stay quiet for the conversation on screen" is replayed**: as usual once the window goes to the background or the idle timer fires; if you already handled it, it is dropped.
- **The three "reply finished" choices**: "background only" = alert when you are not watching the page; "quiet for the open one" = the one on screen stays silent while other conversations still alert, useful with several open; "always" = never suppress. An old profile's "also alert 'reply finished' while in front" switch migrates to this setting automatically.
- **"Keep while away"**: while you are at the page a plain toast closes itself after a few seconds; one that arrived while you were away stays in the notification centre until you come back. A toast with Approve / Reject carries no auto-dismiss timer — it stays until you click a button, answer the request in the page, or a newer request replaces it; a desktop approval toast, which cannot render buttons, closes after 12 s and is likewise not withdrawn while you are away.
- **Fallback for a toast click**: on Desktop a window that will not raise leaves only the conversation switch, with the reason in `debug().raiseLast`; turn this switch off and a click does nothing.

</details>

### Try it

Three buttons send one "needs you", one "reply finished" and one "approval buttons" test alert with the current settings, right away, and deliberately **not** limited by the switches under "when to alert"; the line underneath states which channel can carry approval buttons right now.

The plugin version is always shown at the bottom of the settings page (`dsh-notify-me v…`) — copy that line when reporting a bug or checking whether an update landed.

### Advanced

Collapsed by default, one click to open. It holds the three things you rarely touch — alert sound sources, external push, and runtime & diagnostics — covered in the three subsections below.

#### Alert sound

For each alert kind — "needs you" and "reply finished" — you can pick a built-in cue (the default), a custom audio file, or the system notification sound, independently. A custom file is capped at 1 MiB, lives in the browser, and can be previewed and removed; the system notification sound plays no plugin cue at all — the toast still fires and the sound is handed to the operating system, so its timbre follows your system notification settings, and in that mode Preview sends a test alert instead. Any source that has no file, cannot be read, or does not fit falls back to the built-in cue, so an alert never goes silent.

#### External push

Off by default. Supports Discord Webhook / Bark / Gotify / Feishu group bots / ServerChan (Turbo and ServerChan³) / WxPusher / custom webhooks. Alert text is sent to the addresses you enter; use trusted endpoints only.

<details>
<summary>Target URLs, forwarding switches, test messages, and the failure log</summary>

- **External notifications** (default off): forward each alert to your own push endpoints as well, so it reaches you away from the machine; any number of targets, each of which can be enabled or disabled on its own. "Forward 'needs you'" and "Forward 'reply finished'" switch independently; **Send test notification** sends one test message to every target (not limited by those two switches, and never pretending to be a real alert). Forwarding follows exactly the same trigger rules as local alerts ("stay quiet for the conversation on screen" and friends apply to it too); the alert text is sent as-is to the addresses you fill in, so **only use endpoints you trust**;
- **What each target takes**: Discord — the webhook URL; Bark — `https://api.day.app/<device key>`; Gotify — `https://<server>/message?token=<app token>`; Feishu — the group-bot webhook plus an optional verification secret; ServerChan — the full `…/send/<SendKey>.send` URL; WxPusher — the appToken and the receiver UID; a custom endpoint receives one POST of JSON: `{source, event, title, body, text, sessionId, time}`;
- **Reliable delivery**: failures that look transient (network error, 5xx, 429) are retried after 2 s and 6 s; anything else stops at once. Switching forwarding off or deleting a target cancels a retry that is already on a timer — it is not counted as a failure and never reaches the failure log. A delivery that still fails is recorded in the failure log (10 entries at most — title and body snippet plus host only, never the full endpoint), which the settings page shows and can clear;
- **Service codes and "unverified"**: a 2xx from Feishu / ServerChan / WxPusher also carries a service code (`0` for Feishu and ServerChan, `1000` for WxPusher); a wrong code is recorded as a failure with the service's own message, and a 2xx whose body is not that service's JSON (empty, or a proxy/WAF HTML page) is "sent but unverified" rather than a success;
- **Per-target state**: the right end of each target row shows how its last delivery went (last delivery ok / sent-unverified / failed with the reason) next to a switch of its own, so an endpoint that is temporarily down can be turned off alone instead of muting a whole alert kind;
- **Signing**: a custom target with a secret sends `X-DSH-Notify-Signature` (HMAC-SHA256 over the body, `sha256=<hex>`); a Feishu target with a secret carries `timestamp` / `sign` in the body per Feishu's own algorithm;
- **Message template** (optional): Feishu / ServerChan / WxPusher / custom targets accept a template with `{{title}}` `{{body}}` `{{event}}` `{{time}}` `{{session}}`; empty means "title, newline, body";
- **DingTalk is not supported**: its robot endpoint answers no CORS header at all and only accepts `application/json`, so a page can neither read the reply nor send a conforming request (under no-cors the content type is restricted to the safelisted ones). To reach DingTalk, relay it through a machine you control and point a custom webhook at that.

</details>

#### After the page closes: host-side fallback and the same-origin relay

Both live in the host process (`lib/host-fallback.js`, `lib/relay.js`, optional modules inside the package) and both are off by default: with no config the host registers the raise-window route and nothing else, so behaviour is identical before and after the upgrade. They are configured in the profile's patch layer, not on the Settings page — they make the host act on the page's behalf, they are not browser preferences; the Settings page only reports the state it probed.

<details>
<summary>Host-side fallback: the host keeps pushing after the page closes</summary>

With no page open the browser half does not run, and that is where alerts stop. The host-side fallback subscribes to the host's session event feed (`session/event`) and pushes the same two alerts to your gateway on its own once the page is closed.

An override example for the profile (`~/.dsh/profiles/<profile>/cordis.patch.yml`). **`config` is replaced wholesale, not deep-merged**: a patch row naming the same `id` assigns the whole `config`, which is why the example spells out all three blocks — an omitted key falls back to the plugin's own defaults (the same values as the bundled YAML), but a `gateway.target` wiped along with it does not come back on its own.

```yaml
- id: notify-me
  config:
    allowedOrigins: []            # top level: page-entry allow-list; empty = loopback / bind address only (all three host routes)
    gateway:
      target: ''                  # e.g. https://cue.example/notify/<key>
      credentialsFile: ''         # mode-0600 JSON, see below
      headers: {}                 # extra request headers, optional
    hostFallback:
      enabled: true
      target: ''                  # empty = use gateway.target
      credentialsFile: ''         # empty = use gateway.credentialsFile
      events: ['turn/end', 'approval/asked']
      includeSubagents: false
      turnEndThrottleMs: 15000
      titlePrefix: 'DSH'
      language: 'auto'            # auto | zh | en
      pageLeaseMs: 60000          # 0 = no coordination with the page (duplicates while it is open)
      healthPath: '/__dsh-notify-me/host-fallback'
    relay:
      enabled: false
      path: ''
      target: ''
      credentialsFile: ''
```

Key by key (defaults in parentheses):

- `enabled` (`false`): off means the host subscribes to nothing and registers no health probe;
- `target` / `credentialsFile` (empty): empty falls back to `gateway.*`; with both empty there is nowhere to push, so the module is not mounted at all and only one warning line lands in the host log — easier to act on than a failed delivery every time;
- `events` (`['turn/end', 'approval/asked']`): the events to push; listing one gives you only that one;
- `includeSubagents` (`false`): sessions with `origin === 'subagent'` are skipped by default, for the same reason as on the page side — they are steps inside the parent conversation's turn;
- `turnEndThrottleMs` (`15000`): one "reply finished" per session inside that window; the window is only spent when an alert actually went out, so one held off by the lease does not consume it;
- **The copy matches the page's own toast verbatim**: the title is `<prefix> · Reply finished` / `<prefix> · Approval request`, the body is the session name for a finished turn and `session: tool · reason` for an approval — never any of the user message text (a user message often carries injected `<system-reminder>` blocks, memory context and timestamps, which make a notification unreadable); an abnormal end (`aborted` / `error` / `max-tokens`, …) appends a short parenthetical such as ` (error)`;
- `titlePrefix` (`DSH`): titles read `<prefix> · Approval request` / `<prefix> · Reply finished` (the page's own labels);
- `language` (`auto`): `auto` follows the language of the page's last heartbeat and only falls back to Chinese with no heartbeat at all; `zh` / `en` force one;
- `pageLeaseMs` (`60000`): the page's online lease, see "deduplication" below;
- `healthPath` (`/__dsh-notify-me/host-fallback`): the path of the read-only health probe.

**The credentials file** is a mode-0600 JSON file readable by the host user, holding `{"user": "...", "password": "..."}` (sent as HTTP Basic) or `{"authorization": "Bearer ..."}` (sent verbatim; a bare token gets `Bearer ` prepended). It must not go into the patch layer — that layer is world-readable and lands in the profile directory. Leaving the key empty sends the request without an authentication header: plenty of webhook endpoints never ask for one, and treating a missing credentials file as an error would make every alert fail; only a path that is configured and unreadable counts as credentials-unavailable. When the gateway answers 401 / 403 the host drops the cached credential, re-reads the file and retries exactly once, so a rotated password needs no host restart.

**Deduplication rides on one page online lease**: on load the page probes `GET /__dsh-notify-me/host-bridge` once (and again every 60 s; no probe while the page is hidden, one catch-up probe when it becomes visible), and it only starts heartbeating when the reply says `hostFallback.enabled === true` — the body carries `{alive, language}` only, the interval is `leaseMs/3` clamped to 5–20 s, and `pagehide` releases immediately with one `{alive:false}` (sent with `keepalive`). A fresh host-side lease means no fallback push (the page is delivering), while an expired lease or an `alive:false` hands over, waiting at most `pageLeaseMs`. The heartbeat carries the language, not the page's push switches: the rule is simply that the host takes over while no page holds the lease, and the page's own visibility and idle heuristics are invisible to the host — honouring half of them would produce a rule nobody can predict. The language it brings is what keeps an English page from getting Chinese host alerts, and it applies whenever `language: 'auto'`. `pageLeaseMs: 0` turns coordination off so the host always pushes — the page then gets everything twice while it is open, so use it for debugging only.

**The two route contracts**: the probe the page calls, `GET /__dsh-notify-me/host-bridge`, answers `{ok, version, features, hostFallback:{enabled, leaseMs}, relay:{enabled, path}, language, page:{alive, ageMs}}`; it is only registered while `hostFallback.enabled` or `relay.enabled` is true, so on a stock install it is a 404 and the page reads that as "off" rather than as a fault. The heartbeat `POST` requires the intent header `x-dsh-notify-me-page: bridge` (missing header → `403`), answers `400` to bad JSON and `413` to a body over 16 KiB, and `200 {ok, leaseUntil}` on success.

**The health probe**: `GET <healthPath>` answers `{ok, version, enabled, events, includeSubagents, pageAlive, lastDelivery: {at, ok, status} | null}`, and any other method gets `405`. It shares the same gate as the other host entry points: the peer has to be this machine (loopback, or the exact address the listener itself is bound to), the `Host` has to be a loopback name, that bind address, or a public name derived from `allowedOrigins`, and a request that fails either is answered `403` with `reason` (`bad-remote` / `bad-host` / `cross-origin`). The probe carries no credential and forwards nothing — it is what you curl from a terminal to confirm that this host process is pushing at all and how the last delivery went.

**Behind a tunnel or reverse proxy `allowedOrigins` is mandatory**: there the `Host` reaching the host is the public domain rather than a loopback address, and `allowedOrigins` is both the `Origin` allow-list and the source of the public `Host` names that are accepted. Without it the page's heartbeat is refused as `bad-host` (the settings row reads "Host did not answer" and the note underneath points you at the top-level `allowedOrigins`), and the host pushes duplicates for a page that is open — exactly the duplication the lease exists to prevent.

</details>

<details>
<summary>Same-origin relay: reaching a gateway that wants authentication</summary>

The page pushes to its external targets with its own `fetch`, and a gateway behind Basic auth is a dead end, blocked three separate ways:

1. Credentials in the URL (`https://user:pass@host/…`): `fetch` throws before a byte leaves;
2. An `Authorization` header: the request turns into a preflighted one, and a gateway like Apprise answers no `Access-Control-Allow-*` at all, so the preflight fails;
3. The `no-cors` fallback: it cannot carry a custom header, which amounts to no authentication at all.

The page is left reporting "sent but unverifiable". The same-origin relay moves that leg into the host: the page POSTs to a route on its own origin, the host adds the credentials and calls the gateway, then answers the page with the gateway's real status.

Enabling it takes `relay.enabled: true`, an absolute `relay.path`, `relay.target` (empty falls back to `gateway.target`) and `relay.credentialsFile` (empty falls back to `gateway.credentialsFile`). The path is itself the capability — knowing it is enough to make the host send a notification for you, so it is worth as much as a password; keep a random token in it: `/__dsh-notify-me/relay/<32 hex token>`.

How to use it: **Settings → Notify me → Advanced → External push** gains two read-only rows, and the "Same-origin relay" one shows `Enabled · address: <origin><relay.path>`; paste that absolute address into the URL of a **custom webhook** target on the same page, and the page never has to know the credentials.

You do not have to change the address either: **a "custom webhook" target that names the relay's own upstream gateway is folded onto the relay route when it is sent.** Such an address cannot work from a browser (the three CORS facts above block it, and the `no-cors` fallback is a *cross-site* POST that Apprise answers `403 Cross-site request rejected`), and older builds recorded that as `unverified` — the settings row read "last delivery sent-unverified" and the test button reported "sent-unverified", **while the phone stayed silent**. Folded, the request stays same-origin and the host adds the credential, so the verdict is the gateway's real status. Folding happens only when the target is of type "custom" *and* its URL's host equals `relay.upstreamHost`; every other host is posted exactly as configured (the relay only delivers to its own gateway), and the settings page prints a note under any target that will be folded.

Behind a tunnel or reverse proxy the relay passes the same `Host` gate as the bridge route: put the page's public origin in the top-level `allowedOrigins`, or both the probe and the `POST` are refused as `bad-host`.

What comes back (which is how the page turns "sent but unverifiable" into something checkable):

- `GET` / `HEAD` `<relay.path>` → `200 {ok, route, version, enabled}`: a read-only probe that forwards nothing and carries no credential, but it does go through **the same gate as the other host entry points** — the path itself is the capability, so an ungated probe would tell whoever guessed it that the guess was right; use it to confirm that this process mounted the path you configured;
- `POST` → reads the body (64 KiB cap), requires a JSON object, maps it onto the gateway's `{title, body, type:'info'}` (the payload's `tag` is deliberately not forwarded: Apprise treats a tag as a service filter, and an unmatched one answers 424), and attaches `gateway.headers` plus the credentials;
- `200 {ok, upstreamStatus, upstreamBody}` (with `upstreamBody` at most 500 characters) — the forward succeeded; a non-2xx from the gateway answers `502` in the same shape;
- `400` (bad or empty JSON body), `413` (body over the cap), `405` (wrong method), `403` (refused by the gate, `reason` as above), `503` (a credentials file is configured but cannot be read), `502 {reason:'upstream-error'}` (the upstream call itself failed).

Credentials stay in the host: the page cannot read them, and they are never echoed into a response or a log line. The `POST` goes through the same gate as the other host entry points, so a forged caller (a cross-site page, a DNS-rebinding page) is refused even if it learns the path.

</details>

#### Runtime & diagnostics

The last block inside Advanced. The page protocol is detected automatically to tell Web from Desktop (DSH Desktop, `dsh-app://`); override it by hand if detection is wrong — on Windows a toast click goes through the host route for native raising, on macOS / Linux through the `dsh://open` deep link (see [How the Desktop window gets raised](#how-the-desktop-window-gets-raised)), and it carries no quick-decision buttons, while Web uses `window.focus()` plus the Service Worker bridge. When the manual override disagrees with detection the page says so.

<details>
<summary>Alert language, Desktop window raising, and reset</summary>

- **Alert language**: follow the UI / Simplified Chinese / English — governs the alert copy and the `🔔 …` title marker;
- **Desktop window raising**: on Windows the host route does the native activation, on macOS / Linux the `dsh://open` deep link does; raising back a minimized or covered window is measured to work on Windows and Linux (see [How the Desktop window gets raised](#how-the-desktop-window-gets-raised));
- **Reset settings**: restores every switch and sound setting to the factory defaults (external push targets and chosen custom audio files are kept).

</details>

## Alert channels

| Channel | What it does |
| --- | --- |
| System notification | Through the browser into the Windows / macOS / Linux notification centre; clicking it returns to the conversation it came from. Web can carry Approve / Reject |
| Sound | WebAudio cue by default, with different patterns for "needs you" and "done"; swap in a custom audio file, or hand the sound over to the system notification sound |
| Tab title | `🔔 Action needed · …` / `✅ Reply finished · …`, following the alert language; gone once you open that session, and both markers can be up at the same time |
| External push (optional, default off) | Forwards the same alert to Discord / Bark / Gotify / Feishu / ServerChan / WxPusher / a custom webhook |
| Host-side fallback (optional, default off) | After the page closes the host process keeps pushing "needs you" / "reply finished" to your gateway; needs profile config and a mode-0600 credentials file |
| Same-origin relay (optional, default off) | The page POSTs to a host route on its own origin, the host adds the credentials and forwards to an authenticated gateway, answering with the gateway's real status |

This is primarily a **browser-layer** plugin: local toasts, sound and the title marker still only work while the page is open (minimized or backgrounded is fine — that is exactly the "away" state it watches for); with host-side fallback enabled, external push keeps going from the host process once the page is closed.

## Compatibility

Per-release adaptation records live in [package.json](package.json) under `dsh.compatibility.dshReleases`; the current host (`0.2.1-rc.2`) gates installation on `peerDependencies` and `engines` only and no longer reads that field, so it is a human-readable record, not a gate.

Every release was tested to **actually activate**: `0.1.1-rc.2`, `0.1.2-rc.1`, `0.1.5-rc.1`, `0.1.5-rc.2`, `0.2.0-rc.2` and `0.2.1-rc.2` (the criteria: the plugin entry lands in the boot page's `__DSH_BOOT__`, its inject dependencies resolve, `/plugins/??dsh-notify-me/client.js&rev=…` serves a build containing the new code, and the "Notify me" section appears in Settings). Plugin entries stay compatible from `0.1.1-rc.2` through `0.2.1-rc.2`, and stepping back to an older host needs no config change; the `1.9.0` settings redesign added no new host API, and the bell in the settings page header is the plugin's own SVG (`docs/brand/`).

<details>
<summary>Host-generation shape differences and two known traps</summary>

The plugin picks its interaction source per host generation; the table below marks the boundaries of each shape, not a gate:

| Host generation | "Needs you" interaction source | Current session | Toast-click navigation |
| --- | --- | --- | --- |
| `<= 0.1.2-alpha.1` | controller snapshot `pending[]` | snapshot `current` | `sessions.open()` |
| `0.1.2-alpha.2 .. 0.1.6-alpha.1` | `uiSession.pendingInteractions` | snapshot `current` | `sessions.open()` |
| `>= 0.1.6-alpha.2` (incl. `0.2.0-rc.2`, `0.2.1-rc.2`) | `uiSession.sessionStatus` | `retainedBy.mainView` | `uiWorkspace.openSession()` |

The ranges are illustrative: the plugin picks its source by store shape (whenever `sessionStatus` exists it takes the new path), and the version numbers only mark where each shape appeared. The `peerDependencies` range shapes npm's peer warning — `0.2.1-rc.2` already falls inside `>=0.2.0-rc.1 <0.3.0-0`, so no exemption is needed.

`0.2.1-rc.2` got a separate isolated run: an isolated `DSH_HOME` booting `dsh web` (70 boot entries) placed the plugin entry 59th, in the `application` batch, with all three inject targets present and ordered before it; `client.js` served the then-installed 1.7.0 source build (140,153 B); loaded in a headless Chromium page, `apply` ran normally and `debug()` reported `uiSession: bound`, `uiSessionSource: sessionStatus`, `bridge: active`. Host-side shapes match `0.2.0-rc.2`; no code change was needed.

Two traps are worth remembering: a package listed in `dsh.client.inject` that a newer runtime no longer ships parks the client entry at `pending (waiting for services: …)` forever — which is exactly how 1.1.3 broke on `0.1.2-rc.1` and later; and when the host swaps a store or a field name nothing throws, alerts just go **silent** — `pendingInteractions`→`sessionStatus`, `list.current`→`retainedBy.mainView` and `sessions.open()`→`uiWorkspace.openSession()` were all this kind. So every adaptation has to confirm with `window.__dshNotifyMe.debug()` that it really reports `bound`.

</details>

## Advanced console configuration

The Settings page is the first entry point; to script or bulk-edit preferences, or to reset them, the config lives in `localStorage` (`dshNotifyMe.config`) and can be adjusted live from the console:

<details>
<summary>Console API and storage reference</summary>

```js
window.__dshNotifyMe.config                       // view current config
window.__dshNotifyMe.setConfig({
  enabled: true,           // false = disable all reminders (master switch)
  language: "auto",        // 'auto' follow the UI | 'zh' Simplified Chinese | 'en' English
  attentionHiddenOnly: false, // true = don't alert "needs you" while the page is visible
  currentHiddenOnly: true,    // true = waits in the conversation on screen keep only the title marker (replayed once away)
  donePolicy: "background",   // "reply finished" policy: 'background' only when away | 'smart' quiet only for the open one | 'always' always alert
  idleMinutes: 3,             // minutes without keyboard/mouse input before "away" counts (0 = turn the idle rule off)
  autoDismiss: "present",     // toast auto-dismiss: 'present' keep while away | 'always' always close | 'never' never close
  ignoreSubagent: true,       // true = no alerts for background subagent sessions (the open one still alerts)
  sound: true,                // sound switch (also governs the "system notification sound" mode)
  soundDone: "synth",         // "reply finished" sound source: 'synth' built-in | 'custom' picked file | 'system' OS notification sound
  soundAttention: "synth",    // "needs you" sound source, same values
  volume: 0.5,                // volume 0..1
  autoFocus: true,            // a toast click returns to the conversation that raised it
  quickActions: true,         // Approve / Reject buttons on approval toasts
  hostEnv: "auto",            // runtime: 'auto' detect | 'desktop' force the app | 'web' force the browser
  externalEnabled: false,     // external forwarding master switch (default off: no endpoint, nothing is sent)
  externalAttention: true,    // forward "needs you" (exactly the same trigger rules as local alerts)
  externalDone: true,         // forward "reply finished"
  externalRetryDelays: [2000, 6000], // backoff for retryable failures (ms, with jitter; [] = send once)
  externalTargets: []         // push targets, see the field notes below
})
// Target shape: {id, type, url, secret?, token?, uid?, template?, enabled?}
// type: 'discord' | 'bark' | 'gotify' | 'feishu' | 'serverchan' | 'wxpusher' | 'custom'
// token/uid only for wxpusher (its URL is fixed to the official endpoint); secret signs Feishu bodies
// and custom HMAC headers; template is optional ({{title}} {{body}} {{event}} {{time}} {{session}});
// enabled:false disables that one target
window.__dshNotifyMe.resetConfig()                // restore defaults (also drops any picked audio files)
window.__dshNotifyMe.decide("approval:3", "allowed-once")  // programmatic decision: "allowed-once" | "rejected"
window.__dshNotifyMe.testExternal()               // explicit outbound test to valid targets; resolves {sent, unverified, failed, statuses}
```

> **External-test switch boundary:** the settings page's "Send test notification" needs the "Enable reminders" and "External notifications" master switches on, but ignores the two per-kind forwarding switches. The console `testExternal()` call is an explicit test: with valid configured targets it sends to them even when those master switches are off; with no valid targets it sends nothing. Ordinary `test("done")` / `test("attention")` / `test("approval")` calls only test local alerts and never forward externally.

> Picked audio files do not live in `dshNotifyMe.config`: each kind gets its own key (`dshNotifyMe.sound.done` / `dshNotifyMe.sound.attention`, holding a `{name, size, data}` data URL), because one file inflates by ~1.37× once turned into a data URL and would slow down every config read. `resetConfig()` clears both keys along with the config.
>
> To confirm which source is actually in effect, check `soundDone` / `soundAttention` and `customSoundDone` / `customSoundAttention` in `window.__dshNotifyMe.debug()`.
>
> `debug().hostBridge` is the read-only snapshot of host coordination: `state` (`idle` the probe has not answered yet; `active` the host has a fallback and this page is holding the lease with its heartbeat; `unavailable` the host is there but offers no fallback, which is what a stock install looks like — an unregistered 404 route counts here too and is not a fault; `error` the host answered nothing usable, or the gate refused this page outright), `leaseMs` (the lease the host granted, in milliseconds), `relayEnabled` and `relayPath` (the relay route, when the host enabled one), `lastReason` (why the last probe failed — `bad-host` / `cross-origin` / `http-403` — and `null` when it was not a fault), and `lastProbeAt` / `lastBeaconAt` (the last probe and the last heartbeat, as ISO strings or `null`). A gate refusal reads as `error` rather than as "off", because it is a configuration the user can fix: add this page's origin to the top-level `allowedOrigins` of the `- id: notify-me` entry in the profile.

</details>

## How it works

The reminder core watches session state and pending interactions; approval decisions happen in the page, and Desktop window raising goes through a host route plus native Win32 activation on Windows, and through the `dsh://open` deep link on macOS / Linux.

<details>
<summary>Event sources and graceful degradation</summary>

The reminder core picks its interaction source per host generation (see the table above); the current session always comes from the client `sessions` service:

- **The current session's** `SessionSnapshot`: a `running: true → false` edge means a reply finished;
- **pending interactions**: a new key in `uiSession`'s `sessionStatus` (`>= 0.1.6`, per-session `pendingInteraction`) or in `pendingInteractions` (`0.1.2 .. 0.1.5`) means the agent is waiting on you — the container carries the approval tool name / reason or the question text; older hosts fall back to the controller snapshot's `pending[]`;
- **Every other listed session's** summary: a `running: true → false` edge (or the legacy `completed` edge) alerts you about background work. The host's completion-unread level flag covers gaps and owns the title marker: `completionUnread` on `sessionStatus` rows on `>= 0.1.6` (lit when a background session finishes, cleared when it is opened / starts running again / disappears), the list row's `completed` reminder bit on older hosts (cleared on select). It re-reports a completion edge the page never saw (a plugin hot reload mid-turn, a snapshot merge that jumps) exactly once, and when the edge and the level flag arrive together a short window collapses them into a single alert;
- **Subagent sessions**: **background** rows carrying `origin: 'subagent'` (and a `parentId`) are muted by default; the subagent session you have open is not muted — its alerts follow the normal current-conversation rules (tab marker only while the page is visible by default, delivered once backgrounded), outstanding waits are caught up when you switch in, and it goes back to muted when you switch away. A fork has a `parentId` but no `origin`, is your own conversation, and keeps alerting as usual.

The reminder core still has zero third-party runtime dependencies and is fully self-contained: notification copy resolves at alert time from the chosen language (follow the interface / Simplified Chinese / English). The Settings page is an **optional** React surface — it only registers into Settings → Notify me when the DSH web profile provides `slots` / `locale` / `react`; missing any of them, the plugin degrades gracefully to alerts-only (no Settings page), with no functional loss.

</details>

### Quick decisions, and how they reach the agent

Notifications with Approve / Reject buttons can only be raised by a Service Worker (passing `actions` to `new Notification()` throws a `TypeError` outright), so the same bundle file is registered a second time as a worker whose only job is relaying which button was clicked back to the page. **The decision still happens in the page**, through the same `PendingApproval.answer('allowed-once' | 'rejected')` the approval panel uses for Allow once / Reject — so "Approve" is exactly "Allow once" and releases nothing extra.

<details>
<summary>Button-toast bookkeeping and window raising</summary>

Each button toast is booked against its interaction key, and one toast claims only one wait; once the request has been answered in the page, or replaced by a newer request, clicking the leftover buttons decides nothing and just closes it quietly. Button toasts carry no auto-dismiss timer — they stay until you click or answer; plain toasts close after 5 s, and a desktop approval toast without buttons after 12 s. With "never close" selected neither kind closes itself. If you miss the click, the approval in the conversation is still waiting for you.

The "raise a window and switch its conversation" part of a body click is scheduled on the worker half as well: `client.focus()` raises exactly one window (a visible one first) and routes the conversation switch to that window alone, so several DSH tabs never fight over focus or all switch at once.

</details>

### How the Desktop window gets raised

DSH Desktop is a thin Electron shell and its page lives under `dsh-app://app`: DOM `window.focus()` only moves the browsing-context window and never touches the native one, and the shell's `will-navigate` closes the usual page-side exit of firing a `dsh:` URL. The plugin therefore takes two channels by platform: on Windows it uses its own host route — the page POSTs `/__dsh-notify-me/focus-window`, the host spawns `powershell.exe` to run `lib/focus-window.ps1`, which enumerates native windows and activates one adaptively; on macOS / Linux it uses the shell's own `dsh://open` deep link — the page navigates a hidden iframe to `dsh://open` inside the click gesture (subframe navigation bypasses the shell's top-level `will-navigate` interception), which reaches the system protocol registration, and the shell's `second-instance` / `open-url` handler restores, shows, and focuses the main window. On Windows that deep link retested 3/3 ineffective on `0.2.1-rc.2`, so 1.14.0 moved Windows to the host route; on Linux (Plasma 6.8 / Wayland) it is measured to raise a minimized or background window back to the front, and macOS is untested.

<details>
<summary>The route, the raise order, the measurements, and the security gate</summary>

On Windows the host route works like this: the shell forwards every path under `dsh-app://app` other than static assets straight to the host HTTP server (with an origin check and the host cookie injected), so that POST is a same-origin request with no CORS involved; the host half (`lib/index.js`) already runs as a child of the Electron main process, so `process.ppid` is the browser process that owns the main window. On a toast click: the page POSTs → the host spawns one `powershell.exe` running `lib/focus-window.ps1 -ProcessId <ppid>` → the script enumerates that pid's visible, owner-less, non-toolwindow top-level windows (preferring class `Chrome_WidgetWin_1`, then the largest area from `GetWindowRect`) → activates adaptively → compares `GetForegroundWindow()` and prints `FOCUSED=1|0` → the host answers `200` / `202`.

On Windows the raise order is adaptive: already in front means do nothing (the common case, zero flicker); minimized means `SW_RESTORE` first; then a synthetic Alt tap (`keybd_event` down/up) grants the calling thread foreground permission before `SetForegroundWindow`; only if all of that fails does it fall back to `SW_MINIMIZE` + `SW_RESTORE`. `SetForegroundWindow` on its own gets refused by the foreground lock — per call, unrelated to `ForegroundLockTimeout`. That also re-reads why the 1.5.2 deep-link approach was "sometimes it works": the times the window did come forward were most likely the OS activating the app on the click itself.

Measured with `powershell.exe` 5.1 in one round: window in front ×3, minimized with Notepad in front ×3, visible but covered ×3 — all `FOCUSED=1` with the foreground comparison matching and every `IsIconic` flipped back from `true` to `false`; Notepad maximized covering it completely, minimized plus fully covered, and `-ProcessId 0` auto-detection all succeeded too. Script-internal time peaked at 434 ms, process start to exit at 782 ms, well inside the 8 s cap; `pwsh` 7.6 behaved the same in a control round, only ~100 ms slower compiling the `Add-Type` helpers (the script deliberately avoids PowerShell 7 syntax). A pid that does not exist and a pid with no visible window both settle on `FOCUSED=0` with `exit 0`.

Security-wise the plugin opens exactly one exact route. Requests outside the vocabulary are refused: anything other than GET / HEAD / POST answers `405` (including a preflight `OPTIONS`, and it never returns a CORS header), a non-Windows host (Web, macOS / Linux, plain Node) `501` (macOS / Linux use the deep link and never reach this route), and a missing `x-dsh-notify-me-focus: focus` header `403`.

That header is only a "this came from the page" marker, not the defence — a DNS-rebinding page is same-origin with the address it resolved, so it can send any custom header and triggers no preflight. The real gate is three checks: the peer address must be loopback, or exactly the address the listener itself is bound to; `Host` must be a loopback name (`127.0.0.1` / `localhost` / `[::1]`, port optional) or that same bind address, because the shell deletes `host` when forwarding and fetch refills it from the URL it dialled, while a rebound page still has the attacker's domain in `Host`; and an `Origin`, when present, must be same-origin with that `Host`. Any failure answers `403`, with `reason` set to `bad-remote` / `bad-host` / `cross-origin`. A `GET` returns only `{ok, route, enabled, desktop, platform}`, so after installing you can open it in a browser to confirm the route is there. Calls within 400 ms coalesce into one, and a script that has not answered after 8 s is killed and counted as a failure.

The cases where it will not raise are the same ones listed under [Known limitations](#known-limitations) (elevated window, another virtual desktop, a foreground repeatedly stolen, a window hidden to the tray with `SW_HIDE`); they all answer `202` truthfully and the conversation switch still happens.

</details>

## Known limitations

**Runtime prerequisites**

- By default alerts only fire while the page is open (a background tab / minimized is fine; closing the tab stops it — inherent to a browser-layer plugin). With host-side fallback enabled you still get **external push** while the page is closed: it needs `hostFallback.enabled: true`, `gateway.target` (or `hostFallback.target`) and a mode-0600 credentials file in the profile, and the host process itself running.
- Notifications come through the browser, so notification permission must be granted; the first sound / toast after each page load needs one click on the page first; without permission only the sound and the title marker are left.
- System notification banners are drawn on the primary display only: Windows has no setting and Chromium no API to aim one at another monitor (on a multi-monitor setup the second screen never gets them). The only way across screens is external push to your phone (since 1.12.0 the page no longer draws an approval card).
- Config lives in browser `localStorage`: switching browsers / devices or clearing site data returns to the defaults (the Settings page restores them in one click).

**Platform differences**

- Quick-decision buttons need a Service Worker: `http://127.0.0.1` and `https` work, `http://192.168.x.x`-style LAN addresses do not; **the Desktop (`dsh-app://`) is tested and cannot register a Service Worker** (the host does not grant the `allowServiceWorkers` privilege), so approval toasts fall back to their buttonless form. When the host renders no notification buttons, the `bridge` field of `debug()` explains why, and nothing else is affected.
- Windows caps a toast tag at 64 characters, and Chromium hands the platform the whole `n#<origin>#<tag>` string — the desktop page's `dsh-app://app` alone takes 16. The plugin sizes each tag against the current `location.origin` and, when it does not fit, keeps a readable prefix and swaps the tail for a short hash, so a tag seen through `debug()` may be shortened; if the platform still refuses one, its message lands in `debug().lastToastReject` and the settings test button reports it instead of claiming the toast was sent.
- On Desktop (Windows) a toast click can still fail to raise the window: when the target window is owned by a higher integrity level (elevated / UAC), sits on another virtual desktop, has its foreground repeatedly stolen by another process, or is hidden to the tray with `SW_HIDE`, the host script answers `FOCUSED=0` and the route answers `202`, with the conversation switch intact (see [How the Desktop window gets raised](#how-the-desktop-window-gets-raised)).
- Desktop (macOS / Linux) toast clicks rely on the `dsh://open` deep link: when the system has no `x-scheme-handler/dsh` registration, or the shell has no `second-instance` / `open-url` handling, the window will not raise. Measured to work on Linux; macOS is untested.
- macOS: alerts, sound, the title marker and toast-click navigation carry no platform assumptions and work as usual; but DSH Desktop (Electron) system notifications require the app to be signed — an unsigned build simply emits no notification — and whether the official macOS build meets that precondition is untested; notification button rendering on the macOS desktop host is likewise untested (the Windows desktop host is tested and renders none).

**Alert content and timing**

- On `>= 0.1.6` (including `0.2.0-rc.2`, `0.2.1-rc.2`) the "reply finished" alert body carries only the session name and no reply snippet any more — host snapshots no longer provide `nodes`; the alert itself still fires as usual.
- The title marker is written into `document.title` alongside the host: when the host recomputes the title the marker can be overwritten until the next alert event writes it again.
- "Stay quiet for the conversation on screen" is judged by whether the window is in front: covered by another app, switched to another app, or minimized all count as background; back in front or with fresh keyboard / mouse input it goes quiet again.

**External push**

- Bounded by browser CORS: an endpoint that does not allow cross-origin degrades to "sent but unverifiable" (no-cors) and is labelled as such; Discord, Feishu, ServerChan and WxPusher do allow cross-origin, so delivery to them is confirmed. DingTalk allows no CORS header at all and only accepts `application/json`, so a page cannot send to it — hence no DingTalk target type (relay it through your own box and use a custom target). A transient failure (network error, 5xx, 429) is retried on the backoff, and a delivery that still fails lands in the failure log; anything else stops at once, no retry. Forwarding is triggered only after the local alert has decided to fire, so an alert muted by the rules is never sent out either.
- The same-origin relay closes exactly one of those gaps — a page reaching a gateway that wants authentication: the page POSTs to a same-origin route, the host adds the credentials and answers with the gateway's real status. What still holds: both the relay and the host-side fallback need the host process running (`dsh web` or the Desktop main process) — neither is a standalone daemon, so quitting the host stops both; on a host behind a proxy the gateway host has to be in `no_proxy`, or the delivery leaves through the proxy instead; the fallback only covers external push, so local toasts, sound, the title marker and the approval buttons still need the page; `pageLeaseMs: 0` is a debugging switch that gets an open page everything twice; and the relay path is a password, so keep it out of public records.

**Settings icon patch**

- The sidebar row icon relies on a DOM patch: the shell hard-codes an icon per section id and `settings.section` has no icon field, so the plugin can only swap that row's `<svg>` for a bell after the panel renders. It hinges on the host's current panel structure (`data-shortcut-modal="settings"` plus a label `<span>` inside the nav button); if DSH changes that structure it silently falls back to the default gear and nothing else is affected. The logo and naming decisions are in [docs/brand/README.md](docs/brand/README.md).

## Development

```sh
node --check lib/client.js
node --check lib/index.js
npm test                         # smoke-test (state machine) + host-route-test (host half) + page-bridge-test + host-fallback-test + relay-route-test + cordis-host-test
npm pack --dry-run               # preview the published tarball
```

`smoke/smoke-test.cjs` is the offline state-machine suite: three host generations + master switch + zh/en cases + the quick-decision bridge (worker half included) + idle detection and toast self-dismiss + toast tag length handling + the page's host-bridge probe / heartbeat / release and the shape of `debug().hostBridge`. `smoke/host-route-test.mjs` needs no local DSH and runs the `lib/index.js` route, its probe and the 403/405/501 gate on every platform.

The three new suites also ship their own fake `ctx`, need no local DSH and touch no network: `smoke/page-bridge-test.mjs` runs the page-bridge route — status shape, heartbeat and release, missing intent header `403`, cross-origin `403`, bad JSON `400`, oversized `413`, the `allowedOrigins`-derived `Host` (a simulated tunnel) being let through, and path collisions; `smoke/host-fallback-test.mjs` runs the host fallback — approval dedupe, `turn/end` throttling, subagent skip, no push on a fresh lease, a push after the lease expires, an immediate push after `alive:false`, language following the heartbeat, credentials re-read after a 401, and the health probe; `smoke/relay-route-test.mjs` runs the relay — the `GET` probe, `405`, cross-origin `403`, `413`, `400`, `503`, the `200` / `502` mapping and "retry exactly once on a 401".

When `lib/focus-window.ps1` changes (Windows only), also run it by hand:

```powershell
powershell -NoProfile -File lib/focus-window.ps1 -ProcessId 0   # the last line should be FOCUSED=1
```

`cordis-host-test.mjs` borrows `@deepseek-ai/cordis` from a local DSH installation (it probes the global npm directory, `~/.dsh/profiles/web/node_modules` and the flat fallback `~/.dsh/profiles/node_modules` in turn); in a source checkout with no profile dependencies, point it there with `DSH_CORDIS_PATH=<checkout>/vendor/cordis/lib/index.js`.

## Credits & how contributions land

| Contributor | Contribution |
|:---:|:---|
| <a href="https://github.com/AgMahone"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/AgMahone.png" width="40" height="40" alt="@AgMahone"></a> | [#7](https://github.com/chromoany/dsh-notify-me/pull/7): the 0.1.6+ / 0.2.0 host-generation compatibility reports and retesting |
| <a href="https://github.com/d0ublecl1ck"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/d0ublecl1ck.png" width="40" height="40" alt="@d0ublecl1ck"></a> | [#8](https://github.com/chromoany/dsh-notify-me/pull/8): muting subagent sessions (`ignoreSubagent`), with tests and docs |
| <a href="https://github.com/EliteOtaku"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/EliteOtaku.png" width="40" height="40" alt="@EliteOtaku"></a> | [#9](https://github.com/chromoany/dsh-notify-me/issues/9): the layer-by-layer investigation of the desktop raise path, retested in a real shell |
| <a href="https://github.com/Wh1stle05"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/Wh1stle05.png" width="40" height="40" alt="@Wh1stle05"></a> | [#10](https://github.com/chromoany/dsh-notify-me/pull/10): per-kind sound sources (built-in cue / custom audio file / system notification sound) |
| <a href="https://github.com/yanzhaohui1999"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/yanzhaohui1999.png" width="40" height="40" alt="@yanzhaohui1999"></a> | [#13](https://github.com/chromoany/dsh-notify-me/issues/13) / [#14](https://github.com/chromoany/dsh-notify-me/pull/14): the idle-page CPU report and fix for busy session lists |
| <a href="https://github.com/RiZhiZhaoYi"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/RiZhiZhaoYi.png" width="40" height="40" alt="@RiZhiZhaoYi"></a> | [#12](https://github.com/chromoany/dsh-notify-me/issues/12): external notification forwarding (Discord / Bark / Gotify / custom webhook) |
| <a href="https://github.com/yuexian7"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/yuexian7.png" width="40" height="40" alt="@yuexian7"></a> | [#17](https://github.com/chromoany/dsh-notify-me/issues/17): the ask for Android delivery, which led to the Feishu / ServerChan / WxPusher targets |
| <a href="https://github.com/shrekcg"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/shrekcg.png" width="40" height="40" alt="@shrekcg"></a> | [#16](https://github.com/chromoany/dsh-notify-me/pull/16): away detection (`idleMinutes`), reply-done routing (`donePolicy`), auto-dismiss (`autoDismiss`) |
| <a href="https://github.com/Donald-Yip"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/Donald-Yip.png" width="40" height="40" alt="@Donald-Yip"></a> | [#18](https://github.com/chromoany/dsh-notify-me/issues/18): the report that a Windows notification tag over the 64-character cap made the platform silently reject the approval test toast |
| <a href="https://github.com/dunxuan"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/dunxuan.png" width="40" height="40" alt="@dunxuan"></a> | [#20](https://github.com/chromoany/dsh-notify-me/issues/20): the report that alerts for the open session showed a placeholder instead of the session title |
| <a href="https://github.com/unnamed42"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/unnamed42.png" width="40" height="40" alt="@unnamed42"></a> | [#21](https://github.com/chromoany/dsh-notify-me/issues/21) / [#22](https://github.com/chromoany/dsh-notify-me/pull/22): the Linux `dsh://open` raise-path report and patch, which brought the deep link back on macOS / Linux in 1.14.4 |

Attribution policy: external PRs are landed as maintainer commits — the original commit is not reused and no Co-authored-by trailer is added, so GitHub's contributors graph lists the maintainer only and contributors are credited above.

## License

MIT — see [LICENSE](LICENSE).
