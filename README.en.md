# dsh-notify-me

[简体中文](README.md) | English

[![npm version](https://img.shields.io/npm/v/dsh-notify-me?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-notify-me)
[![npm downloads](https://img.shields.io/npm/dm/dsh-notify-me?style=flat-square&label=downloads&color=1F883D)](https://www.npmjs.com/package/dsh-notify-me)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-browser-blue)
![Size](https://img.shields.io/badge/bundle-%7E37KB-green)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

---

**Step away from the DeepSeek Harness web UI — and still know what's going on.** When the agent stops and needs your input, or when a reply finishes in the background while you're in another app, dsh-notify-me alerts you with a Windows desktop notification, a sound, and a tab-title marker. Toggle it and pick the notification language right from **Settings → Notify me**.

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

| Windows system notification |
| --- |
| ![DSH notification](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/notify-toast.png) |

[Changelog](CHANGELOG.md)

## What it alerts about

| When | What you get | Default |
| --- | --- | --- |
| 🔔 **The agent needs your input** — sandbox approval / plan review / a question (`ask_user_question`) | Toast + sound + `🔔 Action needed ·` title marker | Alerts even while the page is visible |
| ✅ **A reply finishes** — a turn completes; background sessions finishing are also reported | Toast + sound | Alerts only while the page is hidden / backgrounded |

## Configure it from DSH Settings

Open **Settings → Notify me** (refresh the page once after installing):

- **Enable reminders** — master switch; when off, no toasts, no sounds and the tab title is never touched;
- **System notifications / Sound / Volume** — toast toggle, WebAudio beep toggle and a volume slider;
- **"Needs you" alerts while the page is open** (default on) and **"Reply finished" alerts while the page is open** (default off);
- **Notification language** — follow the interface / 简体中文 / English: controls the language of the alert text and the `🔔 …` title marker;
- **Test buttons** — send one "needs you" or "reply finished" test alert with the current settings (**not** limited by the "while the page is open" toggles; the "needs you" test's title marker clears itself after ~6s).

> Notification permission is required: click once on the page → **Allow** (or address-bar lock → Site settings → Notifications → Allow → reload).

## How it alerts

- **System notification** — native notification-center toast (clicking it brings the DSH window back to front)
- **Sound** — WebAudio beeps (distinct patterns for "needs you" vs "done")
- **Tab title marker** — while something is waiting on you, the tab title is prefixed with `🔔 Action needed · …` / `🔔 需要你 · …`

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
| `<= 0.1.1-rc.2` | controller snapshot `pending[]` | snapshot `current` | `sessions.open()` |
| `0.1.2-alpha.2 .. 0.1.5-rc.3` | `uiSession.pendingInteractions` | snapshot `current` | `sessions.open()` |
| `>= 0.1.6-alpha.2` (incl. `0.2.0-rc.2`) | `uiSession.sessionStatus` | `retainedBy.mainView` | `uiWorkspace.openSession()` |

Verified to actually activate on `0.1.2-rc.1`, `0.1.5-rc.2` and `0.2.0-rc.2` (each booted in its own profile: the Settings → Notifications section registers, i.e. the plugin's `apply` really runs), and previously on `0.1.1-rc.2`. Two traps are worth remembering: a package listed in `dsh.client.inject` that a newer runtime no longer ships parks the client entry at `pending (waiting for services: …)` forever — which is what broke 1.1.3 on `0.1.2-rc.1` and later; and when the host renames a store or a field nothing throws, alerts just go **silent** — `0.2.0-rc.2` moved `pendingInteractions`→`sessionStatus`, `list.current`→`retainedBy.mainView` and `sessions.open()`→`uiWorkspace.openSession()`. So every adaptation must confirm `window.__dshNotifyMe.debug()` reports `bound` and which source answered.

**Verify** — open the DevTools console and run:

```js
window.__dshNotifyMe.test("done")        // "reply finished" sample
window.__dshNotifyMe.test("attention")   // "needs your input" sample
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
  doneHiddenOnly: true,       // false = also alert "reply finished" while visible
  toast: true,                // system-notification toggle
  sound: true,                // sound toggle
  volume: 0.5,                // 0..1
  autoFocus: true             // clicking the toast focuses the DSH window
})
window.__dshNotifyMe.resetConfig()                // restore defaults
```

## How it works

The reminder core picks its interaction source per host generation (see the table above); the current session always comes from the client `sessions` service:

- the **selected session's** `SessionSnapshot`: a `running: true → false` edge means a reply finished;
- **pending interactions**: a new key in `uiSession.sessionStatus` (`>= 0.1.6`, per-session `pendingInteraction`) or in `pendingInteractions` (`0.1.2 .. 0.1.5`) means the agent is waiting on you — approval requests carry the tool name and reason, questions their text; older hosts fall back to the controller snapshot's `pending[]`;
- **every other listed session's** summary: a `running: true → false` edge (or the legacy `completed` flag) alerts you about background work.

The reminder core stays dependency-free and self-contained: notification copy resolves at alert time from the chosen language (follow-interface / Simplified Chinese / English). The Settings page is an **optional** React surface — it only registers into Settings when the web profile provides the `slots` / `locale` services and `react`; without them the plugin degrades gracefully to alerts-only (no Settings page).

## Known limitations

- The page must be open for alerts to fire (background tab / minimized is fine; closing the tab stops it — that's inherent to a browser-layer plugin).
- Notifications appear through the browser, so the browser needs "show notifications" permission in Windows settings, and notification-center "Do Not Disturb" must not suppress them.
- The first sound/toast of each page load needs one user click on the page first (browser autoplay + permission policy).
- Toasts are only produced once the notification permission is granted; declining means sound + title marker only.
- Config lives in browser `localStorage`: switching browsers/devices or clearing site data returns to defaults (one-click restore in the Settings page).
- On `>= 0.1.6` (including `0.2.0-rc.2`) the "reply finished" toast body carries only the session label, no assistant snippet: host snapshots no longer expose `nodes`. The alert itself still fires.
- The title marker is written into `document.title` alongside the host: when the host recomputes the title it can overwrite the marker until the next alert event rewrites it.

## Development

```powershell
node --check lib\client.js
node --check lib\index.js
node smoke\smoke-test.cjs        # offline state-machine test: three host generations + master switch + zh/en cases
node smoke\cordis-host-test.mjs  # real-cordis end-to-end (skips when no local DSH installation is found)
npm pack --dry-run               # preview the published tarball
```

`cordis-host-test.mjs` borrows `@deepseek-ai/cordis` from a local DSH installation; in a source checkout with no profile dependencies, point it there with `DSH_CORDIS_PATH=<checkout>/vendor/cordis/lib/index.js`.

## License

MIT — see [LICENSE](LICENSE).
