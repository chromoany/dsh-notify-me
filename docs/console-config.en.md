# Advanced console configuration

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
  autoDismiss: "present",     // toast auto-dismiss (the timer only; leftovers are withdrawn once you are back): 'present' keep while away | 'always' always close | 'never' never close
  ignoreSubagent: true,       // true = no alerts for background subagent sessions (the open one still alerts)
  mutedSessions: [],          // session ids muted per conversation (written by the sidebar bell, survives reloads)
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
> `debug().hostBridge` is the read-only snapshot of host coordination: `state` (`idle` the probe has not answered yet; `active` the host has a fallback and this page is holding the lease with its heartbeat; `unavailable` the host is there but offers no fallback, which is what a stock install looks like — an unregistered 404 route counts here too and is not a fault; `error` the host answered nothing usable, or the gate refused this page outright), `leaseMs` (the lease the host granted, in milliseconds), `relayEnabled` and `relayPath` (the relay route, when the host enabled one), `relayUpstreamHost` / `relayUpstreamPath` (the gateway endpoint the fold matches), `lastReason` (why the last probe failed — `bad-host` / `cross-origin` / `http-403` — and `null` when it was not a fault), and `lastProbeAt` / `lastBeaconAt` (the last probe and the last heartbeat, as ISO strings or `null`). A gate refusal reads as `error` rather than as "off", because it is a configuration the user can fix: add this page's origin to the top-level `allowedOrigins` of the `- id: notify-me` entry in the profile.

</details>

---

[← Back to README](../README.en.md)
