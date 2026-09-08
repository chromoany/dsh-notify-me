# dsh-notify-me

[简体中文](README.md) | English

[![npm version](https://img.shields.io/npm/v/dsh-notify-me?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-notify-me)
[![npm downloads](https://img.shields.io/npm/dm/dsh-notify-me?style=flat-square&label=downloads&color=1F883D)](https://www.npmjs.com/package/dsh-notify-me)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-browser-blue)
![Size](https://img.shields.io/badge/bundle-%3C20KB-green)

---

**Step away from the DeepSeek Harness web UI — and still know what's going on.** When the agent stops and needs your input, or when a reply finishes while you're in another app, dsh-notify-me alerts you with a Windows desktop notification, a sound, and a tab-title marker.

---

## UI Preview

| Windows system notification |
| --- |
| ![DSH notification](docs/screenshots/notify-toast.png) |

[Changelog](CHANGELOG.md)

## What it alerts about

| When | What you get | Default |
| --- | --- | --- |
| 🔔 **The agent needs your input** — sandbox approval / plan review / a question (`ask_user_question`) | Toast + sound + `🔔 需要你 ·` title marker | Alerts even while the page is visible |
| ✅ **A reply finishes** — a turn completes; background sessions finishing are also reported | Toast + sound | Alerts only while the page is hidden / backgrounded |

## How it alerts

- **System notification** — native notification-center toast (clicking it brings the DSH window back to front)
- **Sound** — WebAudio beeps (distinct patterns for "needs you" vs "done")
- **Tab title marker** — while something is waiting on you, the tab title is prefixed with `🔔 需要你 · …`

This is a **browser-layer** plugin: the DSH page must stay open (minimized or backgrounded is fine — that's exactly the "away" state it watches for).

## Installation

```powershell
# Official DSH plugin command — installs and auto-mounts into the web profile
dsh plugin --profile web add dsh-notify-me
```

Restart `dsh web`, then hard-refresh the page (Ctrl+Shift+R).

**Verify** — open the DevTools console and run:

```js
window.__dshNotifyMe.test("done")        // "reply finished" sample
window.__dshNotifyMe.test("attention")   // "needs your input" sample
```

Nothing happened? 90% of the time it's one of:

- the notification permission was declined — click anywhere on the page and choose **Allow** (address-bar lock → Site settings → Notifications → Allow → reload);
- the DSH process wasn't restarted after install;
- your OS/browser notification settings block the browser's toasts.

## Configuration

No settings-UI dependency — preferences live in `localStorage` and are tweakable live from the DevTools console:

```js
window.__dshNotifyMe.config                       // view current config
window.__dshNotifyMe.setConfig({
  attentionHiddenOnly: false, // true = don't alert "needs you" while the page is visible
  doneHiddenOnly: true,       // false = also alert "reply finished" while visible
  toast: true,                // system-notification toggles
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

No React/UI code, no settings-namespace plumbing, no third-party runtime dependencies — the alert code is fully self-contained and auditable.

## Known limitations

- The page must be open for alerts to fire (background tab / minimized is fine; closing the tab stops it — that's inherent to a browser-layer plugin).
- Notifications appear through the browser, so the browser needs "show notifications" permission in Windows settings, and notification-center "Do Not Disturb" must not suppress them.
- The first sound/toast of each page load needs one user click on the page first (browser autoplay + permission policy).
- Toasts are only produced once the notification permission is granted; declining means sound + title marker only.

## Development

```powershell
node --check lib\client.js
node --check lib\index.js
node smoke\smoke-test.cjs     # offline state-machine smoke test
npm pack --dry-run            # preview the published tarball (6 files, ~10 kB)
```

## License

MIT — see [LICENSE](LICENSE).
