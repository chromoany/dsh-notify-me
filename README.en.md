# dsh-notify-me

[简体中文](README.md) | English

[![npm version](https://img.shields.io/npm/v/dsh-notify-me?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-notify-me)
[![npm downloads](https://img.shields.io/npm/dm/dsh-notify-me?style=flat-square&label=downloads&color=1F883D)](https://www.npmjs.com/package/dsh-notify-me)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-browser-blue)
![Size](https://img.shields.io/badge/bundle-%7E37KB-green)

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

**Compatibility** — verified on `0.1.1-rc.2` and `0.1.2-rc.1` (the latter booted in a separate profile; the plugin's client module lands in the boot manifest). Per-release declarations live in `package.json` under `dsh.compatibility.dshReleases`.

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

The browser half subscribes to the client `sessions` service — the same source the UI itself renders from:

- the **selected session's** `ConversationSnapshot`: a `running: true → false` edge means a reply finished; a new entry in `pending[]` of kind `approval` / `plan-review` / `question` means the agent is waiting on you (payload text is shown in the alert when available);
- **every other listed session's** summary: a new `pendingInteraction`, or the `completed` edge (finished while not selected), alerts you about background work.

The reminder core stays dependency-free and self-contained: notification copy resolves at alert time from the chosen language (follow-interface / Simplified Chinese / English). The Settings page is an **optional** React surface — it only registers into Settings when the web profile provides the `slots` / `locale` services and `react`; without them the plugin degrades gracefully to alerts-only (no Settings page).

## Known limitations

- The page must be open for alerts to fire (background tab / minimized is fine; closing the tab stops it — that's inherent to a browser-layer plugin).
- Notifications appear through the browser, so the browser needs "show notifications" permission in Windows settings, and notification-center "Do Not Disturb" must not suppress them.
- The first sound/toast of each page load needs one user click on the page first (browser autoplay + permission policy).
- Toasts are only produced once the notification permission is granted; declining means sound + title marker only.
- Config lives in browser `localStorage`: switching browsers/devices or clearing site data returns to defaults (one-click restore in the Settings page).

## Development

```powershell
node --check lib\client.js
node --check lib\index.js
node smoke\smoke-test.cjs     # offline state-machine smoke test (master switch + zh/en language cases)
npm pack --dry-run            # preview the published tarball
```

## License

MIT — see [LICENSE](LICENSE).
