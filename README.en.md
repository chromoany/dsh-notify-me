# dsh-notify-me

[简体中文](README.md) | English

[![npm version](https://img.shields.io/npm/v/dsh-notify-me?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-notify-me)
[![npm downloads](https://img.shields.io/npm/dm/dsh-notify-me?style=flat-square&label=downloads&color=1F883D)](https://www.npmjs.com/package/dsh-notify-me)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-browser-blue)
![Size](https://img.shields.io/badge/bundle-%7E79KB-green)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

---

**Step away from the DeepSeek Harness web UI — and still know what's going on.** When the agent stops and needs your input, or when a reply finishes in the background while you're in another app, dsh-notify-me alerts you with a desktop notification, a sound, and a tab-title marker. Approval notifications even carry Approve / Reject buttons, so you can settle the request without switching back. Toggle it and pick the notification language right from **Settings → Notify me**.

---

## Why you need it

Both of DSH's permission modes cost you something:

| Mode | What it costs you | Cost type |
| --- | --- | --- |
| No full access (`workspace-write` + ask) | **Waiting** — the agent stops on an approval; if you aren't watching the page, you're just burning wall-clock time | Time, growing with the number of sessions |
| Full access | **Irreversible risk** — you give up the ability to intercept before anything happens | Risk, independent of whether you watch |

dsh-notify-me decouples **supervision** from **sitting in front of the screen**: it pulls you back with a system notification only when a decision is genuinely needed (approval / plan review / question) or a reply finishes — **so you can afford to keep full access off** instead of trading away interception for speed. It does not lower the risk of full access itself (it is not a sandbox); it just drives the waiting cost of ask-mode down to roughly zero.

---

> 🔎 Looking for it? Search `dsh-notify-me`, **message alerts**, **notification**, **desktop notification**, **reminder**, **approval alert** or **可操作提醒 / 消息提醒 / 桌面通知 / 需要你操作** (npm keywords include both English and Chinese terms).

## UI Preview

| System notification (screenshot from Windows) |
| --- |
| ![DSH notification](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/notify-toast.png) |

[Changelog](CHANGELOG.md)

## What it alerts about

| When | What you get | Default |
| --- | --- | --- |
| 🔔 **The agent needs your input** — sandbox approval / plan review / a question (`ask_user_question`) | Toast + sound + `🔔 Action needed ·` title marker; approval toasts also carry Approve / Reject buttons | Alerts even while the page is visible (the conversation on screen is the exception: tab marker only by default) |
| ✅ **A reply finishes** — a turn completes; background sessions finishing are also reported | Toast + sound; while a background session is **finished but unread** the tab title carries a `✅ Reply finished ·` marker, gone once you open that session | Alerts only while the page is hidden / backgrounded (the title marker is not gated by this) |

> **Background** subagent child sessions are **not** alerted about by default: DSH lists each of them as its own session, but they are steps inside the parent conversation's turn, so an alert for them is only noise. The subagent session you have open is not part of this and alerts as usual. Settings → "Ignore subagent sessions" turns the mute off.

## Configure it from DSH Settings

Open **Settings → Notify me** (refresh the page once after installing):

- **Enable reminders** — master switch; when off, no toasts, no sounds and the tab title is never touched;
- **Environment** (auto-detect by default) — identifies Web vs Desktop (DSH Desktop, `dsh-app://`) from the page protocol, with a manual override for hosts where detection comes out wrong: on the Desktop a toast click rides the `dsh://` deep link to raise the window and quick-decision buttons are unavailable; on the Web it is `window.focus()` plus the Service Worker bridge. Whenever the override disagrees with detection, the settings page says what detection saw;
- **System notifications / Sound / Volume** — toast toggle, cue toggle and a volume slider;
- **Alert sound** (picked separately for "needs you" and "reply finished") — built-in cue (default) / custom audio file / system notification sound. "Custom audio file" takes one local audio file in the settings page (1 MiB limit, stored in the browser, with preview and remove); "system notification sound" plays no plugin cue at all — the toast still appears and the operating system supplies the sound, so its timbre follows your system notification settings; in that mode "Preview" sends a test alert instead, because the sound only exists as part of a toast and that is the sound you hear. Any source that has no file, cannot be read, or does not fit falls back to the built-in cue, so an alert never goes silent;
- **"Needs you" alerts while the page is open** (default on) and **"Reply finished" alerts while the page is open** (default off);
- **Stay quiet for the conversation on screen** (default on): a wait inside the conversation you are looking at keeps only the tab marker — no toast or sound landing on the approval card. Backgrounding the page puts that alert back at once, unless you already handled it. Waits in other background sessions are unaffected;
- **Ignore subagent sessions** (default on): background subagent child sessions raise neither "needs you" nor "reply finished" — those are steps of the parent conversation's turn, and the parent's own alert already covers them. The subagent session you have open alerts as usual. Turn it off to alert for every session;
- **Click a toast to open that conversation** (default on): clicking brings DSH to the front and switches to the conversation the alert came from. With several DSH tabs open, one click raises exactly one window (a visible one first) and switches only that one — the others stay put; when off, clicking a toast does nothing. On the Desktop (DSH Desktop) the click likewise raises the window and switches conversations: page-side `window.focus()` cannot raise a native Electron window, so since 1.5.2 the plugin rides the app's own `dsh://open` deep link instead (a window hidden to the tray comes back too);
- **Decide approvals from the toast** (default on): approval notifications carry Approve / Reject buttons, and one click settles the request exactly like the Allow once / Reject buttons on the approval card. Clicking the toast body still takes you back to the conversation. **Buttons are unavailable on the Desktop** (`dsh-app://` pages cannot register a Service Worker): approval toasts fall back to their buttonless form there, and the settings page says so;
- **Notification language** — follow the interface / 简体中文 / English: controls the language of the alert text and the `🔔 …` title marker;
- **Test buttons** — send one "needs you", "reply finished" or "approval buttons" test alert with the current settings (**not** limited by the "while the page is open" toggles; the "needs you" test's title marker clears itself after ~6s);
- **Version info** — the settings page always shows the installed plugin version at its foot (`dsh-notify-me v…`); quote that line in bug reports or to check which build you are on.

> Notification permission is required: click once on the page → **Allow** (or address-bar lock → Site settings → Notifications → Allow → reload). On macOS, also allow the browser under System Settings → Notifications.

## How it alerts

- **System notification** — a toast through the browser into the Windows action center / macOS Notification Center (clicking it opens the conversation it came from; approval toasts can be decided straight from the buttons)
- **Sound** — WebAudio beeps by default (distinct patterns for "needs you" vs "done"); each kind can instead play a picked audio file, or hand the sound over to the operating system's own notification sound
- **Tab title marker** — while something is waiting on you, the tab title is prefixed with `🔔 Action needed · …` / `🔔 需要你 · …`; while a background session is **finished but unread**, with `✅ Reply finished · …` / `✅ 回复完成 · …`, gone once you open that session (or it starts running again). Both kinds can be up together, "needs you" first; a host title change is rebased under the markers

This is a **browser-layer** plugin: the DSH page must stay open (minimized or backgrounded is fine — that's exactly the "away" state it watches for).

## Installation

```powershell
# Official DSH plugin command — installs and auto-mounts into the web profile
dsh plugin --profile web add dsh-notify-me
```

Restart `dsh web`, then hard-refresh the page (Ctrl+Shift+R).

**Compatibility** — the plugin picks its interaction source per host generation; per-release declarations live in `package.json` under `dsh.compatibility.dshReleases`:

| Host generation | "Needs you" interaction source | Current session | Toast-click navigation |
| --- | --- | --- | --- |
| `<= 0.1.2-alpha.1` | controller snapshot `pending[]` | snapshot `current` | `sessions.open()` |
| `0.1.2-alpha.2 .. 0.1.6-alpha.1` | `uiSession.pendingInteractions` | snapshot `current` | `sessions.open()` |
| `>= 0.1.6-alpha.2` (incl. `0.2.0-rc.2`) | `uiSession.sessionStatus` | `retainedBy.mainView` | `uiWorkspace.openSession()` |

The ranges are illustrative: the plugin picks its source by store shape (whenever `sessionStatus` exists it takes the new path); the version numbers only mark where each shape appeared. The `peerDependencies` range in `package.json` likewise only shapes npm's install warning — compatibility is declared per release in `dshReleases` after real testing, and untested new versions fall back to shape-driven behaviour.

Verified to actually activate on `0.1.2-rc.1`, `0.1.5-rc.2` and `0.2.0-rc.2` (each booted in its own profile: the Settings → Notifications section registers, i.e. the plugin's `apply` really runs), and previously on `0.1.1-rc.2`. Two traps are worth remembering: a package listed in `dsh.client.inject` that a newer runtime no longer ships parks the client entry at `pending (waiting for services: …)` forever — which is what broke 1.1.3 on `0.1.2-rc.1` and later; and when the host renames a store or a field nothing throws, alerts just go **silent** — `0.2.0-rc.2` moved `pendingInteractions`→`sessionStatus`, `list.current`→`retainedBy.mainView` and `sessions.open()`→`uiWorkspace.openSession()`. So every adaptation must confirm `window.__dshNotifyMe.debug()` reports `bound` and which source answered.

**Verify** — open the DevTools console and run:

```js
window.__dshNotifyMe.test("done")        // "reply finished" sample
window.__dshNotifyMe.test("attention")   // "needs your input" sample
window.__dshNotifyMe.test("approval")    // "approval buttons" sample: try the Approve / Reject buttons on the toast
window.__dshNotifyMe.debug()             // the bridge field reports the button channel: "active" = buttons work
```

Nothing happened? 90% of the time it's one of:

- the notification permission was declined — click anywhere on the page and choose **Allow** (address-bar lock → Site settings → Notifications → Allow → reload);
- the DSH process wasn't restarted after install;
- your OS/browser notification settings block the browser's toasts.

## Advanced: console configuration

The Settings page is the primary entry; preferences live in `localStorage` (key `dshNotifyMe.config`) and can be scripted from the console:

```js
window.__dshNotifyMe.config                       // view current config
window.__dshNotifyMe.setConfig({
  enabled: true,           // false = disable all reminders (master switch)
  language: "auto",        // 'auto' follow the UI | 'zh' | 'en'
  attentionHiddenOnly: false, // true = don't alert "needs you" while the page is visible
  currentHiddenOnly: true,    // true = waits in the conversation on screen keep only the tab marker (replayed once backgrounded)
  doneHiddenOnly: true,       // false = also alert "reply finished" while visible
  ignoreSubagent: true,       // true = never alert for background subagent sessions (the open one is exempt)
  toast: true,                // system-notification toggle
  sound: true,                // cue toggle (also governs the "system notification sound" mode)
  soundDone: "synth",         // "reply finished" cue source: 'synth' built-in | 'custom' picked file | 'system' OS sound
  soundAttention: "synth",    // "needs you" cue source, same values
  volume: 0.5,                // 0..1
  autoFocus: true,            // clicking a toast opens the conversation it came from
  quickActions: true          // Approve / Reject buttons on approval toasts
})
window.__dshNotifyMe.resetConfig()                // restore defaults (also drops any picked audio files)
window.__dshNotifyMe.decide("approval:3", "allowed-once")  // programmatic decision: "allowed-once" | "rejected"
```

> Picked audio files do not live in `dshNotifyMe.config`: each kind gets its own key (`dshNotifyMe.sound.done` / `dshNotifyMe.sound.attention`, holding `{name, size, data}` with a data URL), because a file inflates by ~1.37x once base64-encoded and would slow down every config read. `resetConfig()` clears both keys along with the config.
>
> To see which source is live, check `soundDone` / `soundAttention` and `customSoundDone` / `customSoundAttention` in `window.__dshNotifyMe.debug()`.

## How it works

The reminder core picks its interaction source per host generation (see the table above); the current session always comes from the client `sessions` service:

- the **selected session's** `SessionSnapshot`: a `running: true → false` edge means a reply finished;
- **pending interactions**: a new key in `uiSession.sessionStatus` (`>= 0.1.6`, per-session `pendingInteraction`) or in `pendingInteractions` (`0.1.2 .. 0.1.5`) means the agent is waiting on you — approval requests carry the tool name and reason, questions their text; older hosts fall back to the controller snapshot's `pending[]`;
- **every other listed session's** summary: a `running: true → false` edge (or the legacy `completed` flag) alerts you about background work. The host's completion-unread level flag backs that edge up and owns the title marker: `sessionStatus` rows' `completionUnread` on `>= 0.1.6` (lit when a background session finishes, cleared when it is opened / re-runs / disappears), the list row's `completed` reminder bit on older hosts (cleared on select). It re-reports a completion whose edge this page never saw (a plugin remount mid-turn, coalesced snapshots) exactly once, and when both views of one completion arrive together a short window collapses them into a single alert.
- **subagent sessions**: **background** rows carrying `origin: 'subagent'` (and a `parentId`) stay muted by default. The subagent session you have open is exempt — its alerts follow the normal current-conversation rules (tab marker only while the page is visible, delivered on background), its outstanding waits are picked up when you switch into it, and switching away mutes them again. A fork has a `parentId` but no `origin`, is your own conversation, and keeps alerting throughout.

The reminder core stays dependency-free and self-contained: notification copy resolves at alert time from the chosen language (follow-interface / Simplified Chinese / English). The Settings page is an **optional** React surface — it only registers into Settings when the web profile provides the `slots` / `locale` services and `react`; without them the plugin degrades gracefully to alerts-only (no Settings page).

### Quick decisions, and how they reach the agent

Action buttons (`actions`) belong to persistent notifications shown through `ServiceWorkerRegistration.showNotification()`; passing `actions` to the `new Notification()` constructor throws a `TypeError`. That is a browser rule no plugin can route around, so the bundle holds two jobs in the same bytes: the page half registers the reminder factory as it always did, and the very same file is registered as a Service Worker whose only task is relaying which button was clicked back to the page. The decision itself happens in the page, through the same `PendingApproval.answer('allowed-once' | 'rejected')` the approval card uses — which is why "Approve" is exactly "Allow once" and nothing broader. The "raise a window and switch its conversation" part of a body click is scheduled on the worker half too: `client.focus()` raises exactly one window (a visible one first) and routes the conversation switch to that window alone, so several open DSH tabs never fight over focus or all switch at once.

Every button toast is booked against its interaction key, so it can only decide the request it was raised for. Once the page answers that request or a newer one replaces it, clicking the leftover buttons decides nothing and just closes the notification. Button toasts also skip the auto-dismiss timer: an undecided approval stays in the notification center until you settle it.

### How the Desktop window gets raised

DSH Desktop is a thin Electron shell and its page lives under `dsh-app://app`: DOM `window.focus()` only touches the browsing-context window, never the native one, and the shell's `will-navigate` / window-open handlers block every ordinary way for the page to fire a `dsh://` URL — so through 1.5.1 a toast click switched the conversation in the background but never brought the window forward. Since 1.5.2 a body click navigates a hidden iframe to `dsh://open`: subframe navigations pass the shell's `will-navigate` interception, the URL reaches the OS protocol registration, and the app's single-instance owner runs its own `focusPrimaryWindow()` (restore + show + focus) — the same path the login completion page uses to bring the client forward. A window hidden to the tray, buried under others, or minimized all come back. Browsers are unaffected and still use `window.focus()` / the worker's `client.focus()`.

Verified on the real shell (DSH Desktop 0.2.0-rc.2, three rounds of retesting in issue #9): a toast click raises the window and switches the conversation in one step, stable across sessions and with the window in the background. Timing of the fire is what makes the chain work: the deep link must be launched from a **user-gesture handler** — the notification's `onclick` carries one, which is why the product path works — while gesture-less scripted injection (an iframe appended from a CDP evaluate, say) is silently dropped by Chromium and the external protocol never launches, which looks exactly like the channel being blocked.

## Known limitations

- The page must be open for alerts to fire (background tab / minimized is fine; closing the tab stops it — that's inherent to a browser-layer plugin).
- Notifications appear through the browser, so the browser needs "show notifications" permission in the OS notification settings, and notification-center "Do Not Disturb" must not suppress them.
- The first sound/toast of each page load needs one user click on the page first (browser autoplay + permission policy).
- Toasts are only produced once the notification permission is granted; declining means sound + title marker only.
- Quick-decision buttons need a Service Worker: they work on `http://127.0.0.1` and `https`, not on plain `http://192.168.x.x`-style LAN addresses, and some browsers or desktop hosts never render notification buttons. **The Desktop (`dsh-app://`) is tested and cannot register a Service Worker**, so buttons never render there and approval toasts fall back to their buttonless form. The `bridge` field of `window.__dshNotifyMe.debug()` says why; everything else keeps working.
- macOS: in the browser, alerts, sounds, the title marker and toast-click navigation carry no OS assumptions and work as on Windows. Two caveats: DSH Desktop (Electron) notifications require the app to be code-signed — unsigned builds simply emit no notification — and whether the official macOS build satisfies that is untested; and notification buttons on the macOS desktop host are likewise untested (the Windows desktop host is tested and renders none, see the line above), falling back to the buttonless form above.
- Config lives in browser `localStorage`: switching browsers/devices or clearing site data returns to defaults (one-click restore in the Settings page).
- On `>= 0.1.6` (including `0.2.0-rc.2`) the "reply finished" toast body carries only the session label, no assistant snippet: host snapshots no longer expose `nodes`. The alert itself still fires.
- The title marker is written into `document.title` alongside the host: when the host recomputes the title it can overwrite the marker until the next alert event rewrites it.
- "Stay quiet for the conversation on screen" is judged by `document.hidden`: a window fully covered by other apps still counts as visible, so waits in the current conversation stay quiet there too.

## Development

```powershell
node --check lib\client.js
node --check lib\index.js
node smoke\smoke-test.cjs        # offline state-machine test: three host generations + master switch + zh/en cases + the quick-decision bridge (worker half included)
node smoke\cordis-host-test.mjs  # real-cordis end-to-end (skips when no local DSH installation is found)
npm pack --dry-run               # preview the published tarball
```

`cordis-host-test.mjs` borrows `@deepseek-ai/cordis` from a local DSH installation (it probes the global npm directory, `~/.dsh/profiles/web/node_modules` and the flat fallback `~/.dsh/profiles/node_modules` in turn); in a source checkout with no profile dependencies, point it there with `DSH_CORDIS_PATH=<checkout>/vendor/cordis/lib/index.js`.

## Credits & how contributions land

Contributors (by handle; the link points at the PR / issue they worked on):

- [@AgMahone](https://github.com/AgMahone) — [#7](https://github.com/chromoany/dsh-notify-me/pull/7): the 0.1.6+ / 0.2.0 host-generation support, plus the double-chime and cordis-lookup reports and retesting;
- [@d0ublecl1ck](https://github.com/d0ublecl1ck) — [#8](https://github.com/chromoany/dsh-notify-me/pull/8): muting subagent sessions (`ignoreSubagent`) with its tests and docs; the 1.4.0 refinement — mute only background subagents, alert as usual for the one you have open — is his suggestion from the #8 discussion, landed by the maintainer;
- [@EliteOtaku](https://github.com/EliteOtaku) — [#9](https://github.com/chromoany/dsh-notify-me/issues/9): the layer-by-layer investigation and three rounds of real-shell retesting of the desktop raise path (1.5.2) — confirming that a toast click raises the window and switches conversations reliably, and pinning down the reproduction difference ("gesture-less scripted injection is silently dropped by Chromium"), which corrected the initial "the sandbox blocks it" reading.

Attribution policy: external PRs are landed as maintainer commits — the original commit is not reused and no Co-authored-by trailer is added, so GitHub's contributors graph lists the maintainer only and contributors are credited above.

## License

MIT — see [LICENSE](LICENSE).
