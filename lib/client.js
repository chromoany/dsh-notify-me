// dsh-notify-me — browser half (client plugin bundle).
//
// Loaded by dsh-client-modules at /plugins/dsh-notify-me/client.js and
// executed through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS with
// require() resolved against the shell's module table — the same shape the
// shipped ui-* packages' tsdown bundles emit. react is part of the platform
// base, so require("react") resolves to the shell-seeded instance (same as
// every shipped ui-* bundle); the settings page is skipped when react or the
// slots/locale services are absent, keeping the reminder core self-contained.
//
// What this plugin does (all client-side, no settings transport needed):
//   - watches two services, because pending interactions and the running bit
//     have different owners on current hosts:
//       * "uiSession" -> the pending-interaction source, whose *store* changed
//         shape once and is therefore read through one adapter:
//           - DSH 0.1.2-alpha.2 .. 0.1.5-rc.3: `pendingInteractions`, a
//             Map<sessionId, interaction> whose values carry kind
//             'approval' | 'plan-review' | 'question' (the controller snapshots
//             stopped carrying `pending` in 0.1.2-alpha.2, so that store was the
//             only live source back then);
//           - DSH 0.1.6-alpha.2 and later (including 0.2.0-rc.2):
//             `sessionStatus`, a Map<sessionId, {running, pendingInteraction,
//             completionUnread}>; the old store is gone, so this is the only
//             live source on those hosts.
//         Both are resolved through ctx.get() — cordis throws on a plain
//         ctx.uiSession read for any name absent from the plugin's inject map;
//       * "sessions" -> the selected session's ConversationSnapshot (running)
//         and the session-list summaries of every other session (running /
//         completed), which carry the "reply finished" edge on every version.
//         The host's completion-unread level flag backs that edge up and owns
//         the "完成未读" title marker: `sessionStatus.completionUnread` on
//         0.1.6+ (armed when a background session finishes, cleared when it is
//         opened / re-runs / disappears), the list row's `completed` reminder
//         bit on older hosts. The edge path stays the reporter for the on-screen
//         session (its snippet comes from the face snapshot); the two views of
//         one completion are collapsed by reportDone's short dedupe window.
//         The selected ("current") session is read from the list snapshot's
//         `current` field where it exists (<= 0.1.5-rc.3) and otherwise derived
//         from the mainView retention count (0.1.6+, the way the shipped
//         DocumentTitle / ui-session pick it);
//   - mutes background subagent child sessions by default
//     (config.ignoreSubagent): DSH lists them as ordinary rows carrying
//     `origin: 'subagent'`, but their waits and finish edges are steps of the
//     parent conversation's turn. The subagent session the user has open is not
//     muted — it is on screen like any other conversation and alerts by the
//     normal rules;
//   - fires a Windows desktop Notification (+ optional sound) when the agent
//     needs the user's input — pending interaction kinds 'approval',
//     'plan-review' or 'question' — and when a reply/turn finishes;
//   - quick-decides approvals from the toast itself (option, on by default):
//     approval notifications carry 同意/拒绝 action buttons and one click on a
//     button settles the request through the interaction's own
//     answer('allowed-once' | 'rejected') — the exact verb the in-page approval
//     card uses. Action buttons only exist on persistent notifications, so this
//     file is dual-context: registered as a Service Worker as well, whose
//     notificationclick relays the chosen button back to this page (broadcast +
//     client postMessage) and, on a body click, raises exactly one window
//     (client.focus()) and routes the conversation switch to that window alone. Where a worker cannot run (insecure context, no
//     bundle URL) the plugin degrades to today's plain toast;
//   - registers a "通知提醒 / Notify me" page into DSH Settings
//     (settings.section slot) exposing an on/off master switch, per-event
//     toggles, volume and the notification language (follow-interface /
//     Simplified Chinese / English);
//   - preferences persist in localStorage (origin-scoped, like other
//     third-party client plugins) and are tweakable on window.__dshNotifyMe.

// One file, two jobs. The DSH module loader evaluates this script in the page
// (registering the factory below), and the very same served bytes are also
// registered as the plugin's Service Worker — see the bridge at the bottom of
// this wrapper.
(function (root) {
    if (!root) return;

    // ──────────────── service-worker half (notification bridge) ────────────
    var BRIDGE_CHANNEL = "dsh-notify-me:bridge";
    // A real Service Worker global is the only context with a registration and
    // no document; the page (and any test harness) never matches.
    function isServiceWorkerScope(g) {
      return !!g && typeof g.registration === "object" && g.registration !== null &&
        typeof g.addEventListener === "function" && typeof g.document === "undefined";
    }
    // The worker never decides anything: it only relays which button was
    // clicked to the page that owns the pending interaction. Both a
    // BroadcastChannel and a direct client postMessage are used — the channel
    // covers every same-origin page, the postMessage covers environments where
    // the worker cannot open one.
    function installNotificationBridge(g) {
      function relay(msg) {
        try {
          if (typeof g.BroadcastChannel === "function") {
            var ch = new g.BroadcastChannel(BRIDGE_CHANNEL);
            ch.postMessage(msg);
            try { ch.close(); } catch (e) {}
          }
        } catch (e) {}
        try {
          if (g.clients && typeof g.clients.matchAll === "function") {
            g.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
              for (var i = 0; i < list.length; i++) {
                try { list[i].postMessage(msg); } catch (e) {}
              }
            }, function () {});
          }
        } catch (e) {}
      }
      // One relayed click; `navigate` says whether the receiving page may
      // steer its window (raise it + switch to the alerted conversation).
      function clickMsg(base, navigate) {
        return {
          source: base.source,
          type: base.type,
          action: base.action,
          key: base.key,
          sessionId: base.sessionId,
          navigate: navigate
        };
      }
      // A body click means "take me there", and both halves of that request are
      // this handler's job. The window raise belongs here because only a
      // notificationclick carries the click's user activation — the page-side
      // window.focus() a plain relay triggers afterwards can lose the OS
      // foreground race and leave DSH behind other windows. So exactly one
      // window client is picked (a visible one first), that client alone gets
      // `navigate: true` plus the focus() call, and every other recipient gets
      // `navigate: false` and stays put: several open DSH tabs must not fight
      // over focus or all switch their own conversation at once. Buttons stay
      // hands-off — deciding from the toast must not drag a window up. The
      // `data.focus` flag (the autoFocus setting at show time) keeps the
      // "off = clicking does nothing" promise even though a worker cannot read
      // the page's config; toasts from older versions carry no flag and keep
      // the previous best-effort behavior.
      function deliverClick(base, wantsFocus) {
        var send = function (list) {
          list = list || [];
          var best = null;
          if (wantsFocus) {
            for (var i = 0; i < list.length; i++) {
              var c = list[i];
              if (!c || typeof c.postMessage !== "function") continue;
              if (c.visibilityState === "visible") { best = c; break; }
              if (!best) best = c;
            }
          }
          for (var j = 0; j < list.length; j++) {
            try { list[j].postMessage(clickMsg(base, wantsFocus && list[j] === best)); } catch (e) {}
          }
          try {
            if (typeof g.BroadcastChannel === "function") {
              var ch = new g.BroadcastChannel(BRIDGE_CHANNEL);
              ch.postMessage(clickMsg(base, false));
              try { ch.close(); } catch (e) {}
            }
          } catch (e) {}
          if (best && typeof best.focus === "function") {
            try {
              var fp = best.focus();
              if (fp && typeof fp.then === "function") fp.then(null, function () {});
            } catch (e) {}
          }
        };
        try {
          if (g.clients && typeof g.clients.matchAll === "function") {
            var p = g.clients.matchAll({ type: "window", includeUncontrolled: true });
            if (p && typeof p.then === "function") {
              p.then(send, function () { relay(clickMsg(base, wantsFocus)); });
              return;
            }
          }
        } catch (e) {}
        relay(clickMsg(base, wantsFocus));
      }
      g.addEventListener("notificationclick", function (event) {
        try {
          var n = event.notification;
          var data = (n && n.data) || {};
          var action = event.action || "";
          var base = {
            source: "dsh-notify-me",
            type: "notification",
            action: action,
            key: data.key || null,
            sessionId: data.sessionId || null
          };
          try { if (n && typeof n.close === "function") n.close(); } catch (e) {}
          var run = action
            ? function () { relay(base); }
            : function () { deliverClick(base, data.focus !== false); };
          if (typeof event.waitUntil === "function") {
            event.waitUntil(Promise.resolve().then(run));
          } else {
            run();
          }
        } catch (e) {}
      });
    }
    if (isServiceWorkerScope(root)) { installNotificationBridge(root); return; }
    if (!root.__ModuleLoader__ || typeof root.__ModuleLoader__.load !== "function") return;

    root.__ModuleLoader__.load({
      id: "dsh-notify-me",
      factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // react is externalized into the loader module table; never required by
    // the reminder core, only by the optional Settings page.
    var React = null;
    try { React = require("react") || null; } catch (e) { React = null; }

    // ───────────────────────── configuration ─────────────────────────
    var LS_CONFIG = "dshNotifyMe.config";
    var DEFAULTS = {
      enabled: true, // master switch: off = no toast/sound/title marker at all
      // language of the notification copy: 'auto' follows the DSH UI locale,
      // 'zh' and 'en' pin Simplified Chinese / English.
      language: "auto",
      // Which host environment this page runs in: 'auto' detects from the page
      // protocol (dsh-app:// = the packaged DSH Desktop shell), 'desktop' and
      // 'web' force it. The desktop needs its own raise path (raiseWindow
      // below) and cannot carry quick-decision buttons at all; the browser uses
      // window.focus() and the Service Worker bridge.
      hostEnv: "auto",
      // toast + sound are only useful while the user is elsewhere; the tab
      // being hidden is the reliable "away" signal.
      attentionHiddenOnly: false, // needs-input alerts even while the page is visible
      // A wait inside the conversation already on screen needs no toast: the
      // request is right in front of the user. Leaving the page brings that
      // alert back (see flushQuieted).
      currentHiddenOnly: true, // the visible session's own waits stay silent
      doneHiddenOnly: true, // legacy boolean, kept in sync with donePolicy below
      // When a finished reply should raise a toast. "background" alerts only
      // while the page is not being watched; "smart" stays silent only for the
      // conversation already on screen, so a second conversation finishing
      // behind the one you are reading still reaches you; "always" never
      // suppresses. "Watched" is away(), so a window left in front with nobody
      // at the keyboard still counts as away.
      donePolicy: "background",
      // Minutes without pointer/keyboard input before a focused page counts as
      // away. 0 disables the idle half and restores the focus-only rule.
      idleMinutes: 3,
      // Whether a toast goes away on its own. "present" closes it a few
      // seconds later only while you are at the page, so an alert that arrived
      // while you were away is still in the notification center when you come
      // back; "always" is the old tidy-up; "never" leaves plain toasts up until
      // you dismiss them. Approvals keep their own 12 s rule.
      autoDismiss: "present",
      // Background subagent child sessions are steps of another conversation's
      // turn: DSH lists each of them as its own row (origin: 'subagent'), so
      // their waits and finish edges would toast noise the user cannot act on.
      // Muted by default; the list row's own origin field is the only thing this
      // keys on, plus "not the session on screen" — an open subagent session is
      // just another conversation to alert for.
      ignoreSubagent: true,
      // Session ids the user silenced from the sidebar row ("静音" on the row
      // menu / hover button). Unlike ignoreSubagent this is a per-session hand
      // choice, remembered across restarts; ids are opaque host strings and the
      // list is pruned on read, so a hand-edited config cannot break matching.
      mutedSessions: [],
      sound: true,
      // Where each alert's cue comes from (per kind, so "needs you" and "reply
      // finished" stay independent):
      //   'synth'  — the built-in WebAudio cue (default, needs no asset)
      //   'custom' — an audio file the user picked, kept in its own
      //              localStorage key and played through an <audio> element
      //   'system' — no plugin cue at all: the toast is raised un-silenced so
      //              the operating system plays its own notification sound
      soundDone: "synth",
      soundAttention: "synth",
      volume: 0.5,
      autoFocus: true, // clicking the toast raises DSH and switches to the alerted conversation
      // Approval notifications carry 同意/拒绝 buttons and settle the request on
      // one click (the same answer('allowed-once' | 'rejected') a manual
      // decision sends). Buttons need persistent notifications, served through
      // the Service Worker half of this same file; where that cannot run, the
      // alert is a plain notification without buttons.
      quickActions: true,
      // Alerts reach the user through the OS notification center and nowhere
      // else. 1.11.0 dropped the in-page overlay (invisible the moment the window
      // is not in front — exactly when a reminder is worth anything), and 1.12.0
      // dropped the approval card that outlived it: a second on-page copy next
      // to the notification is noise.
      // External forwarding: mirror every alert the plugin actually delivers to
      // webhook endpoints (Discord / Bark / Gotify / Feishu / ServerChan /
      // WxPusher / custom), so a phone or another box can tell the user to come
      // back. Off by default — nothing leaves the browser until the user fills
      // in an endpoint of their own.
      // DingTalk is deliberately absent: its robot endpoint answers no CORS
      // header at all and only accepts application/json, so a page cannot send
      // to it (a no-cors POST loses the content type). A relay on the user's
      // own box, wired as a custom target, is the only route.
      externalEnabled: false,
      externalAttention: true, // forward the "needs you" alerts
      externalDone: true, // forward the "reply finished" alerts
      // Backoff between delivery attempts. Failed attempts are retried on this
      // schedule (with jitter) when the failure looks transient (network error,
      // HTTP 5xx, 429); a non-retryable failure stops at once. An empty list
      // means "send once".
      externalRetryDelays: [2000, 6000],
      // [{ id, type, url, secret?, token?, uid?, template?, enabled? }]
      // type: 'discord' | 'bark' | 'gotify' | 'feishu'
      //     | 'serverchan' | 'wxpusher' | 'custom'
      externalTargets: []
    };
    function readConfig() {
      var cfg = {};
      try {
        var raw = localStorage.getItem(LS_CONFIG);
        if (raw) cfg = JSON.parse(raw);
      } catch (e) { /* corrupt storage -> defaults */ }
      // JSON.parse also accepts `null`, `"x"` and `7`. A non-object would make
      // the default fill below throw on `in` and take the whole plugin down
      // with it, so anything that is not a plain object falls back to defaults.
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) cfg = {};
      // The in-page delivery options are gone: 1.11.0 removed the overlay as a
      // channel, 1.12.0 the approval card. An old config's `channel` / `overlay`
      // / `toast` / `overlayCorner` keys mean nothing now — dropped here so the
      // next write stores a clean config.
      delete cfg.channel;
      delete cfg.overlay;
      delete cfg.toast;
      delete cfg.overlayCorner;
      // Older builds exposed one boolean switch. A profile that had "also
      // alert while the page is open" turned on maps to "always"; everything
      // else keeps the background rule. Applied before the defaults fill so a
      // migrated value is not overwritten.
      if (typeof cfg.donePolicy !== "string" && cfg.doneHiddenOnly === false) cfg.donePolicy = "always";
      for (var k in DEFAULTS) if (!(k in cfg)) cfg[k] = DEFAULTS[k];
      // The boolean is now derived, never an input: keeping the two in step
      // means anything still reading doneHiddenOnly (a script, the 1.x smoke
      // suite, a downgrade) sees what the policy actually does.
      cfg.doneHiddenOnly = cfg.donePolicy !== "always";
      cfg.mutedSessions = cleanMutedSessions(cfg.mutedSessions);
      return cfg;
    }
    function writeConfig(patch) {
      // A failed write leaves the live config as the only copy; rebuilding from
      // storage would drop the setting the user just changed and make the page
      // disagree with itself on the next patch.
      var cfg = configWriteFailed && config ? config : readConfig();
      for (var k in patch) cfg[k] = patch[k];
      // Legacy alias, live in both directions: patching the old boolean still
      // selects the policy, so an existing caller keeps its meaning instead of
      // silently losing the setting to a key nothing reads any more.
      if (!("donePolicy" in patch) && "doneHiddenOnly" in patch) {
        cfg.donePolicy = patch.doneHiddenOnly === false ? "always" : "background";
      }
      cfg.donePolicy = cfg.donePolicy === "smart" || cfg.donePolicy === "always" ? cfg.donePolicy : "background";
      cfg.doneHiddenOnly = cfg.donePolicy !== "always";
      cfg.mutedSessions = cleanMutedSessions(cfg.mutedSessions);
      try {
        localStorage.setItem(LS_CONFIG, JSON.stringify(cfg));
        configWriteFailed = false;
      } catch (e) {
        // Quota, private-mode storage, a blocked origin: the switch looks saved
        // but dies on reload, so the settings page says so.
        configWriteFailed = true;
      }
      return cfg;
    }
    var configWriteFailed = false;
    var config = readConfig();
    // Persist a patch, swap the live module config and re-apply any active
    // title marker (its prefix follows the notification language).
    function setConfigLocal(patch) {
      config = writeConfig(patch);
      applyTitle();
      // A mute-list change is the one setting the host half reads: tell the rows
      // and beat right away so the host filters on the new list immediately.
      if (patch && "mutedSessions" in patch) notifyMuteChange();
      return config;
    }

    // ─────────────────── per-session mute (see #23) ──────────────────
    // The list lives in the config JSON on purpose: the sidebar row button has
    // to keep working after a reload, and the page already rewrites this object
    // on every settings change.
    var MUTED_MAX = 200;
    var MUTED_ID_MAX = 200;
    // The heartbeat body is capped at 16 KiB by the host, and the stored list
    // can be longer than one beat may carry (200 ids of up to 200 chars is
    // already ~40 KB worst case). Trim what goes on the wire by bytes, keeping
    // the head of the list: a session past the cut still stops its own local
    // alerts, it just is not covered by the host-side fallback.
    var MUTED_BEAT_BUDGET = 8 * 1024;
    function cleanMutedSessions(list) {
      if (!Array.isArray(list)) return [];
      var out = [];
      var seen = {};
      for (var i = 0; i < list.length && out.length < MUTED_MAX; i++) {
        var raw = list[i];
        if (typeof raw !== "string") continue;
        var id = raw.trim();
        if (id.length === 0 || id.length > MUTED_ID_MAX || seen[id] === true) continue;
        seen[id] = true;
        out.push(id);
      }
      return out;
    }
    function mutedSessions() {
      return config && Array.isArray(config.mutedSessions) ? config.mutedSessions : [];
    }
    // Bytes, not code units: an id with non-ASCII characters costs more on the
    // wire than its length suggests. Kept inline (no TextEncoder) so the smoke
    // harness's plain `vm` sandbox can run it too.
    function utf8Length(str) {
      var n = 0;
      for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1; }
        else n += 3;
      }
      return n;
    }
    // The subset of the list one heartbeat may carry, head first.
    function mutedForBeat() {
      var all = mutedSessions();
      var out = [];
      var used = 0;
      for (var i = 0; i < all.length; i++) {
        var cost = utf8Length(JSON.stringify(all[i])) + 1; // + the separating comma
        if (used + cost > MUTED_BEAT_BUDGET) break;
        used += cost;
        out.push(all[i]);
      }
      return out;
    }
    function isSessionMuted(sid) {
      if (typeof sid !== "string" || sid.length === 0) return false;
      return mutedSessions().indexOf(sid) !== -1;
    }
    // One predicate for "this session alerts nothing": subagent children (a
    // heuristic that follows the open session, see ignoreSubagent) plus the
    // sessions the user muted by hand.
    function alertMutedFor(sid, currentId) {
      return isSubagentSession(sid, currentId) || isSessionMuted(sid);
    }
    function setSessionMuted(sid, muted) {
      if (typeof sid !== "string" || sid.length === 0) return config;
      var next = mutedSessions().filter(function (id) { return id !== sid; });
      if (muted) next.push(sid);
      setConfigLocal({ mutedSessions: next });
      return config;
    }
    // Every row button and marker on screen subscribes: the host re-renders its
    // list on its own schedule, so a component that only read the config at
    // render time would keep showing a stale bell until something else moved.
    var muteListeners = [];
    function subscribeMuteChange(fn) {
      muteListeners.push(fn);
      return function () {
        var i = muteListeners.indexOf(fn);
        if (i !== -1) muteListeners.splice(i, 1);
      };
    }
    function notifyMuteChange() {
      for (var i = 0; i < muteListeners.length; i++) {
        try { muteListeners[i](); } catch (e) { /* one broken row must not stop the rest */ }
      }
      // The host fallback filters on the list it last heard in a heartbeat, so
      // beat right away instead of waiting for the next interval: muting and
      // closing the tab must not leave a window where the host still alerts.
      hostBridgeBeat();
    }

    // Picked cue files live in their own localStorage keys, never inside the
    // config JSON: a data URL is ~1.37x the file size, and the config is parsed
    // on every readConfig() — which happens on every alert.
    var LS_SOUND = { done: "dshNotifyMe.sound.done", attention: "dshNotifyMe.sound.attention" };
    // 1 MiB of source audio is ~1.37 MiB once base64-encoded; localStorage
    // grants ~5 MiB per origin, and the other kind plus the config must fit too.
    var SOUND_MAX_BYTES = 1048576;
    function soundMode(kind) {
      var v = kind === "attention" ? config.soundAttention : config.soundDone;
      return (v === "custom" || v === "system") ? v : "synth";
    }
    // True when the platform, not this plugin, should make the noise: only then
    // is the toast raised un-silenced. The master Sound switch still mutes it.
    function systemCue(kind) { return config.sound && soundMode(kind) === "system"; }
    function readSound(kind) {
      try {
        var raw = localStorage.getItem(LS_SOUND[kind]);
        if (!raw) return null;
        var rec = JSON.parse(raw);
        return (rec && typeof rec.data === "string" && rec.data) ? rec : null;
      } catch (e) { return null; }
    }
    // false = the record did not fit (quota) or storage is unavailable; the
    // caller reports it and the previous record stays in place.
    function writeSound(kind, rec) {
      try {
        if (rec) localStorage.setItem(LS_SOUND[kind], JSON.stringify(rec));
        else localStorage.removeItem(LS_SOUND[kind]);
        return true;
      } catch (e) { return false; }
    }

    // ───────────────────────── copy tables ─────────────────────────
    // Notification copy, keyed by language id. Selected through
    // effectiveLang() so a pinned language stays pinned even while the DSH UI
    // speaks the other one.
    var TXT = {
      zh: {
        kind: { approval: "审批请求", "plan-review": "方案待确认", question: "提问" },
        kindDefault: "需要操作",
        bodyKind: { approval: "有审批待处理", "plan-review": "方案待确认", question: "有提问待回答" },
        bodyDefault: "需要你操作",
        current: "当前对话",
        doneTitle: "DSH · 回复完成",
        doneBody: "回复已完成",
        background: "后台会话",
        marker: "🔔 需要你 · ",
        doneMarker: "✅ 回复完成 · ",
        sep: "：",
        approve: "同意",
        reject: "拒绝",
        dismiss: "关闭这条提醒",
        details: "详情",
        collapse: "收起",
        testAttention: "这是一条测试提醒：DSH 需要你的操作",
        testDone: "测试提醒 · 回复完成示例",
        testApproval: "这是一条测试审批：点「同意 / 拒绝」试试快捷裁决",
        testApproved: "测试提醒 · 已模拟「同意」（仅测试，未改动任何会话）",
        testRejected: "测试提醒 · 已模拟「拒绝」（仅测试，未改动任何会话）",
        testExternalTitle: "外部通知测试",
        testExternalBody: "这是一条测试消息：外部通知通道工作正常"
      },
      en: {
        kind: { approval: "Approval request", "plan-review": "Plan review", question: "Question" },
        kindDefault: "Action needed",
        bodyKind: {
          approval: "An approval is waiting for you",
          "plan-review": "A plan awaits your review",
          question: "A question is waiting for you"
        },
        bodyDefault: "Your input is needed",
        current: "Current conversation",
        doneTitle: "DSH · Reply finished",
        doneBody: "Reply finished",
        background: "Background session",
        marker: "🔔 Action needed · ",
        doneMarker: "✅ Reply finished · ",
        sep: ": ",
        approve: "Approve",
        reject: "Reject",
        dismiss: "Dismiss this alert",
        details: "Details",
        collapse: "Collapse",
        testAttention: "This is a test alert: DSH is waiting for your input",
        testDone: "Test alert · reply-finished sample",
        testApproval: "This is a test approval: try the Approve / Reject buttons to settle it",
        testApproved: "Test alert · simulated \"Approve\" (test only, nothing changed)",
        testRejected: "Test alert · simulated \"Reject\" (test only, nothing changed)",
        testExternalTitle: "External notification test",
        testExternalBody: "Test message: the external notification channel works"
      }
    };
    // Locale service handle (registered on the client context by dsh-client-locale).
    var localeSvc = null;
    // Current DSH UI language: 'zh' | 'en' | null (unknown). Used by the
    // 'auto' notification-language mode.
    function currentUILang() {
      try {
        if (localeSvc && typeof localeSvc.getLocale === "function") {
          var a = localeSvc.getLocale().active;
          if (typeof a === "string" && a) {
            if (a.indexOf("zh") === 0) return "zh";
            if (a.indexOf("en") === 0) return "en";
          }
        }
      } catch (e) {}
      try {
        var dl = (document.documentElement && document.documentElement.lang) || "";
        if (dl.indexOf("zh") === 0) return "zh";
        if (dl.indexOf("en") === 0) return "en";
      } catch (e) {}
      return null;
    }
    function effectiveLang() {
      if (!config.language || config.language === "auto") return currentUILang() || "zh";
      return config.language === "en" ? "en" : "zh";
    }
    function texts() { return TXT[effectiveLang()] || TXT.zh; }

    // ─────────────────────── notification plumbing ───────────────────
    var permAsked = false;
    function requestPermission(force) {
      // An explicit "test" click is a fresh intent: after a dismissed prompt
      // (permission stayed "default") the old latch made every later click a
      // no-op until a reload.
      if (!("Notification" in window) || (permAsked && !force)) return;
      permAsked = true;
      try {
        if (Notification.permission === "default") {
          Notification.requestPermission().catch(function () {});
        }
      } catch (e) {}
    }
    function canToast() {
      // System notifications are the only channel left (1.11.0); permission is
      // the single gate. A denied or policy-disabled Notification must not break
      // delivery: the sound and the title marker still fire.
      try {
        return "Notification" in window && Notification.permission === "granted";
      } catch (e) { return false; }
    }
    // True on the packaged desktop shell, where the app page lives under
    // dsh-app://app inside Electron. The desktop needs its own raise path
    // (raiseWindow below) and cannot carry quick-decision buttons at all.
    // Detection is a page-protocol read; the hostEnv setting can override it
    // for hosts where detection comes out wrong.
    function detectedDesktop() {
      try { return location.protocol === "dsh-app:"; } catch (e) { return false; }
    }
    function isDesktopShell() {
      if (config.hostEnv === "desktop") return true;
      if (config.hostEnv === "web") return false;
      return detectedDesktop();
    }
    // Route the host half (lib/index.js) registers to activate the desktop
    // window from the process that owns it.
    var FOCUS_ROUTE = "/__dsh-notify-me/focus-window";
    // A cross-origin page cannot send a custom header without a CORS preflight
    // this route never answers, so the header is also the CSRF gate.
    var FOCUS_HEADERS = { "x-dsh-notify-me-focus": "focus" };
    // What the last raise attempt did, surfaced through debug() so a failing
    // host path can be diagnosed from the settings page instead of by guesswork.
    var raiseState = { last: null };
    // The desktop is one shell, but the channel that can raise its window is
    // not: Windows has the host route (the deep link is a measured no-op there,
    // see below), macOS / Linux only have the shell's own dsh://open handler.
    // Read from the platform, not from the first click, so debug() can answer
    // what a toast click would do before anything has been clicked.
    function isWindowsPage() {
      try {
        return /Windows/i.test(String((typeof navigator !== "undefined" && navigator.userAgent) || ""));
      } catch (e) { return false; }
    }
    function desktopRaiseChannel() {
      return isWindowsPage() ? "host-route" : "dsh-deeplink";
    }
    // Bring the OS window forward. A browser tab answers to window.focus(); the
    // Electron shell does not — DOM focus() never touches the native window, and
    // Chromium only activates a window the OS already treats as foreground.
    //
    // Two desktop channels exist. Windows keeps the host route — lib/index.js
    // spawns lib/focus-window.ps1 from the process that owns the window, because
    // the deep link below was measured there as three failures (DSH Desktop
    // 0.2.1-rc.2, issue #9: the second instance exited in ~130 ms and IsIconic
    // never changed). Every other desktop uses the shell's own dsh://open
    // handler: the hidden-frame navigation reaches the system protocol
    // registration, whose single-instance owner restores and focuses the
    // window. That was the only channel before 1.14.0 and it still works
    // outside Windows.
    function raiseViaDeepLink() {
      try {
        var f = document.createElement("iframe");
        f.setAttribute("aria-hidden", "true");
        f.setAttribute("tabindex", "-1");
        f.style.cssText = "position:fixed;left:-10px;top:-10px;width:0;height:0;border:0;visibility:hidden";
        f.src = "dsh://open";
        (document.body || document.documentElement).appendChild(f);
        setTimeout(function () {
          try { if (f.parentNode) f.parentNode.removeChild(f); } catch (e) {}
        }, 4000);
        raiseState.last = "deeplink";
      } catch (e) {
        raiseState.last = "error";
      }
    }
    function raiseWindow() {
      try { window.focus(); } catch (e) {}
      if (!isDesktopShell()) { raiseState.last = "browser"; return; }
      if (!isWindowsPage()) { raiseViaDeepLink(); return; }
      try {
        if (typeof fetch !== "function") { raiseState.last = "no-fetch"; return; }
        raiseState.last = "pending";
        fetch(FOCUS_ROUTE, {
          method: "POST",
          headers: FOCUS_HEADERS,
          body: "{}",
          cache: "no-store"
        }).then(function (res) {
          if (!res || !res.ok) { raiseState.last = "http-" + (res ? String(res.status) : "0"); return; }
          if (typeof res.json !== "function") { raiseState.last = "focused"; return; }
          return res.json().then(function (body) {
            raiseState.last = body && body.focused
              ? "focused"
              : "not-focused" + (body && body.detail ? ":" + body.detail : "");
          }, function () {
            raiseState.last = "focused";
          });
        }).catch(function () {
          raiseState.last = "error";
        });
      } catch (e) {
        raiseState.last = "error";
      }
    }
    // ─────────────────── host coordination (page lease) ───────────────────
    // The host half (lib/host-fallback.js) can push the same alerts while this
    // page is closed. Both halves pushing at once would hand the user two
    // notifications for one event, so the host holds off while this page is
    // alive — and the only thing that can say so is the page itself. That is
    // what this lease is: a probe for "does the host have a fallback at all",
    // then a heartbeat while the answer is yes, then one alive:false on unload
    // so the host takes over immediately instead of waiting out the lease.
    //
    // Read-only status (the settings page renders it, debug() carries it): the
    // probe runs on page load and every 60 s (page hidden = no probe at all,
    // and coming back probes once right away), and the heartbeat exists only
    // after the host said hostFallback.enabled is true.
    var HOST_BRIDGE_ROUTE = "/__dsh-notify-me/host-bridge";
    // The host's page-bridge route answers POST only to a request carrying this
    // intent header, so a cross-origin page cannot arm or release the lease.
    var HOST_BRIDGE_HEADERS = { "x-dsh-notify-me-page": "bridge" };
    var HOST_BRIDGE_PROBE_MS = 60000;
    // Bounds on the heartbeat interval: a third of the host's lease keeps the
    // page from ever holding a stale lease, the floor keeps a tiny lease from
    // turning into a request storm, the ceiling keeps a huge one from letting
    // the host's takeover lag minutes behind a closed page.
    var HOST_BRIDGE_BEAT_MIN_MS = 5000;
    var HOST_BRIDGE_BEAT_MAX_MS = 20000;
    var HOST_BRIDGE_DEFAULT_LEASE_MS = 60000;
    var hostBridgeState = {
      // 'idle'        the probe has not answered yet
      // 'unavailable' the host is there but offers nothing to coordinate with:
      //               either it answered "no fallback" (hostFallback.enabled
      //               false) or the route is simply not registered — which is
      //               the stock install, because host-bridge only exists while
      //               hostFallback or relay is enabled. A bare 404 is this
      //               state, not a fault.
      // 'active'      the host asked for the lease and the heartbeat is running
      // 'error'       the host did not answer usefully at all, or refused the
      //               page outright: fetch refused, a 5xx, a body that is not
      //               the bridge JSON (a version mismatch or a proxy in
      //               between), or the gate's own 401/403 refusal. The refusal
      //               is the everyday deployment fault — behind a tunnel the
      //               Host is the public domain and the page's origin is not in
      //               allowedOrigins — and it must never read as "not enabled",
      //               or the user never learns which key to fix.
      state: "idle",
      leaseMs: null,
      relayEnabled: false,
      relayPath: null,
      // The gateway host the host-side relay forwards to, as published by the
      // bridge. A direct target naming this host can never be delivered from a
      // browser (Basic auth -> preflight the gateway answers without CORS
      // headers; the opaque no-cors fallback -> a cross-site POST the gateway
      // refuses), so such a target is folded onto the relay route instead.
      relayUpstreamHost: null,
      // The gateway's path as well: one gateway serves several notify keys, and
      // a target pointing at a different key must keep posting to that key
      // instead of being folded onto the relay's own.
      relayUpstreamPath: null,
      // Why the last probe failed, when it did: the gate's own reason
      // ('bad-host' | 'cross-origin' | ...) or 'http-403' when the refusal
      // carried nothing readable. null whenever the last probe was not a fault.
      lastReason: null,
      lastProbeAt: null,
      lastBeaconAt: null
    };
    var bridgeProbeTimer = null;
    var bridgeBeatTimer = null;
    var bridgeProbeDeferred = false;
    // Set by the disposer: a probe whose fetch is still in flight when the
    // plugin is disabled (or hot-reloaded) would otherwise re-arm the heartbeat
    // against a page container that no longer exists, and its lease would keep
    // the host's fallback switched off with nothing left to release it.
    var bridgeStopped = false;
    function hostBridgeIntervalMs(leaseMs) {
      var ms = typeof leaseMs === "number" && isFinite(leaseMs) && leaseMs > 0 ? leaseMs : HOST_BRIDGE_DEFAULT_LEASE_MS;
      return Math.max(HOST_BRIDGE_BEAT_MIN_MS, Math.min(HOST_BRIDGE_BEAT_MAX_MS, Math.round(ms / 3)));
    }
    // Leave the lease unless a pagehide already did it for us.
    function stopHostBridgeBeat() {
      if (bridgeBeatTimer) { try { clearInterval(bridgeBeatTimer); } catch (e) {} bridgeBeatTimer = null; }
    }
    function hostBridgePost(body, keepalive) {
      try {
        if (typeof fetch !== "function") return Promise.resolve(null);
        var headers = {};
        for (var k in HOST_BRIDGE_HEADERS) {
          if (Object.prototype.hasOwnProperty.call(HOST_BRIDGE_HEADERS, k)) headers[k] = HOST_BRIDGE_HEADERS[k];
        }
        headers["Content-Type"] = "application/json";
        return fetch(HOST_BRIDGE_ROUTE, {
          method: "POST",
          // Same-origin is the browser default here; the host's gate rejects a
          // request without the intent header, which is also what keeps a
          // cross-origin page from steering the lease.
          mode: "same-origin",
          cache: "no-store",
          headers: headers,
          body: JSON.stringify(body),
          keepalive: !!keepalive
        }).then(function () { return null; }, function () { return null; });
      } catch (e) {
        return Promise.resolve(null);
      }
    }
    // Only the language and the muted-session list travel. The host's fallback
    // pushes exactly when this page is not there, so the page's own forward
    // switches never enter the host's decision — and a field the host does not
    // read is worse than no field, because it reads like the toggles apply to
    // the host too. The mute list is the exception because the host is the one
    // that would otherwise speak for a silenced session.
    function hostBridgeBeat() {
      hostBridgeState.lastBeaconAt = Date.now();
      hostBridgePost({ alive: true, language: effectiveLang(), muted: mutedForBeat() }, false);
    }
    // One probe: ask the host whether it has a fallback, then start or stop the
    // lease to match. Every failure mode is silent — the reminder path must
    // never notice this runs.
    function probeHostBridge() {
      try {
        // The plugin was disposed (or is being hot-reloaded): a beacon or a
        // heartbeat from here would hold a lease nothing can release.
        if (bridgeStopped) return;
        // A hidden page is not a page the user is watching: it probes when it
        // comes back (see the deferred flag below) instead of on every tick.
        if (hidden()) { bridgeProbeDeferred = true; return; }
        if (typeof fetch !== "function") return;
        hostBridgeState.lastProbeAt = Date.now();
        fetch(HOST_BRIDGE_ROUTE, { method: "GET", cache: "no-store" })
          .then(function (res) { return hostBridgeAnswer(res); })
          .then(function (answer) {
            // null = the host is up but serves no bridge: the unavailable
            // branch, which is also what a default install looks like.
            if (!answer) { hostBridgeUnavailable(); return; }
            // The host's gate turned the page away: a real fault, carrying the
            // reason the settings row has to show.
            if (answer.denied) { hostBridgeError(answer.denied); return; }
            applyHostBridgeProbe(answer.body);
          }, function () { hostBridgeError(null); })
          .catch(function () { hostBridgeError(null); });
      } catch (e) {
        hostBridgeError(null);
      }
    }
    // Read the probe reply. Four outcomes, and telling them apart is the whole
    // point: an absent route is the normal state of a default install, a
    // refusal is a deployment fault worth naming, and only the rest is a fault
    // the user cannot act on.
    //   { body }              the bridge answered
    //   { denied: reason }    the gate refused this page (401/403/409)
    //   null                  the host is up but has no bridge (or no body to
    //                         read) -> 'unavailable', never an error
    //   throws                a 5xx or an unreadable body -> 'error'
    function hostBridgeAnswer(res) {
      if (!res) return null;
      var status = typeof res.status === "number" ? res.status : 0;
      // 404: the route is not registered (hostFallback and relay both off, which
      // is the default). 501: this host does not serve the route at all. 204:
      // the route exists but sent nothing to read. None of those is a fault, and
      // reading res.json() on an empty body would turn them into one.
      if (status === 404 || status === 501 || status === 204) return null;
      // The gate's refusals, and the ones the host serves on purpose. A 403 is
      // the most likely thing to go wrong in a real deployment (the tunnel Host
      // or the page origin is missing from allowedOrigins), so it is reported,
      // never folded into "not enabled".
      if (status === 401 || status === 403 || status === 409) return hostBridgeDenied(res, status);
      if (status >= 500) throw new Error("bridge-http-" + status);
      if (res.ok === false) return null;
      if (typeof res.json !== "function") return null;
      // A body that is not JSON rejects this promise (or throws before it is
      // even built): an older host, or something sitting between the page and
      // it. Either way the caller lands on 'error', which is the point.
      return Promise.resolve(res.json()).then(function (body) {
        return body && typeof body === "object" ? { body: body } : null;
      });
    }
    // A refusal reply. The gate answers `{ok:false, reason}` and that reason is
    // the only thing that tells the user which key to fix, so it is read when
    // the reply is readable at all and otherwise replaced by the status. Every
    // way of failing here (no reader, a synchronous throw, a rejection, a body
    // without a reason) ends at the same fallback.
    function hostBridgeDenied(res, status) {
      var fallback = "http-" + status;
      var read = null;
      try { read = typeof res.json === "function" ? res.json() : null; } catch (e) { read = null; }
      if (!read || typeof read.then !== "function") return { denied: fallback };
      return read.then(function (body) {
        var reason = body && typeof body === "object" && typeof body.reason === "string" && body.reason ? body.reason : "";
        return { denied: reason || fallback };
      }, function () { return { denied: fallback }; });
    }
    function applyHostBridgeProbe(body) {
      var hf = body.hostFallback;
      // The relay is its own feature: a user may want the same-origin relay
      // without the closed-page fallback, so its path is read no matter what
      // hostFallback says. relay.path only comes back while the relay is
      // enabled, and its presence is the state; the address the user pastes
      // into a webhook is this page's own origin plus that path.
      var relay = body.relay;
      applyHostBridgeRelay(relay);
      // A usable answer clears any refusal the page was reporting before.
      hostBridgeState.lastReason = null;
      if (hf && hf.enabled === true) {
        hostBridgeState.leaseMs = typeof hf.leaseMs === "number" && hf.leaseMs > 0
          ? hf.leaseMs : HOST_BRIDGE_DEFAULT_LEASE_MS;
        hostBridgeState.state = "active";
        startHostBridgeBeat();
        return;
      }
      // The host answered and has no fallback to hold off: nothing to
      // coordinate with. The relay path (if any) survives — it is a separate
      // feature.
      hostBridgeState.state = "unavailable";
      hostBridgeState.leaseMs = null;
      stopHostBridgeBeat();
    }
    // One trailing slash does not make a different endpoint, so both sides of
    // the upstream-path comparison drop it.
    function trimTailSlash(p) {
      return p.length > 1 && p.charAt(p.length - 1) === "/" ? p.slice(0, -1) : p;
    }
    function applyHostBridgeRelay(relay) {
      // A relay path that does not start with "/" would be resolved relative to
      // the current page instead of the origin, so it is not usable as an
      // absolute address: treat it as "no relay" rather than folding onto a
      // guessed path.
      hostBridgeState.relayPath = relay && relay.enabled === true && typeof relay.path === "string" && relay.path.charAt(0) === "/"
        ? relay.path : null;
      hostBridgeState.relayEnabled = !!hostBridgeState.relayPath;
      // An older host does not publish the upstream host; the fold then stays
      // off rather than guessing a gateway name.
      hostBridgeState.relayUpstreamHost = hostBridgeState.relayEnabled && relay && typeof relay.upstreamHost === "string" && relay.upstreamHost
        ? relay.upstreamHost.toLowerCase() : null;
      hostBridgeState.relayUpstreamPath = hostBridgeState.relayEnabled && relay && typeof relay.upstreamPath === "string" && relay.upstreamPath.charAt(0) === "/"
        ? trimTailSlash(relay.upstreamPath) : null;
    }
    // The host is reachable but has no bridge (an unregistered route, or a reply
    // with nothing in it): nothing to coordinate with, nothing to alarm about.
    function hostBridgeUnavailable() {
      hostBridgeState.state = "unavailable";
      hostBridgeState.leaseMs = null;
      hostBridgeState.lastReason = null;
      applyHostBridgeRelay(null);
      stopHostBridgeBeat();
    }
    // No usable answer from the host (fetch refused, a 5xx, a body that is not
    // the bridge JSON, or the gate's own refusal): the page cannot coordinate —
    // and cannot even tell what the host offers — so it stops beating and
    // reports why through debug() / the settings row. `reason` names the fault
    // when the host or the status did.
    function hostBridgeError(reason) {
      hostBridgeState.state = "error";
      hostBridgeState.leaseMs = null;
      hostBridgeState.relayPath = null;
      hostBridgeState.relayEnabled = false;
      hostBridgeState.relayUpstreamPath = null;
      hostBridgeState.lastReason = typeof reason === "string" && reason ? reason : null;
      stopHostBridgeBeat();
    }
    function startHostBridgeBeat() {
      stopHostBridgeBeat();
      if (bridgeStopped) return;
      hostBridgeBeat();
      // The timer only mirrors a lease the host already granted; there is
      // nothing to release from here, and a beat failure is the host's own
      // expired lease to notice.
      bridgeBeatTimer = setInterval(hostBridgeBeat, hostBridgeIntervalMs(hostBridgeState.leaseMs));
    }
    // The page is going away: release the lease at once so the host takes over
    // within a beat instead of after the lease runs out, then stay quiet.
    function releaseHostBridgeLease() {
      stopHostBridgeBeat();
      // The same two fields as a beat, with alive:false — the language still
      // rides along, because the host's next alert (the one this release
      // enables) is worded from it.
      var body = { alive: false, language: effectiveLang() };
      hostBridgeState.lastBeaconAt = Date.now();
      // keepalive lets the browser finish this POST while the document unloads.
      hostBridgePost(body, true);
    }
    function onHostBridgeHide() {
      if (hidden()) { bridgeProbeDeferred = true; return; }
      if (bridgeProbeDeferred) {
        bridgeProbeDeferred = false;
        probeHostBridge();
      }
    }
    // A pagehide released the lease for good, but the page may come back: a
    // back/forward-cache restore fires no load event (and no fresh boot probe),
    // so without this the page would sit there alive while the host keeps
    // pushing, and every such alert arrives twice until the next 60 s probe
    // corrects it. Only `persisted` needs a probe: an ordinary pageshow always
    // follows a real load, whose initHostBridge() probe just ran — and one
    // happening while the page is hidden defers anyway.
    function onHostBridgeShow(event) {
      if (event && event.persisted) probeHostBridge();
    }
    // Start the coordination loop. Idempotent, and every listener is wrapped:
    // a page container without the event API must simply keep working without
    // host coordination. Returns the disposer the plugin's effect registers:
    // disabling the plugin (or a hot reload) has to stop the probe, drop the
    // listeners and release the lease, or a page that is gone keeps the host's
    // fallback switched off forever.
    function initHostBridge() {
      bridgeStopped = false;
      try {
        probeHostBridge();
        if (!bridgeProbeTimer) {
          bridgeProbeTimer = setInterval(function () {
            if (hidden()) { bridgeProbeDeferred = true; return; }
            probeHostBridge();
          }, HOST_BRIDGE_PROBE_MS);
        }
      } catch (e) {}
      try {
        document.addEventListener("visibilitychange", onHostBridgeHide);
      } catch (e) {}
      try {
        window.addEventListener("pagehide", releaseHostBridgeLease);
      } catch (e) {}
      try {
        window.addEventListener("pageshow", onHostBridgeShow);
      } catch (e) {}
      return function () {
        bridgeStopped = true;
        if (bridgeProbeTimer) { try { clearInterval(bridgeProbeTimer); } catch (e) {} bridgeProbeTimer = null; }
        try { document.removeEventListener("visibilitychange", onHostBridgeHide); } catch (e) {}
        try { window.removeEventListener("pagehide", releaseHostBridgeLease); } catch (e) {}
        try { window.removeEventListener("pageshow", onHostBridgeShow); } catch (e) {}
        // Release rather than just stop: the host reads "no lease" as "push it
        // yourself", which is exactly what a disabled page should hand back.
        releaseHostBridgeLease();
      };
    }

    // Bring the window forward and make the alerted session the current one,
    // so a click on the toast lands on the conversation that needs the user
    // instead of just the app. Navigation moved with the host API: `sessions`
    // exposed open(id) through 0.1.5-rc.3, and 0.1.6+ routes the same action
    // through `uiWorkspace.openSession(id)`. Every failure here is non-fatal: a
    // session that left the list, an older host without either verb, or a
    // cordis service that cannot be resolved must still leave a usable window
    // in front.
    function focusSession(sessionId) {
      raiseWindow();
      if (!sessionId) return;
      try {
        var st = listStore && listStore.getSnapshot();
        if (st && st.byId && !st.byId[sessionId] && currentSessionId() !== sessionId) return;
        var svc = lookupService("sessions");
        if (svc && typeof svc.open === "function") { svc.open(sessionId); return; }
        var ws = lookupService("uiWorkspace");
        if (ws && typeof ws.openSession === "function") ws.openSession(sessionId);
      } catch (e) {}
    }
    // ─────────────── approval quick-decision bridge ───────────────
    // Action buttons exist only on persistent notifications
    // (ServiceWorkerRegistration.showNotification); the Notification()
    // constructor throws on an `actions` option. The worker half lives at the
    // bottom of this file's wrapper and only relays clicks back here, where the
    // pending interaction's own answer() settles the request.
    var BRIDGE_CHANNEL = "dsh-notify-me:bridge";
    var swRegistration = null;
    var swState = "idle"; // idle | disabled | registering | active | unsupported:* | failed:*
    var bridgeListening = false;
    var actionChannel = null;
    // Keyed by interaction key: every toast that carries buttons has a record
    // here, so a click can only ever decide the exact request it was raised
    // for. { sessionId, interaction, tag, test }
    var pendingActions = Object.create(null);
    // The single-record combo URL of THIS bundle — the only URL that may be
    // registered as a worker, since a multi-plugin combo would evaluate every
    // other plugin's factory in the worker and fail the registration. The boot
    // graph publishes it per entry ({id, url, rev}).
    function selfBundleUrl() {
      try {
        var boot = window.__DSH_BOOT__;
        var entries = boot && boot.entries;
        if (Array.isArray(entries)) {
          for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e && e.id === "dsh-notify-me" && typeof e.url === "string" && e.url) return e.url;
          }
        }
      } catch (e) {}
      return null;
    }
    function ensureActionBridge() {
      if (!config.quickActions) { swState = "disabled"; return; }
      if (swState === "active" || swState === "registering") return;
      listenBridge();
      try {
        if (typeof navigator === "undefined" || !navigator.serviceWorker) {
          swState = "unsupported: no service worker";
          return;
        }
        if (window.isSecureContext === false) {
          swState = "unsupported: insecure context";
          return;
        }
        var url = selfBundleUrl();
        if (!url) {
          swState = "unsupported: bundle url unknown";
          return;
        }
        swState = "registering";
        navigator.serviceWorker.register(url).then(function (reg) {
          try {
            swRegistration = reg || null;
            if (!reg) { swState = "failed: no registration"; return; }
            if (reg.active) { swState = "active"; return; }
            var w = reg.installing || reg.waiting;
            if (!w) { swState = "active"; return; }
            var settle = function () {
              try {
                if (reg.active || w.state === "activated") swState = "active";
                else if (w.state === "redundant") swState = "failed: worker redundant";
              } catch (e) {}
            };
            try { w.addEventListener("statechange", settle); } catch (e) {}
            settle();
          } catch (e) {
            swState = "failed: " + ((e && e.message) || e);
          }
        }, function (err) {
          swState = "failed: " + ((err && err.message) || err);
        });
      } catch (e) {
        swState = "failed: " + ((e && e.message) || e);
      }
    }
    function bridgeActive() {
      return !!(swRegistration && swState === "active");
    }
    // Both relay paths end here; the worker's broadcast goes to every
    // same-origin page and the postMessage to every window client, so the
    // handler must be idempotent (decidePending() is a one-shot per key).
    function listenBridge() {
      if (bridgeListening) return;
      bridgeListening = true;
      try {
        if (typeof navigator !== "undefined" && navigator.serviceWorker &&
            typeof navigator.serviceWorker.addEventListener === "function") {
          navigator.serviceWorker.addEventListener("message", function (ev) {
            try { onBridgeMessage(ev && ev.data); } catch (e) {}
          });
        }
      } catch (e) {}
      try {
        if (typeof BroadcastChannel === "function") {
          actionChannel = new BroadcastChannel(BRIDGE_CHANNEL);
          actionChannel.onmessage = function (ev) {
            try { onBridgeMessage(ev && ev.data); } catch (e) {}
          };
        }
      } catch (e) {}
    }
    function onBridgeMessage(msg) {
      if (!msg || msg.source !== "dsh-notify-me" || msg.type !== "notification") return;
      if (msg.action === "approve") { decidePending(msg.key, "allowed-once"); return; }
      if (msg.action === "reject") { decidePending(msg.key, "rejected"); return; }
      // The worker picks the one window a click should land on (see the bridge):
      // its `navigate: false` copies keep every other DSH tab from stealing
      // focus or switching its own conversation. A message from before that
      // flag existed carries none and falls back to the old best-effort route.
      if (msg.navigate === false) return;
      if (config.autoFocus) focusSession(msg.sessionId || null);
    }
    // The live interaction wins over the reference captured at alert time (the
    // wait may have been replaced), and a key with no live record is stale —
    // the notification outlived its request, so the click must decide nothing.
    function findPendingByKey(key) {
      try {
        var svc = lookupService("uiSession");
        var found = interactionStore(svc);
        if (!found) return null;
        var snap = found.store.getSnapshot();
        if (!snap || typeof snap.forEach !== "function") return null;
        var hit = null;
        snap.forEach(function (value) {
          if (hit) return;
          var it = pendingOf(value, found.source);
          if (it && it.key === key) hit = it;
        });
        return hit;
      } catch (e) { return null; }
    }
    function closeNotificationTag(tag) {
      if (!swRegistration || typeof swRegistration.getNotifications !== "function") return;
      try {
        var done = function (list) {
          for (var i = 0; i < (list || []).length; i++) {
            try { list[i].close(); } catch (e) {}
          }
        };
        var r = swRegistration.getNotifications({ tag: tag });
        if (r && typeof r.then === "function") r.then(done, function () {});
        else done(r);
      } catch (e) {}
    }
    // One toast button press. outcome: 'allowed-once' | 'rejected' — exactly
    // the two decisions a manual answer in the conversation makes.
    function decidePending(key, outcome) {
      var rec = key ? pendingActions[key] : null;
      if (!rec) return false; // already answered elsewhere, or a stale toast
      delete pendingActions[key];
      if (!rec.test) closeNotificationTag(rec.tag);
      if (rec.test) {
        // Test toasts settle nothing real; the feedback toast IS the proof that
        // the button clicked all the way through the worker bridge.
        deliver("done", texts().doneTitle, outcome === "allowed-once" ? texts().testApproved : texts().testRejected, null, null);
        notifyEvent("decision", { key: key, outcome: outcome, sessionId: rec.sessionId || null, test: true });
        return true;
      }
      var target = findPendingByKey(key) || rec.interaction;
      if (!target || target.key !== key || typeof target.answer !== "function") return false;
      try {
        var p = target.answer(outcome);
        if (p && typeof p.catch === "function") p.catch(function () {});
      } catch (e) { return false; }
      unmarkAttention(key);
      notifyEvent("decision", { key: key, outcome: outcome, sessionId: rec.sessionId || null });
      return true;
    }
    // Attach buttons to one alert. Only real approval interactions qualify:
    // they are the only kind whose decision is a plain binary, and the only one
    // whose object answers answer('allowed-once' | 'rejected').
    function quickFor(key, it, sessionId) {
      // The buttons are a rendering concern: a notification needs a live worker
      // bridge for OS actions. The pending record is kept either way, so a click
      // still settles the same decision (and debug().actionKeys stays honest
      // about what is waiting).
      if (!config.quickActions) return null;
      if (!it || it.kind !== "approval" || typeof it.answer !== "function") return null;
      var q = {
        key: key,
        sessionId: sessionId || null,
        interaction: it,
        tag: attentionTag(key),
        test: false
      };
      pendingActions[key] = q;
      return q;
    }
    function quickForTest(key) {
      var q = {
        key: key,
        sessionId: null,
        interaction: null,
        tag: attentionTag(key),
        test: true
      };
      pendingActions[key] = q;
      return q;
    }

    // A plain toast needs a tag unique to that one notification. It used to be
    // "dsh-notify-me-" + kind, which leans on renotify:true to replace the
    // previous banner of the same kind; Electron ignores that flag, so the
    // second toast of a kind silently overwrote the first and never re-alerted
    // (issue #15). A unique tag makes every toast a fresh alert everywhere,
    // while renotify stays meaningful on the web. Date.now() alone collides
    // when two alerts land in the same millisecond, hence the counter; the
    // >>> 0 wrap keeps it from ever going negative.
    //
    // The tag also has a hard length limit: Windows refuses a toast whose tag
    // is longer than 64 characters, and Chromium hands the platform not our
    // string but "n#<origin>#<ours>", so the room left depends on the page
    // origin. The approval test used to build "dsh-notify-me-attention-test:
    // approval:<13-digit ms>" = 51 characters; the desktop page's
    // dsh-app://app origin adds 16 more, 67 in total, and the platform refused
    // the constructor outright (issue #18). showToast() swallowed that throw and
    // the settings page had already printed "sent". Every tag now goes through
    // toastTag(), so the length is a property of one function instead of every
    // caller's arithmetic.
    var TOAST_TAG_LIMIT = 64;
    var TAG_ORIGIN_PREFIX = 3; // the "n#" before the origin and the "#" after it
    var toastSeq = 0;
    function toastTagBudget() {
      var prefix = TAG_ORIGIN_PREFIX;
      try {
        var origin = String((typeof location !== "undefined" && location.origin) || "");
        if (origin && origin !== "null") prefix += origin.length;
      } catch (e) {}
      var room = TOAST_TAG_LIMIT - prefix;
      // A pathological origin must not leave a tag with no room for a key at
      // all; below this the platform limit is the binding constraint anyway.
      return room > 20 ? room : 20;
    }
    // FNV-1a (32-bit) in base36: at most 7 characters, stable for a given
    // string, and cheap enough to run on every toast. Only the tail is hashed:
    // the readable "dsh-notify-me-attention-" prefix survives, so a shortened
    // tag still reads as an approval.
    function tagHash(s) {
      var h = 0x811c9dc5;
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
      }
      return h.toString(36);
    }
    function toastTag(raw) {
      var room = toastTagBudget();
      if (raw.length <= room) return raw;
      var h = tagHash(raw);
      var keep = room - h.length - 1;
      return keep > 0 ? raw.slice(0, keep) + "-" + h : h;
    }
    function uniqueToastTag(kind) {
      toastSeq = (toastSeq + 1) >>> 0;
      return toastTag("dsh-notify-me-" + kind + "-" + toastSeq + "-" + Date.now());
    }
    // Approval toasts keep a stable tag: closeNotificationTag() looks them up by
    // the very string the pending record was created with, so a shortened tag is
    // fine as long as it is built in exactly one place.
    function attentionTag(key) {
      return toastTag("dsh-notify-me-attention-" + key);
    }

    // The last toast the platform refused to create. A refusal is invisible by
    // construction — the constructor throws before anything is shown — and the
    // settings button printed "sent" regardless, which is exactly the silent
    // failure issue #18 reported. Keeping the reason here makes it readable from
    // debug() and lets the test buttons stop claiming success.
    var lastToastReject = null;
    // The Service Worker's showNotification() settles asynchronously, so its
    // refusal lands a tick later than the click that raised it. The settings
    // test keeps this promise and reports only after it settles; otherwise the
    // page claimed "sent" for a toast the platform had already dropped (the
    // surviving half of issue #18 on the only path that carries buttons).
    var lastToastPending = null;
    function noteToastReject(tag, err) {
      var message = "unknown";
      try { message = String((err && err.message) || err || "unknown"); } catch (e) {}
      lastToastReject = {
        tag: tag || "",
        length: (tag || "").length,
        message: message,
        at: new Date().toISOString()
      };
      try { console.warn("[dsh-notify-me] toast refused (" + lastToastReject.length + "-char tag): " + message); } catch (e) {}
    }
    function showToast(kind, title, body, sessionId, quick) {
      if (!canToast()) return;
      var tag = quick ? quick.tag : uniqueToastTag(kind);
      try {
        if (quick && bridgeActive()) {
          var d = texts();
          try {
            var shown = swRegistration.showNotification(title, {
              body: body || "",
              tag: tag,
              renotify: true,
              // The plugin owns the audio (see showToast's silent note below),
              // except in the 'system' cue mode, which hands the sound back to
              // the platform on purpose.
              silent: !systemCue(kind),
              icon: (location.origin || "") + "/favicon.svg",
              data: { key: quick.key, sessionId: sessionId || null, kind: kind, test: !!quick.test, focus: config.autoFocus !== false },
              actions: [
                { action: "approve", title: d.approve },
                { action: "reject", title: d.reject }
              ]
            });
            // The worker call can refuse asynchronously for the same platform
            // reason; leaving the rejection unhandled would hide it just like
            // the swallowed constructor throw did (issue #18). The same promise
            // is what runTest() waits on before it reports "sent".
            if (shown && typeof shown.then === "function") {
              lastToastPending = shown;
              shown.catch(function (e) { noteToastReject(tag, e); });
            }
            // No auto-close on purpose: an unanswered approval stays clickable
            // (toast, then Action Center) until the request is settled — the
            // wait-teardown path closes it through closeNotificationTag().
            return;
          } catch (e) { /* worker notifications unavailable -> plain toast */ }
        }
        var n = new Notification(title, {
          body: body || "",
          tag: tag,
          renotify: true,
          // The plugin owns the audio: its WebAudio cues already differ per
          // kind (attention vs done) and answer the Sound toggle and volume
          // slider. Without this flag the platform plays its own chime on top
          // of the beep — two sounds stacked on one alert. The single exception
          // is the 'system' cue mode, which is precisely "let the platform play
          // it"; the master Sound switch still mutes that too.
          silent: !systemCue(kind),
          icon: (location.origin || "") + "/favicon.svg"
        });
        if (config.autoFocus) {
          n.onclick = function () {
            focusSession(sessionId);
            n.close();
          };
        }
        // Longer for an actionable toast so there is time to click it, shorter
        // for a plain one: a notification that just sits there is noise.
        // close() also withdraws the toast from the notification center, so a
        // timer must not erase an alert the user never got to see. autoDismiss
        // picks between the three behaviours (see DEFAULTS).
        var policy = config.autoDismiss === "always" || config.autoDismiss === "never" ? config.autoDismiss : "present";
        if (quick) {
          // "Never close" means never, approval toast or not.
          setTimeout(function () {
            if (policy === "never") return;
            if (policy !== "always" && hidden()) return;
            n.close();
          }, 12000);
        } else if (policy !== "never") {
          setTimeout(function () { if (policy !== "always" && hidden()) return; n.close(); }, 5000);
        }
      } catch (e) { noteToastReject(tag, e); }
    }

    // Sound: WebAudio beeps (no asset needed). The context only runs after a
    // user gesture; we unlock it on the first pointer/key event.
    var audioCtx = null;
    function unlockAudio() {
      try {
        if (!audioCtx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          audioCtx = new AC();
        }
        if (audioCtx.state === "suspended") audioCtx.resume().catch(function () {});
      } catch (e) {}
    }
    function tone(freq, startIn, durMs, vol) {
      if (!audioCtx || audioCtx.state !== "running") return;
      try {
        var t0 = audioCtx.currentTime + startIn;
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + durMs / 1000 + 0.05);
      } catch (e) {}
    }
    // 'custom' plays the file the user picked. Anything short of a started
    // element — no file stored, a browser without the element, a constructor or
    // play() that throws — falls through to the built-in cue, so an alert is
    // never silent merely because a stored file went missing or unreadable.
    // The last failure mode is different in kind: a decode or autoplay refusal
    // rejects play()'s promise instead of throwing, so it gets the built-in cue
    // handed to it as a fallback rather than falling through.
    function playCustomSound(kind, fallback) {
      var rec = readSound(kind);
      if (!rec) return false;
      try {
        var el = new Audio(rec.data);
        el.volume = Math.max(0, Math.min(1, config.volume));
        var started = el.play();
        if (started && typeof started.catch === "function") started.catch(fallback);
        return true;
      } catch (e) { return false; }
    }
    // 'system' returns silently on purpose: showToast raises the toast
    // un-silenced for exactly this mode, so the OS plays its own notification
    // sound and the plugin must not stack a second cue on top of it.
    function playCue(kind, build) {
      if (!config.sound) return;
      var mode = soundMode(kind);
      if (mode === "system") return;
      function synth() {
        // An async rejection can land after the user muted everything.
        if (!config.sound) return;
        unlockAudio();
        build();
      }
      if (mode === "custom" && playCustomSound(kind, synth)) return;
      synth();
    }
    function playAttentionSound() {
      playCue("attention", function () {
        tone(880, 0.0, 140, config.volume);
        tone(1174, 0.16, 140, config.volume);
        tone(1568, 0.32, 200, config.volume);
      });
    }
    function playDoneSound() {
      playCue("done", function () {
        tone(659, 0.0, 150, config.volume);
        tone(988, 0.18, 260, config.volume);
      });
    }
    function unlockOnce() {
      unlockAudio();
      requestPermission();
    }
    function onFirstGesture() {
      unlockOnce();
      window.removeEventListener("pointerdown", onFirstGesture, true);
      window.removeEventListener("keydown", onFirstGesture, true);
    }
    window.addEventListener("pointerdown", onFirstGesture, true);
    window.addEventListener("keydown", onFirstGesture, true);

    // ───────────────────── external webhook forwarding ─────────────────────
    // Every alert fire() actually delivers is mirrored to the user's webhook
    // targets (Discord / Bark / Gotify / Feishu / ServerChan / WxPusher /
    // custom), so being away from the machine does not mean missing the "come
    // back" cue. Off by default: nothing leaves the browser until the user
    // fills in an endpoint.
    //
    // CORS reality: a page can only read a response the endpoint allows it to
    // read. Discord webhooks and Feishu bots answer with
    // Access-Control-Allow-Origin: *; ServerChan and WxPusher echo the page
    // origin; a self-hosted endpoint may do neither. So each send tries a plain
    // CORS POST first and, only when the browser itself refuses the exchange (a
    // rejection from fetch — not an HTTP error status, which means the server
    // did see the request), retries as a no-cors POST with a text/plain content
    // type: the request is still delivered, only the reply is unreadable
    // ("unverified"). Bark gets a third chance in the classic GET shape
    // `url/<title>/<body>`, which needs no CORS at all. A transient failure
    // (network error, 5xx, 429) is retried on the configured backoff; anything
    // else stops at once, and a final failure lands in the dead-letter log.
    // ── SHA-256 / HMAC-SHA256 ──────────────────────────────────────────
    // Two signing modes need HMAC-SHA256: Feishu's 签名校验 and the custom
    // target's X-DSH-Notify-Signature header. Web Crypto's
    // crypto.subtle only exists in a secure context, and this plugin also runs
    // crypto.subtle only exists in a secure context, and this plugin also runs
    // on plain-http LAN pages and inside the desktop shell, so the digest is
    // implemented here: no dependency, no secure-context requirement, and the
    // smoke suite cross-checks it against Node's crypto module.
    var SHA256_K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    function utf8Bytes(s) {
      if (typeof TextEncoder === "function") return new TextEncoder().encode(s);
      var out = [];
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c >= 0xd800 && c <= 0xdbff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return new Uint8Array(out);
    }
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    function sha256(bytes) {
      var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
      var l = bytes.length;
      var total = (((l + 8) >> 6) + 1) << 6;
      var buf = new Uint8Array(total);
      buf.set(bytes);
      buf[l] = 0x80;
      var dv = new DataView(buf.buffer);
      dv.setUint32(total - 8, Math.floor(l / 0x20000000));
      dv.setUint32(total - 4, (l << 3) >>> 0);
      var w = new Array(64);
      for (var off = 0; off < total; off += 64) {
        var i;
        for (i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
        for (i = 16; i < 64; i++) {
          var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
          var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], hh = H[7];
        for (i = 0; i < 64; i++) {
          var t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) | 0;
          var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
          hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + hh) | 0;
      }
      var out = new Uint8Array(32);
      var odv = new DataView(out.buffer);
      for (var j = 0; j < 8; j++) odv.setUint32(j * 4, H[j] >>> 0);
      return out;
    }
    function hmacSha256(keyStr, msgStr) {
      var key = utf8Bytes(keyStr);
      var msg = utf8Bytes(msgStr);
      if (key.length > 64) key = sha256(key);
      var k = new Uint8Array(64);
      k.set(key);
      var inner = new Uint8Array(64 + msg.length);
      var outer = new Uint8Array(64 + 32);
      for (var i = 0; i < 64; i++) {
        inner[i] = k[i] ^ 0x36;
        outer[i] = k[i] ^ 0x5c;
      }
      inner.set(msg, 64);
      outer.set(sha256(inner), 64);
      return sha256(outer);
    }
    function bytesToB64(bytes) {
      // Hand-rolled instead of btoa(): the page container is not guaranteed to
      // expose the legacy Web API global, and the signature is the one thing a
      // user cannot verify by eye.
      var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      var s = "";
      for (var i = 0; i < bytes.length; i += 3) {
        var b0 = bytes[i];
        var b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
        var b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
        s += B64.charAt(b0 >> 2);
        s += B64.charAt(((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4));
        s += b1 < 0 ? "=" : B64.charAt(((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6));
        s += b2 < 0 ? "=" : B64.charAt(b2 & 63);
      }
      return s;
    }
    function bytesToHex(bytes) {
      var s = "";
      for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
      return s;
    }

    var externalStat = { sent: 0, unverified: 0, failed: 0, retried: 0, lastAt: null, lastStatus: null };
    var LS_EXTERNAL_DEAD = "dshNotifyMe.external.dead";
    var LS_EXTERNAL_HEALTH = "dshNotifyMe.external.health";
    var EXTERNAL_DEAD_MAX = 10;
    var WXPUSHER_ENDPOINT = "https://wxpusher.zjiecode.com/api/send/message";
    // Unknown / retired type ids degrade to the generic JSON shape instead of
    // dropping the target: an old profile keeps delivering after an upgrade.
    function externalType(t) {
      if (t === "discord" || t === "bark" || t === "gotify" || t === "feishu" ||
          t === "serverchan" || t === "wxpusher") return t;
      return "custom";
    }
    // Valid, enabled targets only. A stale entry (bad URL, missing token,
    // unknown type) is skipped rather than breaking the others; the settings
    // page only ever writes well-formed entries.
    function externalTargets() {
      var out = [];
      var list = config.externalTargets;
      if (!Array.isArray(list)) return out;
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        if (!t || typeof t !== "object" || t.enabled === false) continue;
        var type = externalType(t.type);
        var url = typeof t.url === "string" ? t.url.trim() : "";
        var secret = typeof t.secret === "string" ? t.secret.trim() : "";
        var template = typeof t.template === "string" ? t.template : "";
        var id = typeof t.id === "string" ? t.id : "";
        if (type === "wxpusher") {
          // The appToken and the receiver id are the whole configuration; the
          // endpoint itself is fixed, so there is no URL to get wrong.
          var token = typeof t.token === "string" ? t.token.trim() : "";
          var uid = typeof t.uid === "string" ? t.uid.trim() : "";
          if (!token || !uid) continue;
          out.push({ id: id, type: type, url: WXPUSHER_ENDPOINT, secret: "", template: template, token: token, uid: uid });
          continue;
        }
        if (!/^https?:\/\//i.test(url)) continue;
        out.push({ id: id, type: type, url: url, secret: secret, template: template, token: "", uid: "" });
      }
      return out;
    }
    // The text every chat-style target shows. A target may pin its own template
    // ({{title}} / {{body}} / {{event}} / {{time}} / {{session}}); without one
    // the alert reads "title" then the body, which is what the previous
    // version sent as one string.
    function externalContent(target, ev) {
      if (!target.template) return ev.title + "\n" + ev.body;
      return target.template.replace(/\{\{\s*(title|body|event|time|session)\s*\}\}/g, function (m, key) {
        if (key === "title") return ev.title;
        if (key === "body") return ev.body;
        if (key === "event") return ev.kind;
        if (key === "session") return ev.sessionId || "";
        return ev.time;
      });
    }
    // Per-endpoint request, each shaped by that service's own convention.
    // `noCorsType` is the content type used for the opaque fallback: only the
    // three CORS-safelisted types may be set on a no-cors request, so a JSON
    // payload falls back to text/plain and a form stays a form.
    function externalRequest(target, ev) {
      var text = externalContent(target, ev);
      var jsonType = "application/json";
      var plainType = "text/plain;charset=UTF-8";
      var formType = "application/x-www-form-urlencoded;charset=UTF-8";
      var req;
      if (target.type === "discord") {
        req = { url: target.url, contentType: jsonType, noCorsType: plainType, headers: {}, body: JSON.stringify({ username: "DSH", content: text.length > 1900 ? text.slice(0, 1900) + "…" : text }) };
        return { type: "discord", req: req };
      }
      if (target.type === "bark") {
        return { type: "bark", req: { url: target.url, contentType: jsonType, noCorsType: plainType, headers: {}, body: JSON.stringify({ title: ev.title, body: text, group: "dsh-notify-me" }) } };
      }
      if (target.type === "gotify") {
        return { type: "gotify", req: { url: target.url, contentType: jsonType, noCorsType: plainType, headers: {}, body: JSON.stringify({ title: ev.title, message: text, priority: ev.kind === "attention" ? 8 : 5 }) } };
      }
      if (target.type === "feishu") {
        // Feishu's signature is `base64(HMAC-SHA256(key = timestamp + "\n" +
        // secret, data = ""))` with the timestamp in seconds, carried inside
        // the JSON body (which Feishu's endpoint does expose to the browser).
        var fb = { msg_type: "text", content: { text: text } };
        if (target.secret) {
          var fts = String(Math.floor(Date.now() / 1000));
          fb.timestamp = fts;
          fb.sign = bytesToB64(hmacSha256(fts + "\n" + target.secret, ""));
        }
        return { type: "feishu", req: { url: target.url, contentType: jsonType, noCorsType: plainType, headers: {}, body: JSON.stringify(fb) } };
      }
      if (target.type === "serverchan") {
        // ServerChan (Turbo and ³ share this ABI) takes a form: title + desp,
        // and answers {"code":0}. A form content type is CORS-safelisted, so
        // the opaque fallback carries the same body unchanged. Turbo truncates
        // the title at 32 chars and refuses a newline in it.
        var sctTitle = String(ev.title || "").replace(/\s+/g, " ").slice(0, 32);
        return { type: "serverchan", req: { url: target.url, contentType: formType, noCorsType: formType, headers: {}, body: "title=" + encodeURIComponent(sctTitle) + "&desp=" + encodeURIComponent(text) } };
      }
      if (target.type === "wxpusher") {
        var uids = target.uid.split(/[,;\s]+/).filter(function (s) { return !!s; });
        return { type: "wxpusher", req: { url: target.url, contentType: jsonType, noCorsType: plainType, headers: {}, body: JSON.stringify({ appToken: target.token, content: text, summary: ev.title, contentType: 1, uids: uids }) } };
      }
      // custom: the generic event plus the rendered text, so a plain endpoint
      // (or a chat relay) can use either the fields or the text.
      req = {
        url: target.url,
        contentType: jsonType,
        noCorsType: plainType,
        headers: {},
        body: JSON.stringify({
          source: "dsh-notify-me",
          version: api.version,
          event: ev.kind,
          title: ev.title,
          body: ev.body,
          text: text,
          sessionId: ev.sessionId || null,
          time: ev.time
        })
      };
      if (target.secret) {
        // Outbound proof that the request came from this browser: the receiver
        // recomputes HMAC-SHA256(secret, raw body) and compares. Custom headers
        // make the request preflighted, so this only works on an endpoint that
        // answers OPTIONS — the opaque fallback cannot carry it.
        req.headers["X-DSH-Notify-Signature"] = "sha256=" + bytesToHex(hmacSha256(target.secret, req.body));
        req.headers["X-DSH-Notify-Timestamp"] = ev.time;
      }
      return { type: "custom", req: req };
    }
    // HTTP status / service code -> {status, retry}. Only transient failures are
    // worth another attempt; a wrong token or a malformed endpoint is not.
    function externalVerdict(type, res, bodyText) {
      if (!res) return { status: "failed (no response)", retry: true };
      if (!res.ok) {
        var retry = res.status >= 500 || res.status === 429;
        return { status: "failed (HTTP " + res.status + ")", retry: retry };
      }
      var parsed = null;
      if (bodyText) { try { parsed = JSON.parse(bodyText); } catch (e) { parsed = null; } }
      if (type === "feishu" || type === "serverchan" || type === "wxpusher") {
        // These answer 200 with a service code; a wrong token shows up there,
        // not in the HTTP status. DingTalk does the same but cannot be reached
        // from a page at all, hence no branch for it. Anything else on a 2xx —
        // an empty body, a proxy or WAF HTML page — cannot confirm delivery,
        // so it is unverified rather than a success the user never got.
        if (!parsed || typeof parsed !== "object") return { status: "unverified", retry: false };
        var code = parsed.code;
        var okCode = type === "wxpusher" ? 1000 : 0;
        if (code === okCode) return { status: "sent", retry: false };
        var msg = parsed.error || parsed.message || parsed.info || parsed.msg || ("code " + code);
        return { status: "failed (" + String(msg).slice(0, 120) + ")", retry: false };
      }
      return { status: "sent", retry: false };
    }
    // One attempt. Resolves to {status, retry}; never rejects.
    function postOnce(spec, plain, type) {
      var headers = {};
      headers["Content-Type"] = plain ? spec.noCorsType : spec.contentType;
      if (!plain) {
        for (var k in spec.headers) {
          if (Object.prototype.hasOwnProperty.call(spec.headers, k)) headers[k] = spec.headers[k];
        }
      }
      return fetch(spec.url, {
        method: "POST",
        mode: plain ? "no-cors" : "cors",
        cache: "no-store",
        headers: headers,
        body: spec.body
      }).then(function (res) {
        if (plain) return { status: "unverified", retry: false, reason: "opaque" }; // opaque: the request left, the reply is unreadable — which is not the same as delivered
        // Some hosts (and the smoke harness) hand back a response-like object
        // without a body reader; the HTTP status is then all there is to judge.
        if (typeof res.text !== "function") return externalVerdict(type, res, "");
        return res.text().then(function (text) {
          return externalVerdict(type, res, text);
        }, function () {
          return externalVerdict(type, res, "");
        });
      });
    }
    // Bark's path form: url/<title>/<body>. A plain GET first (readable), then
    // a no-cors GET — which the browser always hands back, so treat it as
    // unverified rather than guaranteed.
    function barkGet(url, ev) {
      var u = url.replace(/\/+$/, "") + "/" + encodeURIComponent(ev.title || "DSH") + "/" + encodeURIComponent(ev.body || "");
      return fetch(u, { method: "GET", cache: "no-store" }).then(function (res) {
        return res && res.ok ? { status: "sent", retry: false } : Promise.reject(new Error("HTTP " + (res ? res.status : "?")));
      }).catch(function () {
        return fetch(u, { method: "GET", mode: "no-cors", cache: "no-store" }).then(function () { return { status: "unverified", retry: false }; });
      });
    }
    // A configured target that names the relay's own upstream gateway cannot be
    // reached from a browser at all: a Basic-auth request becomes a preflight
    // the gateway answers without any Access-Control-Allow-* header, and the
    // opaque no-cors fallback is a *cross-site* POST, which Apprise refuses
    // outright ("Cross-site request rejected"). Both paths end in
    // `unverified` — the page says the alert went out and the phone never
    // rings. The host already runs a same-origin relay to exactly that
    // gateway, so such a target is folded onto the relay route: same origin
    // means no preflight and no cross-site refusal, and the host adds the
    // credential, which is what makes the verdict a real "sent".
    // Only `custom` is folded: every other type posts to a service that is not
    // this gateway, and the relay would forward it to the wrong place.
    // The host *and* the path must name the relay's own endpoint: one gateway
    // usually serves several notify keys, and folding a target that points at a
    // different key would send that alert to the relay's key instead.
    // A target with a signature secret is never folded either: the signature is
    // computed here from the secret, and the relay has no way to carry it, so
    // the endpoint would receive an unsigned request instead.
    function relayFoldPath(target) {
      if (!target || target.type !== "custom") return null;
      if (!hostBridgeState.relayEnabled || !hostBridgeState.relayPath) return null;
      var upstream = hostBridgeState.relayUpstreamHost;
      var upstreamPath = hostBridgeState.relayUpstreamPath;
      if (!upstream || !upstreamPath) return null;
      if (target.secret) return null;
      var m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)/i.exec(String(target.url || ""));
      if (!m) return null;
      // An IPv6 literal keeps its brackets in `URL.hostname`, so it is unwrapped
      // on both sides of the comparison below (a bare split on ":" would cut the
      // address down to "[").
      var authority = m[1].split("@").pop();
      var bracketed = /^\[([^\]]+)\]/.exec(authority);
      var host = bracketed ? bracketed[1].toLowerCase() : authority.split(":")[0].toLowerCase();
      if (host !== upstream) return null;
      if (trimTailSlash(m[2].length > 0 ? m[2] : "/") !== upstreamPath) return null;
      var here = "";
      try { here = String(location.hostname || "").toLowerCase().replace(/^\[/, "").replace(/\]$/, ""); } catch (e) { here = ""; }
      // Already same-origin with this page (a relay address the user pasted
      // as-is): the fold would only replace one same-origin POST with another.
      if (here && host === here) return null;
      return hostBridgeState.relayPath;
    }
    function deliverAttempt(target, ev) {
      if (typeof fetch !== "function") return Promise.resolve({ status: "failed (no fetch)", retry: false });
      var built;
      try { built = externalRequest(target, ev); } catch (e) { return Promise.resolve({ status: "failed (payload)", retry: false }); }
      var spec = built.req;
      // Folded onto the same-origin relay: the path is relative, so `fetch`
      // keeps the request on this page's own origin. The payload is the custom
      // one — the relay reads title/body/type out of it and nothing else. The
      // intent header is what the relay requires on POST: a cross-site form post
      // cannot set it without a preflight, so it never reaches the gateway.
      var folded = relayFoldPath(target);
      if (folded) {
        spec = { url: folded, contentType: spec.contentType, noCorsType: spec.noCorsType, headers: { "x-dsh-notify-me-relay": "relay" }, body: spec.body };
      }
      return postOnce(spec, false, built.type).then(function (r) {
        if (!folded || !r) return r;
        // The relay answers with the gateway's real status, so this branch is
        // only reached when the relay itself refused (403 for a page whose
        // origin is missing from allowedOrigins, 5xx for a broken host). Name
        // the route in the verdict: the user is looking at a direct-gateway
        // address and needs to know the relay is what failed.
        r.reason = "via-relay";
        return r;
      }).catch(function (err) {
        var msg = "failed (" + (err && err.message ? err.message : String(err)) + ")";
        // Folded targets travel same-origin, so a refusal here is a real fault
        // (the relay route is gone, or this page's origin/Host is not in
        // allowedOrigins) and not something the opaque fallback can paper over.
        if (folded) return { status: msg, retry: false, reason: "via-relay" };
        // The browser refused the exchange (CORS or the network): the opaque
        // path still gets the request out, only the reply is unreadable.
        return postOnce(spec, true, built.type).catch(function () {
          if (built.type !== "bark") return { status: msg, retry: true };
          return barkGet(target.url, ev).then(null, function () { return { status: msg, retry: true }; });
        });
      });
    }
    function externalRetryDelays() {
      var d = config.externalRetryDelays;
      if (!Array.isArray(d)) return [2000, 6000];
      var out = [];
      for (var i = 0; i < d.length && out.length < 4; i++) {
        var v = d[i];
        if (typeof v === "number" && isFinite(v) && v >= 0) out.push(Math.min(v, 60000));
      }
      return out;
    }
    function readExternalDead() {
      try {
        var raw = localStorage.getItem(LS_EXTERNAL_DEAD);
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    }
    function addExternalDead(entry) {
      var list = readExternalDead();
      list.unshift(entry);
      if (list.length > EXTERNAL_DEAD_MAX) list = list.slice(0, EXTERNAL_DEAD_MAX);
      try { localStorage.setItem(LS_EXTERNAL_DEAD, JSON.stringify(list)); } catch (e) {}
    }
    function clearExternalDead() {
      try { localStorage.removeItem(LS_EXTERNAL_DEAD); } catch (e) {}
    }
    var externalHealth = (function () {
      try {
        var raw = localStorage.getItem(LS_EXTERNAL_HEALTH);
        var o = raw ? JSON.parse(raw) : null;
        return o && typeof o === "object" ? o : {};
      } catch (e) { return {}; }
    })();
    function recordExternalHealth(id, status, attempts, reason) {
      if (!id) return;
      externalHealth[id] = { status: status, at: new Date().toISOString(), attempts: attempts || 1, reason: reason || "" };
      try {
        var keys = Object.keys(externalHealth);
        if (keys.length > 40) for (var i = 0; i < keys.length - 40; i++) delete externalHealth[keys[i]];
        localStorage.setItem(LS_EXTERNAL_HEALTH, JSON.stringify(externalHealth));
      } catch (e) {}
    }
    function maskExternalUrl(url) {
      // The path of a webhook is usually the secret itself (Discord, Bark,
      // Feishu hook id); the host is enough to recognise the target later.
      // Deliberately not `new URL()`: this also runs in hosts whose page
      // container lacks the URL global.
      var m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(url || ""));
      if (!m) return "";
      return m[1].split("@").pop();
    }
    // At-least-once delivery: transient failures are retried on the configured
    // backoff with jitter (a page full of targets must not come back in
    // lockstep). A final failure is written to the dead-letter log — the alert
    // itself was already shown locally, so this log is the only trace that the
    // phone did not get it.
    // Same target across two externalTargets() reads: the list is rebuilt from
    // the config on every call, so identity cannot be compared.
    function sameExternalTarget(a, b) {
      if (a.id && b.id) return a.id === b.id;
      return a.type === b.type && a.url === b.url;
    }
    function externalTargetStillWanted(target) {
      var list = externalTargets();
      for (var i = 0; i < list.length; i++) if (sameExternalTarget(list[i], target)) return true;
      return false;
    }
    function sendToTarget(target, ev, forced) {
      var delays = externalRetryDelays();
      var attempts = 0;
      // Switching forwarding off (or deleting / disabling the target) has to
      // stop a retry chain that is already asleep on a timer: without this the
      // browser kept posting to an endpoint the user had just turned off, and
      // logged the aborted delivery as a failure (`forced` marks the explicit
      // test button, which posts even while forwarding is off).
      function wanted() {
        if (!forced && !config.externalEnabled) return false;
        return externalTargetStillWanted(target);
      }
      function run() {
        if (!wanted()) return Promise.resolve({ status: "cancelled" });
        attempts++;
        return deliverAttempt(target, ev).then(function (r) {
          if (r.status === "sent" || r.status === "unverified") return r;
          if (!r.retry || attempts > delays.length) return r;
          if (!wanted()) return { status: "cancelled" };
          var wait = Math.round(delays[attempts - 1] * (1 + Math.random() * 0.25));
          return new Promise(function (resolve) { setTimeout(function () { resolve(run()); }, wait); });
        });
      }
      return run().then(function (r) {
        if (r.status === "cancelled") return r.status;
        var failed = r.status.indexOf("failed") === 0;
        // An `unverified` verdict carries its own reason too (an opaque reply,
        // or a folded delivery that went out through the relay): the settings
        // row shows it, because "sent but unconfirmed" with no explanation is
        // exactly the state that made a non-delivery look like a success.
        var reason = failed ? r.status.slice(7) : (r.reason || "");
        recordExternalHealth(target.id, r.status, attempts, reason);
        if (failed) {
          externalStat.failed++;
          addExternalDead({
            at: new Date().toISOString(),
            targetId: target.id || "",
            type: target.type,
            host: maskExternalUrl(target.url),
            title: String(ev.title || "").slice(0, 120),
            body: String(ev.body || "").slice(0, 280),
            status: r.status,
            attempts: attempts
          });
        } else if (r.status === "sent") externalStat.sent++;
        else externalStat.unverified++;
        if (attempts > 1) externalStat.retried++;
        externalStat.lastAt = new Date().toISOString();
        externalStat.lastStatus = r.status;
        return r.status;
      });
    }
    // Mirror one delivered alert to every enabled target. The alert path is
    // fire-and-forget — the toast must never wait on the network; `onDone`
    // exists for the settings test button, which wants the verdict.
    // The per-kind toggles gate real alerts only; the test button posts
    // regardless (that is the point of a channel test).
    function dispatchExternal(kind, title, body, sessionId, onDone) {
      if (!config.externalEnabled) return;
      if (kind === "attention" && !config.externalAttention) return;
      if (kind === "done" && !config.externalDone) return;
      sendExternalToAll(kind, title, body, sessionId, false, onDone);
    }
    function sendExternalToAll(kind, title, body, sessionId, forced, onDone) {
      var targets = externalTargets();
      if (!targets.length) { if (typeof onDone === "function") onDone([]); return; }
      var ev = {
        kind: kind,
        title: title,
        body: body || "",
        sessionId: sessionId || null,
        time: new Date().toISOString()
      };
      var ps = [];
      for (var i = 0; i < targets.length; i++) {
        try { ps.push(sendToTarget(targets[i], ev, !!forced)); } catch (e) { ps.push(Promise.resolve("failed (dispatch)")); }
      }
      if (typeof onDone === "function") Promise.all(ps).then(onDone, function () {});
    }

    // ────────────────────────── title marker ─────────────────────────
    // The host owns document.title (it tracks the session/workspace name), so
    // the base title is re-read on every apply instead of being frozen once —
    // and the exact string we last wrote is remembered, so the host taking the
    // title over (or an earlier load leaving a marker behind) can never make us
    // mistake our own marker for the base title.
    var attentionActive = 0;
    var doneActive = 0; // "完成未读" marks, one per finished-but-unread session
    var hostBase = null; // document.title as the host last left it
    var writtenTitle = null; // exact string this plugin last put into document.title
    // Our own marker prefixes never belong to the base title — strip leftovers
    // (an earlier load that was closed while a mark was up, or a title the host
    // tracked while a marker was up) before storing the base. Both marker kinds
    // can be up at once and either may lead, so strip repeatedly.
    function cleanBase(t) {
      var d = texts();
      var prefixes = [d.marker, TXT.zh.marker, TXT.en.marker, d.doneMarker, TXT.zh.doneMarker, TXT.en.doneMarker];
      var stripped = true;
      while (stripped) {
        stripped = false;
        for (var i = 0; i < prefixes.length; i++) {
          if (prefixes[i] && t.indexOf(prefixes[i]) === 0) {
            t = t.slice(prefixes[i].length);
            stripped = true;
          }
        }
      }
      return t;
    }
    function applyTitle() {
      try {
        var current = String(document.title || "");
        if (current !== writtenTitle) hostBase = cleanBase(current);
        var d = texts();
        var prefix = "";
        if (config.enabled) {
          // "needs you" leads when both kinds are up: it is the one that wants
          // action, the unread mark only says something finished.
          if (attentionActive > 0) prefix += d.marker;
          if (doneActive > 0) prefix += d.doneMarker;
        }
        var next = prefix + hostBase;
        writtenTitle = next;
        if (current !== next) document.title = next;
      } catch (e) {}
    }
    function acquireTitleMark() {
      attentionActive += 1;
      applyTitle();
    }
    function releaseTitleMark() {
      if (attentionActive > 0) attentionActive -= 1;
      applyTitle();
    }
    // Unread-reply marker: one per session id, held exactly while the host
    // still calls the completion unread (sessionStatus.completionUnread on
    // 0.1.6+, the list row's `completed` reminder bit on older hosts) and
    // dropped the moment the session is opened — the tab then reads "something
    // finished, waiting for you" until it is read.
    var doneUnreadMarks = Object.create(null); // sid -> true
    function markDoneUnread(sid) {
      if (!sid || doneUnreadMarks[sid]) return;
      doneUnreadMarks[sid] = true;
      doneActive += 1;
      applyTitle();
    }
    function unmarkDoneUnread(sid) {
      if (!sid || !doneUnreadMarks[sid]) return;
      delete doneUnreadMarks[sid];
      if (doneActive > 0) doneActive -= 1;
      applyTitle();
    }
    // Title marker ownership: on hosts that publish pending interactions
    // (uiSession) that source owns the marker, but whichever source saw the wait
    // first must still mark it (the other one may never report that key at all),
    // so the mark is acquired by the first reporter and released only by its
    // owner. Without this, the two sources would either double-mark or never
    // clear the mark.
    function markAttention(key) {
      if (attentionKeysMarked[key]) return;
      attentionKeysMarked[key] = true;
      acquireTitleMark();
    }
    function unmarkAttention(key, keepPending) {
      delete quietedAttention[key]; // the wait is over; a queued alert dies with it
      // A toast that still carries buttons for this wait dies with it too —
      // otherwise a settled request would leave a clickable (but stale)
      // approval toast behind. A test toast releases its title mark long before
      // its buttons are done being useful, so that call passes keepPending: the
      // record stays until the later unmark(), which closes the toast with it.
      // Without that the buttons went dead while the toast was still on screen.
      var rec = pendingActions[key];
      if (rec && !(keepPending && rec.test)) {
        delete pendingActions[key];
        closeNotificationTag(rec.tag);
      }
      if (!attentionKeysMarked[key]) return;
      delete attentionKeysMarked[key];
      releaseTitleMark();
    }

    // ─────────────────────── shared alert core ───────────────────────
    var attentionKeysFired = Object.create(null); // dedupe per pending key
    var attentionKeysMarked = Object.create(null); // keys currently holding a title mark
    // Waits silenced because their session is the one on screen, keyed by
    // interaction key so an entry dies with the wait it belongs to (the mark
    // release path deletes it) and is re-delivered once the page is backgrounded.
    var quietedAttention = Object.create(null);
    var lastAttentionAt = 0;
    // One completion can reach this plugin twice: the running edge from the
    // controller snapshots and the completionUnread level flag from
    // sessionStatus are two views of the same host event and land in the same
    // tick (the host publishes both stores from one manager update). A short
    // per-session window collapses them; two genuine completions of one session
    // are never that close — each needs a whole turn in between.
    var doneFiredAt = Object.create(null); // sid -> last done report timestamp
    var DONE_DEDUPE_MS = 250;

    function hidden() { return document.hidden || document.visibilityState === "hidden"; }

    // "Background" is not the same as "hidden": a desktop window sitting behind
    // another app, or a browser tab on a second monitor, still reports itself as
    // visible. Only a minimised or fully occluded window flips document.hidden,
    // so the reminders that are meant to reach a user who walked away stayed
    // silent whenever the window was merely covered. Window focus is the missing
    // half of the signal: an unfocused page counts as away.
    var pageFocused = true;
    try {
      if (typeof document.hasFocus === "function") pageFocused = document.hasFocus() !== false;
    } catch (e) {}
    function onPageFocus() { pageFocused = true; }
    function onPageBlur() {
      pageFocused = false;
      // Walking away is what re-arms the waits kept quiet because they belonged
      // to the conversation on screen; a blur alone never fires visibilitychange.
      try { flushQuieted(); } catch (e) {}
    }
    // Focus answers "is the window in front", not "is anyone there". A window
    // left in front while its owner walks off still reports focus forever, so
    // track real input and treat a page nobody has touched for `idleMinutes` as
    // away too. Everything that keys on away() benefits without changing shape.
    var lastActivityAt = Date.now();
    function noteActivity() {
      lastActivityAt = Date.now();
      if (!idleTimer) armIdle();
    }
    // Registered from the watchers effect (see apply below) so a client-plugin
    // reload removes the previous set instead of stacking another one.
    var ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
    function idleMinutes() {
      var m = config && config.idleMinutes;
      return (typeof m === "number" && isFinite(m) && m > 0) ? m : 0;
    }
    function idleExpired() {
      var m = idleMinutes();
      return m ? (Date.now() - lastActivityAt) >= m * 60000 : false;
    }
    // Going idle is the one "away" transition that fires no event: the quieted
    // queue is normally flushed by a blur or a visibility change, and neither
    // comes when the user simply stops touching a window that stays in front.
    // The wait queued ten seconds before they walked off would then stay silent
    // until they came back. Re-check exactly when the idle window closes.
    var idleTimer = null;
    function onIdleCheck() {
      idleTimer = null;
      if (!idleExpired()) { armIdle(); return; }
      try { flushQuieted(); } catch (e) {}
    }
    function armIdle() {
      var m = idleMinutes();
      if (!m) return;
      var left = m * 60000 - (Date.now() - lastActivityAt);
      if (left < 0) left = 0;
      try { clearTimeout(idleTimer); } catch (e) {}
      try { idleTimer = setTimeout(onIdleCheck, left); } catch (e) { idleTimer = null; }
    }
    function away() { return hidden() || !pageFocused || idleExpired(); }
    function donePolicy() {
      var p = config && config.donePolicy;
      return p === "smart" || p === "always" ? p : "background";
    }
    // True when this completion must stay silent. Only "smart" looks at which
    // conversation finished: the one on screen is already being read, but one
    // further down the sidebar is information the user does not have yet.
    function doneSuppressed(isCurrent) {
      var p = donePolicy();
      if (p === "always") return false;
      if (p === "smart") return !!isCurrent && !away();
      return !away();
    }

    // Deliver one alert regardless of visibility rules (used by the test
    // buttons); respects the master switch and permission state. The title
    // marker is NOT touched here — its ownership belongs to the watchers
    // (markAttention / unmarkAttention), which keeps the counter balanced.
    function notifyEvent(kind, payload) {
      try {
        if (window.__dshNotifyMe && window.__dshNotifyMe.onEvent) {
          window.__dshNotifyMe.onEvent(kind, payload);
        }
      } catch (e) {}
    }
    function deliver(kind, title, body, sessionId, quick) {
      if (!config.enabled) return;
      showToast(kind, title, body, sessionId, quick);
      if (kind === "attention") {
        playAttentionSound();
      } else {
        playDoneSound();
      }
      notifyEvent(kind, { title: title, body: body, sessionId: sessionId || null });
    }
    function fire(kind, title, body, isCurrent, sessionId, quick) {
      if (!config.enabled) return false;
      // A session silenced from the sidebar row gets no toast, no sound and no
      // forwarded copy, whatever the other rules say. Queued wait copies are
      // filtered here too, because flushQuieted() calls back into this function.
      if (isSessionMuted(sessionId)) return false;
      if (kind === "attention" && config.attentionHiddenOnly && !away()) return false;
      // The wait belongs to the conversation the user is looking at right now:
      // the request is already on screen. The caller keeps the tab marker, and
      // flushQuieted() re-delivers the alert once the page is away.
      if (kind === "attention" && quietedByVisibleSession(isCurrent)) return false;
      if (kind === "done" && doneSuppressed(isCurrent)) return false;
      deliver(kind, title, body, sessionId, quick);
      // The alert reached the user locally (or would have, had the tab a
      // voice): mirror the same copy to the outside world. Fire-and-forget —
      // a slow endpoint must never delay or break the local alert.
      try { dispatchExternal(kind, title, body, sessionId); } catch (e) {}
      return true;
    }
    // True when this alert must stay silent purely because it is about the
    // session already on screen. Kept separate from fire() so the caller can
    // queue exactly this case and nothing else.
    function quietedByVisibleSession(isCurrent) {
      return !!(isCurrent && config.currentHiddenOnly && !away());
    }
    // Queued copies of the alerts that rule suppressed. Delivered by key so a
    // wait that got answered while the user was still on the page never fires.
    function queueQuieted(key, copy) {
      if (key && copy) {
        quietedAttention[key] = copy;
        armIdle();
      }
    }
    function flushQuieted() {
      if (!config.enabled || !away()) return;
      var keys = Object.keys(quietedAttention);
      for (var i = 0; i < keys.length; i++) {
        var copy = quietedAttention[keys[i]];
        delete quietedAttention[keys[i]];
        fire("attention", copy.title, copy.body, false, copy.sessionId, copy.quick || null);
      }
    }
    // A display label for a session row; an empty label and the legacy
    // "current" sentinel fall back to the localized "当前对话 / Current
    // conversation" placeholder, which now only stands in for a session whose
    // title the list cannot supply yet.
    function sessionLabelText(row) {
      var raw = row && row.label;
      if (!raw || raw === "current") return texts().current;
      return raw;
    }
    // The session's own sidebar title, or "" while the host has not published
    // one (a brand-new session) or the list does not carry the row at all.
    // Read live, so a title the host fills in later reaches the next alert.
    function sessionTitleOf(sid) {
      try {
        var st = listStore && listStore.getSnapshot();
        var sum = st && st.byId && st.byId[sid];
        if (sum) return sum.displayTitle || sum.title || "";
      } catch (e) {}
      return "";
    }
    // The session the user is looking at, or null while the list is not ready.
    // Two host generations own this fact differently:
    //   * <= 0.1.5-rc.3: the list snapshot carried `current`;
    //   * 0.1.6+ (incl. 0.2.0-rc.2): `current` is gone and the main view's
    //     retention count marks the on-screen session — the shipped
    //     DocumentTitle, ui-workspace browser and ui-session isMain() all
    //     derive it exactly this way.
    function currentSessionId() {
      try {
        var st = listStore && listStore.getSnapshot();
        if (!st) return null;
        if (typeof st.current === "string" && st.current) return st.current;
        var byId = st.byId || {};
        for (var id in byId) {
          var row = byId[id];
          if (row && row.retainedBy && (row.retainedBy.mainView || 0) > 0) return id;
        }
      } catch (e) {}
      return null;
    }
    // Display label for a session id we only know from the interaction map:
    // the list row's title, the localized "current" placeholder for the selected
    // session, the raw id as a last resort.
    function labelForSessionId(sid) {
      try {
        var st = listStore && listStore.getSnapshot();
        if (st) {
          var sum = st.byId && st.byId[sid];
          if (sum) return sessionLabelText({ label: sum.displayTitle || sum.title || "" });
          if (currentSessionId() === sid) return texts().current;
        }
      } catch (e) {}
      return sid;
    }
    // Should this session's alerts stay muted as a subagent? Every child session
    // a subagent run created is listed as a row carrying `origin: 'subagent'`
    // (plus a parentId), including the rows the host synthesizes from its
    // subagentCatalog. Those alerts describe a step of another conversation's
    // turn, so the ones running in the background are muted by default
    // (config.ignoreSubagent); a forked session has a parentId but no origin and
    // is the user's own conversation, so it keeps alerting. The subagent session
    // the user has open is not background at all: it is on screen like any other
    // conversation, so it alerts by the normal rules (including the
    // current-conversation quiet rule) and is never a mute candidate. Read live
    // rather than cached, so the settings switch and session switches both take
    // effect on the next event without rebinding anything.
    function isSubagentSession(sid, currentId) {
      if (!config.ignoreSubagent || !sid) return false;
      // Reuse the caller's derivation when it has one. Every row walk already
      // knows the on-screen session (onListChanged derives it once and then
      // calls this per row), and deriving it again inside the row rescans the
      // whole list: O(rows x sessions) on 0.1.6+ hosts, where the list snapshot
      // has no `current` and the on-screen row has to be found by walking byId.
      if ((currentId === undefined ? currentSessionId() : currentId) === sid) return false;
      try {
        var st = listStore && listStore.getSnapshot();
        var sum = st && st.byId && st.byId[sid];
        if (sum && sum.origin === "subagent") return true;
      } catch (e) {}
      return false;
    }
    // Returns null once the alert went out, or the copy it would have shown
    // when only the visible-session rule held it back — the caller queues that
    // copy by interaction key so it can still fire from the background (the
    // quick-decision payload rides along with the copy).
    function fireAttention(kind, sessionLabel, detail, isCurrent, sessionId, quick) {
      var d = texts();
      var label = d.kind[kind] || d.kindDefault;
      var content = detail || d.bodyKind[kind] || d.bodyDefault;
      var who = sessionLabel || "";
      var title = "DSH · " + label;
      var body = (who ? who + d.sep : "") + content;
      if (quietedByVisibleSession(isCurrent)) return { title: title, body: body, sessionId: sessionId || null, quick: quick || null };
      fire("attention", title, body, isCurrent, sessionId, quick);
      return null;
    }
    function fireDone(sessionLabel, snippet, sessionId) {
      var d = texts();
      var body = sessionLabel || d.doneBody;
      if (snippet) body = body + "\n" + snippet;
      fire("done", d.doneTitle, body, !!(sessionId && sessionId === currentSessionId()), sessionId);
    }
    // Every "reply finished" report funnels through here, so the edge path and
    // the completionUnread level flag cannot double-alert one completion. The
    // timestamp is recorded even when the visibility rules suppress the toast:
    // the report was handled (the unread marker is what persists), not queued.
    function reportDone(sessionLabel, snippet, sessionId) {
      if (sessionId) {
        var now = Date.now();
        if (doneFiredAt[sessionId] && now - doneFiredAt[sessionId] < DONE_DEDUPE_MS) return;
        doneFiredAt[sessionId] = now;
      }
      fireDone(sessionLabel, snippet, sessionId);
    }
    // Test alerts deliberately ignore the visibility rules (attentionHiddenOnly
    // / doneHiddenOnly): the whole point of a test button is to prove the
    // channel works while you are looking at the page. Only the master switch
    // (and browser notification permission) can stop them. The attention test
    // also drops its title marker again shortly after, so a test never leaves a
    // standing "waiting on you" mark in the tab.
    var TEST_MARK_RELEASE_MS = 6000;
    var TEST_MARK_KEY = "test:attention";
    function testAlert(kind) {
      var d = texts();
      if (kind === "approval") {
        // End-to-end proof of the quick-decision path: this toast carries the
        // same 同意/拒绝 buttons as a real approval one, and clicking them runs
        // the whole worker-bridge -> decidePending() chain (settling nothing
        // real — the feedback toast says so).
        // Short on purpose: this key ends up inside the toast tag, which the
        // platform caps (see toastTag). "t" + base36(ms) is 10 characters, so
        // the tag lands at 33; "test:approval:<13-digit ms>" made 51 and was
        // refused on the desktop page, where the budget is 48 (issue #18).
        var key = "t" + Date.now().toString(36);
        var quick = quickForTest(key);
        deliver("attention", "DSH · " + d.kind.approval, d.testApproval, null, quick);
        markAttention(key);
        // The title mark drops like every other test's, but the toast outlives
        // it — its buttons are the very thing being tested. It gets the same
        // 12 s a real approval toast has on the constructor path, then the
        // record and the toast go together.
        setTimeout(function () { unmarkAttention(key, true); }, TEST_MARK_RELEASE_MS);
        setTimeout(function () { unmarkAttention(key); }, 12000);
        return;
      }
      if (kind === "attention") {
        deliver("attention", "DSH · " + d.kind.question, d.testAttention);
        markAttention(TEST_MARK_KEY);
        setTimeout(function () { unmarkAttention(TEST_MARK_KEY); }, TEST_MARK_RELEASE_MS);
      } else {
        deliver("done", d.doneTitle, d.testDone);
      }
    }

    // ───────────────────────── state machine ─────────────────────────
    // prevById: per-session-id baseline of what we have already reported.
    //   { running: bool, pendingKeys: string[] , doneArmed: bool, seeded: bool }
    var prevById = Object.create(null);
    // A row absent from this many list updates is gone, not asleep: dropping
    // its baseline bounds the map on long-lived pages (subagent sessions come
    // and go), while a short absence keeps the no-replay guarantee.
    var BASELINE_MISSING_LIMIT = 40;
    var faceSub = null; // current session face unsubscribe
    var currentFaceId = null;
    var listStore = null;
    var rootCtx = null; // client cordis context, captured at apply()
    // uiSession pending-interaction watcher (DSH >= 0.1.2-alpha.2)
    var uiPending = false; // true once the interaction snapshot is readable
    var uiSub = null;
    var uiStore = null; // the interaction store we hold a subscription on
    var uiSource = null; // 'sessionStatus' (0.1.6+) | 'pendingInteractions' (0.1.2-0.1.5)
    var uiBindNote = "not attempted"; // last lookup outcome, read by __dshNotifyMe.debug()
    var uiWarned = false; // one unreachable-service warning per page load
    var uiBaseline = Object.create(null); // sessionId -> { key: string }

    // One-line detail for a pending interaction. Two shapes reach this:
    //   * the pre-0.1.2 controller payload (approval/question requested frames)
    //     — flat, its text under `text`/`question`/…;
    //   * the 0.1.2+ uiSession interaction objects — class instances whose own
    //     fields are the detail (PendingApproval: toolName/reason/callId,
    //     PendingQuestion: questions[]).
    function textFromPayload(payload) {
      if (!payload || typeof payload !== "object") return "";
      function clip(s) {
        s = String(s).replace(/\s+/g, " ").trim();
        if (!s) return "";
        return s.length > 160 ? s.slice(0, 160) + "…" : s;
      }
      // scalar fields (covers the flat pre-0.1.2 payloads and PendingApproval)
      var keys = ["text", "question", "prompt", "title", "summary", "description", "message", "operation", "toolName", "reason", "name", "tool"];
      for (var i = 0; i < keys.length; i++) {
        var v = payload[keys[i]];
        if (typeof v === "string") {
          var s = clip(v);
          if (s) {
            // PendingApproval carries both the tool and the human-readable
            // reason — "pwsh" alone says nothing useful in a toast.
            if (keys[i] === "toolName" && typeof payload.reason === "string" && clip(payload.reason)) {
              return s + " · " + clip(payload.reason);
            }
            return s;
          }
        } else if (v && typeof v === "object" && typeof v.text === "string" && clip(v.text)) {
          return clip(v.text);
        }
      }
      // nested batches (PendingQuestion.questions -> { question, detail, options })
      var qs = payload.questions;
      if (Array.isArray(qs) && qs.length > 0) {
        var q = qs[0];
        if (typeof q === "string") return clip(q);
        if (q && typeof q === "object") {
          var qk = ["question", "title", "text", "detail"];
          for (var j = 0; j < qk.length; j++) {
            if (typeof q[qk[j]] === "string" && clip(q[qk[j]])) return clip(q[qk[j]]);
          }
        }
      }
      return "";
    }
    function snippetOfLastAssistant(snap) {
      try {
        var nodes = snap.nodes || [];
        for (var i = nodes.length - 1; i >= 0; i--) {
          var nd = nodes[i];
          if (nd && nd.kind === "assistant" && nd.blocks) {
            for (var b = nd.blocks.length - 1; b >= 0; b--) {
              if (nd.blocks[b] && nd.blocks[b].kind === "text" && nd.blocks[b].text) {
                var t = nd.blocks[b].text.replace(/\s+/g, " ").trim();
                if (t) return t.length > 80 ? t.slice(0, 80) + "…" : t;
              }
            }
          }
        }
      } catch (e) {}
      return "";
    }
    // Evaluate one row/face observation. row: {id, running, pending:[{key,kind,payload}], completed, label, face:bool, currentId?}
    function evaluateRow(row) {
      var prev = prevById[row.id];
      var runningNow = !!row.running;
      var pendingNow = row.pending || [];
      var prevPendingKeys = prev ? prev.pendingKeys : [];
      var wasRunning = prev ? prev.running : false;
      var muted = alertMutedFor(row.id, row.currentId);
      var newKeys = [];
      // A muted row still feeds the baseline below, so lifting the mute
      // (turning the switch off, or opening that subagent session) resumes
      // alerting from the next edge on instead of replaying old ones.
      // Its keys are left out of attentionKeysFired on purpose: a wait that was
      // never announced must stay announceable once the mute is lifted.
      if (!muted) {
        for (var i = 0; i < pendingNow.length; i++) {
          var pk = pendingNow[i].key;
          if (prevPendingKeys.indexOf(pk) === -1 && !attentionKeysFired[pk]) {
            newKeys.push(pendingNow[i]);
            attentionKeysFired[pk] = true;
          }
        }
      }
      var hasPendingNow = pendingNow.length > 0;

      // 1) a pending interaction just appeared -> the agent is waiting on the user.
      //    First evaluation of a session also lands here (prevPendingKeys empty),
      //    so a wait that already existed when the plugin (or page) mounted still
      //    alerts once.
      //    On hosts that expose uiSession this is the fallback path only: the
      //    interaction snapshot there is the authoritative source, and it drives
      //    the title marker itself (see the uiSession watcher below).
      if (!muted && newKeys.length > 0) {
        var it = newKeys[0];
        var quick = quickFor(it.key, it, row.id);
        var copy = fireAttention(it.kind, sessionLabelText(row), textFromPayload(it.payload), !!row.face, row.id, quick);
        if (copy) queueQuieted(it.key, copy);
        lastAttentionAt = Date.now();
        markAttention(it.key);
      }

      // 2) a non-selected session finished while we were away (sidebar "done")
      var notified = false;
      if (!muted && !row.face && row.completed && prev && !prev.completed && prev.seeded) {
        reportDone(sessionLabelText(row), "", row.id);
        notified = true;
      }

      // 3) running true -> false on a session we were watching: a reply finished
      if (!muted && !notified && prev && prev.seeded && wasRunning && !runningNow && !hasPendingNow) {
        // ignore the edge if it happened in the same tick as an attention alert
        if (Date.now() - lastAttentionAt < 300) {
          /* answered by an attention alert above */
        } else {
          reportDone(sessionLabelText(row), row.face ? snippetOfLastAssistant(row.faceSnap) : "", row.id);
        }
      }

      // store the next baseline
      prevById[row.id] = {
        running: runningNow,
        pendingKeys: pendingNow.map(function (p) { return p.key; }),
        completed: !!row.completed,
        seeded: true,
        missing: 0
      };

      // a wait we alerted about has been resolved -> drop the title marker
      if (!uiPending && prev && prevPendingKeys.length > 0 && pendingNow.length === 0) {
        for (var r = 0; r < prevPendingKeys.length; r++) unmarkAttention(prevPendingKeys[r]);
      }

      // Unread-reply marker on hosts whose reminder bit lives in the list row
      // (`completed`: armed when a non-selected session finishes, cleared on
      // select — the manager's completedNotifications). Hosts exposing
      // sessionStatus get their marker from syncDoneFromStatus instead; the
      // two never share a row, so the mark counter stays balanced.
      if (!statusDoneSource()) {
        if (row.completed && !muted) markDoneUnread(row.id);
        else unmarkDoneUnread(row.id);
      }
    }

    // face -> row adapter (selected session, rich data). The label is the
    // session's own sidebar title like any other row, so "needs you" and
    // "reply finished" name the conversation instead of the old placeholder;
    // the placeholder remains the fallback while the title is unknown
    // (issue #20).
    function evalSessionFace(sessionId, snap) {
      if (sessionId !== currentFaceId) return;
      var pend = (snap.pending || []).map(function (p) {
        return { key: p.key || (p.kind + ":" + sessionId), kind: p.kind, payload: p.payload || null };
      });
      evaluateRow({
        id: sessionId,
        running: !!snap.running,
        pending: pend,
        completed: false,
        face: true,
        faceSnap: snap,
        currentId: sessionId,
        label: sessionTitleOf(sessionId) || "current"
      });
    }
    // list row -> adapter (every other listed session)
    function evalListRow(sid, sum, currentId) {
      evaluateRow({
        id: sid,
        running: !!sum.running,
        pending: sum.pendingInteraction ? [{ key: "list:" + sid + ":" + sum.pendingInteraction, kind: sum.pendingInteraction, payload: null }] : [],
        completed: !!sum.completed,
        face: false,
        currentId: currentId,
        label: sum.displayTitle || sum.title || sid
      });
    }

    // ─────────────────────── subscription wiring ─────────────────────
    function bindCurrentFace() {
      if (!listStore) return;
      try {
        var cur = currentSessionId();
        if (!cur) { detachFace(); return; }
        if (cur === currentFaceId && faceSub) return;
        detachFace();
        currentFaceId = cur;
        var b = rootCtx.sessions.binding(cur);
        if (!b || !b.session || typeof b.session.subscribe !== "function") {
          // binding not minted yet — the retry timer will re-check
          return;
        }
        faceSub = b.session.subscribe(function () {
          try {
            evalSessionFace(cur, b.session.getSnapshot());
          } catch (e) {}
        });
        // First evaluation seeds the baseline (no false completion edges) while
        // still alerting for interactions that were already pending on bind.
        try {
          evalSessionFace(cur, b.session.getSnapshot());
        } catch (e) {}
      } catch (e) {}
    }
    function detachFace() {
      if (faceSub) { try { faceSub(); } catch (e) {} faceSub = null; }
      currentFaceId = null;
    }
    function onListChanged() {
      if (!listStore) return;
      try {
        var st = listStore.getSnapshot();
        var cur = currentSessionId();
        bindCurrentFace();
        bindUiSession();
        // The subagent mute keys on "not the session on screen", and switching
        // sessions only emits on the list store — re-run the status pass so
        // the decision tracks the switch: opening a muted subagent session
        // announces its outstanding wait (under the current-conversation rules),
        // leaving it puts the next edge back in the muted bucket.
        evalUiStatus();
        var byId = (st && st.byId) || {};
        // A vanished row drops its unread-reply mark with it: the host forgets
        // the reminder bit together with the row, and a gone row reports
        // nothing. (Hosts with sessionStatus sweep this in syncDoneFromStatus.)
        if (!statusDoneSource()) {
          for (var mk in doneUnreadMarks) if (!byId[mk]) unmarkDoneUnread(mk);
        }
        for (var sid in byId) {
          if (sid === cur) continue; // current handled by the face watcher
          var sum = byId[sid];
          if (!sum) continue;
          evalListRow(sid, sum, cur);
        }
        // Sessions that vanished: keep the baseline for a while (they may
        // reappear), then drop it. Without the sweep one entry outlived every
        // subagent session that ever ran on the page.
        var gone;
        for (gone in prevById) {
          if (byId[gone]) continue;
          var goneEntry = prevById[gone];
          goneEntry.missing = (goneEntry.missing || 0) + 1;
          if (goneEntry.missing > BASELINE_MISSING_LIMIT) {
            delete prevById[gone];
            delete doneFiredAt[gone];
          }
        }
      } catch (e) {}
    }

    // ─────────────── uiSession pending-interaction watcher ───────────
    // DSH >= 0.1.2-alpha.2 moved pending interactions out of the Controller
    // snapshots into their own uiSession store, and that store changed shape
    // once, so both readings share one adapter:
    //   * 0.1.2-alpha.2 .. 0.1.5-rc.3: `pendingInteractions`, a
    //     Map<sessionId, interaction> whose values carry kind + key + sessionId
    //     and the domain's own detail fields;
    //   * 0.1.6-alpha.2 and later (incl. 0.2.0-rc.2): `sessionStatus`, a
    //     Map<sessionId, {running, pendingInteraction, completionUnread}>; the
    //     old store no longer exists, so reading it is what made this channel
    //     dead on every 0.1.6+/0.2 host.
    // Either store is the only live "the agent is waiting on you" source on its
    // host generation.
    //
    // The service is looked up lazily rather than declared in `inject`:
    // a cordis `inject` entry is a hard gate (the entry never activates while
    // the service is missing, and a never-activated entry makes the whole web
    // boot audit fail), while hosts older than 0.1.2-alpha.2 have no uiSession
    // at all and must keep working through the controller path above.
    //
    // ⚠️ Reading `ctx.uiSession` directly does NOT work here, and failing to
    // notice that is exactly how this watcher stayed dead on every 0.1.2+ host:
    // cordis resolves a service property only for names declared in the plugin's
    // `inject` map and throws `cannot get property "uiSession" without inject`
    // for every other name — sibling loader entries never leak their service
    // into an ancestor store, so the old try/catch around that read silently
    // produced `null` forever. ctx.get() reads the reflector store with no
    // inject requirement, which is the only lazy lookup that actually resolves
    // the service; ctx.reflect.get() and a plain property read stay as
    // fallbacks for contexts that predate that API.
    function lookupService(name) {
      var svc = null;
      try {
        if (rootCtx && typeof rootCtx.get === "function") svc = rootCtx.get(name) || null;
      } catch (e) { svc = null; }
      if (svc) return svc;
      try {
        if (rootCtx && rootCtx.reflect && typeof rootCtx.reflect.get === "function") svc = rootCtx.reflect.get(name) || null;
      } catch (e) { svc = null; }
      if (svc) return svc;
      try { if (rootCtx && name in rootCtx) svc = rootCtx[name] || null; } catch (e) { svc = null; }
      return svc;
    }
    // Is this an observable snapshot store (getSnapshot + subscribe)?
    function isStore(s) {
      return !!s && typeof s.getSnapshot === "function" && typeof s.subscribe === "function";
    }
    // Pick the host's pending-interaction store: sessionStatus wherever it
    // exists (0.1.6+), else the legacy pendingInteractions map (0.1.2-0.1.5).
    function interactionStore(svc) {
      if (svc && isStore(svc.sessionStatus)) return { store: svc.sessionStatus, source: "sessionStatus" };
      if (svc && isStore(svc.pendingInteractions)) return { store: svc.pendingInteractions, source: "pendingInteractions" };
      return null;
    }
    // One pending interaction out of one store value; null when this session
    // currently has none.
    function pendingOf(value, source) {
      if (!value) return null;
      if (source === "sessionStatus") return value.pendingInteraction || null;
      return value;
    }
    // Record the last lookup outcome for debug() and warn once on the only
    // outcome that is a defect rather than a host generation.
    function noteUiBind(note) {
      if (uiBindNote === note) return;
      uiBindNote = note;
      // Two notes are normal and stay silent: "not visible" is either a
      // pre-0.1.2 host or the ordinary boot race (this entry may apply before
      // the uiSession entry activates; the 1.5s retry timer binds it a moment
      // later), and "bound" is success. A service instance we can hold but
      // whose shape we do not recognize is the case worth one warning.
      if (note === "bound" || uiWarned || note === "uiSession not visible") return;
      uiWarned = true;
      try {
        console.warn("[dsh-notify-me] uiSession is reachable but exposes no pending-interaction source (" + note + ") — approval alerts are silent; please report this against DSH with window.__dshNotifyMe.debug()");
      } catch (e) {}
    }
    function bindUiSession() {
      var svc = lookupService("uiSession");
      var found = interactionStore(svc);
      if (!found) {
        noteUiBind(svc ? "uiSession has neither sessionStatus nor pendingInteractions" : "uiSession not visible");
        return;
      }
      var store = found.store;
      if (uiSub && uiStore === store) { noteUiBind("bound"); return; }
      // the service instance (or its store) was swapped (plugin HMR): drop the
      // stale subscription and its marks, then bind the live store
      if (uiSub) detachUiSession();
      uiStore = store;
      uiSource = found.source;
      uiPending = true; // this watcher now owns the title marker
      uiSub = store.subscribe(function () { try { evalUiStatus(); } catch (e) {} });
      noteUiBind("bound");
      evalUiStatus(); // seed: a wait that predates this plugin still alerts once
    }
    // True once the sessionStatus store is the live uiSession source (0.1.6+):
    // its rows then also own the completion-unread level flag and its marker.
    function statusDoneSource() {
      return !!(uiPending && uiSource === "sessionStatus");
    }
    function evalUiStatus() {
      var svc = lookupService("uiSession");
      var found = interactionStore(svc);
      if (!found || typeof found.store.getSnapshot !== "function") return;
      var snap = found.store.getSnapshot(); // Map<sessionId, interaction|status>
      if (!snap || typeof snap.forEach !== "function") return;
      if (found.source === "sessionStatus") syncDoneFromStatus(snap);
      var seen = Object.create(null);
      var cur = currentSessionId();
      snap.forEach(function (value, sid) {
        var it = pendingOf(value, found.source);
        // A session with no pending interaction is not "seen": leaving it out
        // lets the teardown pass below release any mark its answer replaced.
        if (!it) return;
        // A background subagent wait is muted and deliberately leaves no
        // baseline: the row is what isSubagentSession reads, and skipping the
        // record here also lets the teardown pass drop a mark whose wait was
        // announced before the mute was switched on (or before the user
        // switched away from that subagent session). Opening the session later
        // announces the outstanding wait then, like any first sighting.
        if (alertMutedFor(sid, cur)) return;
        seen[sid] = true;
        var key = it.key || (it.kind + ":" + sid);
        var prev = uiBaseline[sid];
        // new interactions alert once; a wait that already existed on bind
        // (no baseline yet for that session) alerts here too.
        if (prev && prev.key === key) return;
        uiBaseline[sid] = { key: key };
        // a wait replaced by a newer one in the same session: the old mark goes
        // with it, otherwise the tab would keep one stale marker per replacement
        if (prev) unmarkAttention(prev.key);
        if (attentionKeysFired[key]) { markAttention(key); return; } // already alerted, still needs its mark
        attentionKeysFired[key] = true;
        var quick = quickFor(key, it, sid);
        var copy = fireAttention(it.kind, labelForSessionId(sid), textFromPayload(it), currentSessionId() === sid, sid, quick);
        if (copy) queueQuieted(key, copy);
        lastAttentionAt = Date.now();
        markAttention(key);
      });
      for (var sid2 in uiBaseline) {
        if (seen[sid2]) continue;
        // interaction answered, cancelled, or its session went away
        unmarkAttention(uiBaseline[sid2].key);
        delete uiBaseline[sid2];
      }
    }
    // The sessionStatus rows also carry the reply-finished channel's level
    // flag (0.1.6-alpha.2+): `completionUnread` lights when a session that is
    // not on screen finishes and clears when the session is opened, starts
    // running again, or disappears. Two jobs live here:
    //   * the "完成未读" title marker, held exactly while a background session
    //     is finished-but-unread — open the session and the tab goes quiet;
    //   * one done alert for completions whose running edge this page never saw
    //     (coalesced list snapshots, a plugin remount mid-turn, a completion
    //     that predates this bind). The latch reports each unread instance once;
    //     reportDone's window collapses the double view when the edge did fire.
    // The edge path stays the reporter for the on-screen session (its snippet
    // comes from the face snapshot) and for hosts without this store.
    var uiDoneBaseline = Object.create(null); // sid -> true once this unread reported
    function syncDoneFromStatus(snap) {
      var want = Object.create(null);
      try {
        var cur = currentSessionId();
        snap.forEach(function (value, sid) {
          if (!value) return;
          // A stop that awaits input (plan-review / question end the turn with
          // a pending interaction) is a wait, not a completion — the same rule
          // as the edge path's !hasPendingNow guard. The on-screen session is
          // never "unread" (the host clears the flag for it; its completion is
          // the face edge's job), and a background subagent step is muted.
          if (!value.completionUnread || value.pendingInteraction || alertMutedFor(sid, cur) || cur === sid) return;
          want[sid] = true;
          markDoneUnread(sid);
          if (uiDoneBaseline[sid]) return; // this unread instance already reported
          uiDoneBaseline[sid] = true;
          if (Date.now() - lastAttentionAt < 300) return; // same-tick attention owns the moment
          reportDone(labelForSessionId(sid), "", sid);
        });
      } catch (e) {}
      // answered / re-run / gone / muted: latch and mark go with the flag
      for (var s in uiDoneBaseline) if (!want[s]) delete uiDoneBaseline[s];
      for (var m in doneUnreadMarks) if (!want[m]) unmarkDoneUnread(m);
    }
    function detachUiSession() {
      if (uiSub) { try { uiSub(); } catch (e) {} uiSub = null; }
      uiStore = null;
      uiSource = null;
      // drop every mark this watcher holds; hosts without the interaction store
      // go back to the controller marker path
      for (var s in uiBaseline) unmarkAttention(uiBaseline[s].key);
      uiBaseline = Object.create(null);
      for (var dm in doneUnreadMarks) unmarkDoneUnread(dm);
      uiDoneBaseline = Object.create(null);
      uiPending = false;
    }

    // ──────────────────────── global control API ─────────────────────
    // Expose the control API. Merge instead of replace: a consumer (or a test
    // harness) may have registered onEvent before the plugin applied, and that
    // hook must survive — binding the interaction store can deliver an alert
    // synchronously, in the middle of apply().
    var api = window.__dshNotifyMe;
    if (!api || typeof api !== "object") api = {};
    try {
      Object.defineProperty(api, "config", {
        get: function () { return readConfig(); },
        configurable: true
      });
    } catch (e) {}
    // keep in sync with package.json "version" on every release
    api.version = "1.16.0";
    api.setConfig = function (patch) { return setConfigLocal(patch); };
    api.resetConfig = function () {
      try {
        localStorage.removeItem(LS_CONFIG);
        // The picked cue files are per-kind keys of their own; dropping the
        // config alone would leave them orphaned, still eating the origin's
        // quota with no UI left to remove them from.
        localStorage.removeItem(LS_SOUND.done);
        localStorage.removeItem(LS_SOUND.attention);
        // Delivery bookkeeping is user-visible state too: a reset should not
        // leave a dead-letter log (or stale per-target verdicts) behind.
        localStorage.removeItem(LS_EXTERNAL_DEAD);
        localStorage.removeItem(LS_EXTERNAL_HEALTH);
        externalHealth = {};
        configWriteFailed = false;
      } catch (e) {
        // Same silent failure as a refused save: the reset only lives in
        // memory and the next reload brings the old profile back.
        configWriteFailed = true;
      }
      config = readConfig();
      return config;
    };
    // manual test; run it after clicking anywhere so permission can be granted.
    // Test alerts fire regardless of the page-open visibility rules.
    api.test = function (kind) {
      kind = (kind === "attention" || kind === "approval") ? kind : "done";
      unlockOnce();
      var before = lastToastReject;
      testAlert(kind);
      var refused = lastToastReject && lastToastReject !== before ? ", refused=" + lastToastReject.message : "";
      return "sent " + kind + " (lang=" + effectiveLang() + ", permission=" + ("Notification" in window ? Notification.permission : "n/a") + ", bridge=" + swState + refused + ")";
    };
    // Programmatic twin of a toast button press: settles the pending approval
    // behind `key` the same way the 同意/拒绝 buttons do.
    api.decide = function (key, outcome) {
      return decidePending(key, outcome === "rejected" ? "rejected" : "allowed-once");
    };
    // Channel test for the external webhooks: posts a synthetic event to every
    // configured target. An explicit console call counts as consent, so it runs
    // regardless of the master / per-kind toggles (those gate real alerts);
    // it still only ever talks to endpoints the user filled in themselves.
    api.testExternal = function () {
      return new Promise(function (resolve) {
        var targets = externalTargets();
        if (!targets.length) { resolve({ sent: 0, unverified: 0, failed: 0, statuses: [] }); return; }
        var d = texts();
        sendExternalToAll("attention", d.testExternalTitle, d.testExternalBody, currentSessionId(), true, function (statuses) {
          var out = { sent: 0, unverified: 0, failed: 0, statuses: statuses };
          for (var i = 0; i < statuses.length; i++) {
            if (statuses[i] === "sent") out.sent++;
            else if (statuses[i] === "unverified") out.unverified++;
            else out.failed++;
          }
          resolve(out);
        });
      });
    };
    // Live diagnostics for the "why did nothing pop" case. The needs-input
    // channel has three possible owners on current hosts (uiSession.sessionStatus
    // on 0.1.6+, uiSession.pendingInteractions on 0.1.2-0.1.5, the controller
    // snapshots before that) and each one failed silently in turn, so both the
    // binding state and which store answered have to be readable from the page.
    api.debug = function () {
      return {
        version: api.version,
        enabled: config.enabled,
        language: effectiveLang(),
        attentionHiddenOnly: config.attentionHiddenOnly,
        currentHiddenOnly: config.currentHiddenOnly,
        donePolicy: donePolicy(),
        idleMinutes: idleMinutes(),
        autoDismiss: config.autoDismiss,
        ignoreSubagent: config.ignoreSubagent,
        sound: config.sound,
        soundDone: soundMode("done"),
        soundAttention: soundMode("attention"),
        customSoundDone: !!readSound("done"),
        customSoundAttention: !!readSound("attention"),
        quickActions: config.quickActions,
        // external webhook forwarding: counts come from externalStat (tallied
        // on every send), targets is the raw vs validated count. `deadLetters`
        // is the persisted "never made it" log; `health` is the last verdict
        // per target id, which the settings page renders next to each row.
        external: {
          enabled: config.externalEnabled,
          forwardAttention: config.externalAttention,
          forwardDone: config.externalDone,
          targets: Array.isArray(config.externalTargets) ? config.externalTargets.length : 0,
          activeTargets: externalTargets().length,
          retryDelays: externalRetryDelays(),
          sent: externalStat.sent,
          unverified: externalStat.unverified,
          failed: externalStat.failed,
          retried: externalStat.retried,
          lastAt: externalStat.lastAt,
          lastStatus: externalStat.lastStatus,
          deadLetters: readExternalDead().length,
          deadLettersLog: readExternalDead(),
          health: externalHealth
        },
        // quick-decision bridge: 'active' is the only state in which approval
        // toasts carry working 同意/拒绝 buttons.
        bridge: swState,
        // host-side fallback coordination: which lease this page holds, and
        // what the host said the relay route is. 'active' means the host has a
        // fallback and this page is holding it off with a heartbeat.
        hostBridge: {
          state: hostBridgeState.state,
          leaseMs: hostBridgeState.leaseMs,
          relayEnabled: hostBridgeState.relayEnabled,
          relayPath: hostBridgeState.relayPath,
          relayUpstreamHost: hostBridgeState.relayUpstreamHost,
          // the upstream endpoint the fold has to match exactly, so a support
          // question about "why was my target not folded" is answerable here
          relayUpstreamPath: hostBridgeState.relayUpstreamPath,
          // the fault's own name ('bad-host' / 'cross-origin' / 'http-403') so
          // a support question can be answered without a screenshot
          lastReason: hostBridgeState.lastReason,
          lastProbeAt: hostBridgeState.lastProbeAt ? new Date(hostBridgeState.lastProbeAt).toISOString() : null,
          lastBeaconAt: hostBridgeState.lastBeaconAt ? new Date(hostBridgeState.lastBeaconAt).toISOString() : null
        },
        // how a toast click gets the OS window forward on this host
        hostEnv: config.hostEnv,
        hostEnvDetected: detectedDesktop() ? "desktop" : "web",
        desktop: isDesktopShell(),
        raiseChannel: isDesktopShell() ? desktopRaiseChannel() : "window-focus",
        raiseLast: raiseState.last,
        configStored: !configWriteFailed,
        actionKeys: Object.keys(pendingActions),
        permission: ("Notification" in window) ? Notification.permission : "n/a",
        visibility: hidden() ? "hidden" : "visible",
        focused: pageFocused,
        away: away(),
        uiSession: uiPending ? "bound" : "unbound",
        uiSessionNote: uiBindNote,
        uiSessionSource: uiSource,
        currentSession: currentSessionId(),
        sessionBaselines: Object.keys(prevById).length,
        pendingBaselines: Object.keys(uiBaseline).length,
        firedKeys: Object.keys(attentionKeysFired),
        markedKeys: Object.keys(attentionKeysMarked),
        doneUnreadMarked: Object.keys(doneUnreadMarks),
        quietedKeys: Object.keys(quietedAttention),
        lastAttentionAt: lastAttentionAt ? new Date(lastAttentionAt).toISOString() : null,
        // Toast tag room on this page and the last platform refusal: Windows
        // caps the platform-facing "n#<origin>#<tag>" at 64 characters, which is
        // what made the "测试「审批按钮」" test vanish without a trace (issue
        // #18).
        notifyTagBudget: toastTagBudget(),
        notifyTagLimit: TOAST_TAG_LIMIT,
        lastToastReject: lastToastReject
      };
    };
    window.__dshNotifyMe = api;

    // ────────────────── Settings page (react only, optional) ─────────
    // Registered when the web profile provides react + slots + locale; the
    // reminder core above never depends on any of it.
    var NS = "dsh-notify-me";
    var UI_zh = {
      nav: "通知提醒",
      blurb: "模型停下来需要你操作，或回复在后台完成时提醒你。",
      secWays: "提醒方式",
      secWhen: "什么时候提醒",
      secTest: "试一试",
      advanced: "高级设置",
      advancedHint: "音效来源 · 外部通知 · 运行环境",
      secDiag: "运行环境与诊断",
      expand: "展开",
      collapse: "收起",
      permHintInline: "尚未授权，允许一次即可。",
      resetHint: "把上面所有选项还原成默认值（含已选的自定义音效）。",
      enable: "启用提醒",
      enableHint: "关闭后不弹通知、不响提示音，也不改标签页标题。",
      hostEnv: "运行环境",
      hostEnvHint: "默认自动识别：页面协议是 dsh-app:// 即桌面端（DSH Desktop），其余为 Web 端。识别不准时手动指定：桌面端走 dsh:// 深链调窗（效果不稳定），系统通知不带「同意 / 拒绝」按钮；Web 端走 window.focus() 与 Service Worker 桥。",
      hostEnvAuto: "自动识别（推荐）",
      hostEnvDesktop: "桌面端（DSH Desktop）",
      hostEnvWeb: "Web 端（浏览器）",
      hostEnvMismatch: "（自动识别结果是「",
      hostEnvMismatchTail: "」，手动选择会覆盖它）",
      hostEnvDesktopForcedNote: "（当前页面不是 dsh-app://：点通知会尝试唤起 dsh:// 协议，浏览器可能弹「打开应用」确认框）",
      toastHint: "走系统通知中心，需要通知权限；桌面端这类通知没有「同意 / 拒绝」按钮。",
      sound: "提示音",
      soundHint: "提示音总开关；播什么由「高级设置 → 音效来源」决定。",
      soundSource: "音效来源",
      soundSourceHint: "两类提醒各自选声音来源，互不影响；默认是插件内置合成音。",
      soundDoneLabel: "「回复完成」的声音",
      soundAttentionLabel: "「需要你」的声音",
      soundSynth: "内置合成音（默认）",
      soundCustom: "自定义音频文件",
      soundSystem: "系统通知音（系统播放）",
      soundSynthNote: "插件合成音，「需要你」与「回复完成」音型不同。",
      soundSystemNote: "不播插件音效：通知照发，声音交给操作系统——音色跟着系统通知设置走，开关仍听这里的「提示音」。",
      soundNone: "尚未选择文件",
      soundPick: "选择音频文件",
      soundPreview: "试听",
      soundClear: "移除",
      soundTooBig: "文件太大，上限 ",
      soundNotAudio: "这不是浏览器能播放的音频文件。",
      soundSaved: "已保存自定义音效：",
      soundCleared: "已移除自定义音效，该提醒回落到内置合成音。",
      soundReadFail: "读取文件失败。",
      soundQuota: "浏览器存储空间不足，存不下这个文件——先移除另一类提醒的自定义音效，或换一个更小的文件。",
      soundPreviewDone: "试听「回复完成」音效",
      soundPreviewAttention: "试听「需要你」音效",
      soundOffHint: "「提示音」开关是关的：先打开它才能试听（关掉时提醒本身也确实不出声）。",
      soundPreviewSystem: "「系统通知音」是随通知由系统播放的，插件这边没有可播的音；已发一条测试提醒，声音就是它。",
      external: "外部通知",
      externalHint: "把提醒同时推到 Discord / Bark / Gotify / 飞书 / Server酱 / WxPusher / 自定义 Webhook，人不在电脑前也能收到。与本地提醒同一套触发规则；投递失败会按 2 秒 / 6 秒自动重试，仍失败则记进失败记录。",
      externalEnable: "转发外部通知",
      externalEnableHint: "总开关：关闭后不向任何外部端点发送。",
      externalAttentionLabel: "转发「需要你」",
      externalAttentionHint: "审批 / 方案待确认 / 提问时一并推送到外部端点。",
      externalDoneLabel: "转发「回复完成」",
      externalDoneHint: "回复跑完时一并推送到外部端点。",
      externalTargetsLabel: "推送目标",
      externalTargetsHint: "可加多个，每个目标可单独停用。飞书填群机器人 Webhook；Server酱 填 …/send/<SendKey>.send 完整地址（Turbo 与 Server酱³ 都行）；WxPusher 填 appToken 与接收者 UID；Discord 填 Webhook URL；Bark 填 https://api.day.app/<设备密钥>（自建填 http://<服务器>/<密钥>）；Gotify 填 https://<服务器>/message?token=<应用令牌>；自定义填任意收 JSON 的地址（POST：source / event / title / body / text / sessionId / time）。钉钉群机器人不在此列：它的接口不回 CORS 头、又只收 application/json，浏览器页面发不出去；要发钉钉请自建一个中转，用「自定义」指向它。",
      externalPrivacy: "提醒标题与正文（含会话名与摘要）会原样发到你填写的地址——只填你自己信任的端点。自定义目标填了签名密钥时，请求会带 X-DSH-Notify-Signature（对请求体做 HMAC-SHA256）；该头会触发 CORS 预检，只对支持预检的接收端有效。飞书填了签名密钥时按官方算法在请求体里带 timestamp/sign。",
      externalTypeDiscord: "Discord Webhook",
      externalTypeBark: "Bark",
      externalTypeGotify: "Gotify",
      externalTypeFeishu: "飞书群机器人",
      externalTypeServerchan: "Server酱",
      externalTypeWxpusher: "WxPusher",
      externalTypeCustom: "自定义 Webhook",
      externalUrlPlaceholder: "https://…",
      externalAdd: "添加目标",
      externalRemove: "删除这个目标",
      externalTypeField: "推送类型",
      externalUrlField: "推送地址",
      externalTargetToggle: "启用或停用这个目标",
      externalSecretField: "签名密钥",
      externalSecretPlaceholderFeishu: "签名校验密钥（可选）",
      externalSecretPlaceholderCustom: "HMAC 签名密钥（可选，留空不签名）",
      externalTokenField: "appToken",
      externalTokenPlaceholder: "AT_…",
      externalUidField: "接收者 UID",
      externalUidPlaceholder: "UID_…（多个用逗号分隔）",
      externalTemplateField: "消息模板",
      externalTemplatePlaceholder: "留空用默认：{{title}} 换行 {{body}}",
      externalStatusNever: "尚未投递",
      externalStatusSent: "上次成功",
      externalStatusUnverified: "上次已发出（未确认送达）",
      externalStatusFailed: "上次失败",
      externalReasonOpaque: "跨域端点读不到回执，是否送达无法确认",
      externalReasonViaRelay: "经同源中继",
      externalRelayFoldNote: "这个地址是宿主中继的上游网关：浏览器直连不了（无 CORS、且网关拒跨站），发送时会自动改走同源中继，凭据留在宿主。",
      externalDeadLabel: "失败记录",
      externalDeadNone: "没有投递失败的记录。",
      externalDeadHint: "彻底失败 ",
      externalDeadUnit: " 条（最多保留 10 条，只记标题与正文摘要）",
      externalDeadLast: "最后一条：",
      externalDeadClear: "清空失败记录",
      externalDeadCleared: "失败记录已清空。",
      externalEmpty: "还没有推送目标，点「添加目标」加一个。",
      externalTestLabel: "测一测外部通知",
      externalTestHint: "向上面所有推送目标各发一条测试消息（不受「转发」分类开关限制）。",
      externalTestBtn: "发送测试通知",
      externalSending: "发送中…",
      externalTestDone: "测试通知：",
      externalCountSent: "成功 ",
      externalCountUnverified: "未确认送达 ",
      externalCountFailed: "失败 ",
      externalNoTargets: "先添加至少一个推送目标。",
      externalOffHint: "先打开「转发外部通知」。",
      externalHostBridgeLabel: "宿主侧兜底",
      externalHostBridgeHint: "页面关闭后还能不能推送，取决于宿主侧兜底：插件启动时向宿主探测一次，宿主回「已启用」后页面用心跳占住租约，关页面时立刻释放，两边不会重复推送。",
      externalRelayLabel: "同源中继",
      externalRelayHint: "宿主的同源中继路由：页面把提醒 POST 到这里，由宿主补上凭据再转发给网关，凭据不落在浏览器里。",
      externalHostFallbackOn: "已启用 · 页面关闭后仍会推送",
      externalHostFallbackOff: "未启用",
      externalHostFallbackError: "宿主未响应",
      externalHostBridgeErrorNote: "宿主侧通道没有回应（插件与宿主版本不一致，或宿主侧插件没加载）：提醒仍按页面在时的规则工作。",
      externalHostBridgeDeniedNote: "宿主拒绝了页面的协调请求（本页面的来源 / Host 不在白名单）：在 profile 里 `- id: notify-me` 那一条的顶层 allowedOrigins 补上本页面来源。",
      externalRelayOn: "已启用",
      externalRelayOff: "未启用",
      externalRelayAddress: "地址：",
      attentionVisible: "窗口在前台时也提醒「需要你」",
      attentionVisibleHint: "窗口在前台也提醒。关掉后只在窗口转到后台（切走、被遮挡或最小化）时提醒。",
      currentQuiet: "当前对话不弹通知",
      currentQuietHint: "等待就发生在你正看着的对话里时只留标签页标记，免得打断眼前的操作；人离开（窗口转到后台或一段时间没动）后照常提醒。",
      donePolicy: "「回复完成」什么时候提醒",
      donePolicyHint: "「仅当前对话静默」＝你在看的那条完成了不弹，别的对话完成了照常提醒，多开对话时有用。",
      dpBackground: "仅后台",
      dpSmart: "仅当前对话静默",
      dpAlways: "总是提醒",
      autoDismiss: "通知自动消失",
      autoDismissHint: "离开电脑时收到的那条，回来还要能看见。选「离开时保留」时只在你看页面时才关掉。",
      adPresent: "离开时保留",
      adAlways: "总是关闭",
      adNever: "从不关闭",
      subagentQuiet: "子代理会话不提醒",
      subagentQuietHint: "跳过后台子代理会话（结果由所属主对话的提醒覆盖）；你正打开的那个照常提醒。",
      autoFocus: "点击通知回到对应对话",
      autoFocusHint: "点通知会切到这条提醒所属的对话；关掉后点击不做任何事。",
      quickActions: "审批通知上直接裁决",
      quickActionsHint: "审批通知上带「同意 / 拒绝」，点一下即完成裁决，不用切回页面。需要 Service Worker（http://127.0.0.1 或 https）；用不了时（桌面端页面即如此）通知照常弹，只是不带按钮，点通知回到对话里裁决。",
      quickApprovalNote: "「同意」等价于对话里审批的「允许一次」，只放行这一次。",
      bridgeOff: "快捷裁决按钮暂不可用（",
      bridgeOffTail: "）：这条通知不带按钮，点它回到对话里裁决。",
      bridgeOffDesktop: "桌面端页面（dsh-app://）注册不了 Service Worker（宿主少给 allowServiceWorkers 特权），系统通知本身没有「同意 / 拒绝」按钮：审批提醒照常弹出，点通知回到对话里裁决。",
      testApprovalNoBridge: "已发测试提醒：桌面端通知不带按钮，点通知回到对话里裁决。",
      testNeedsQuick: "先打开上面的「审批通知上直接裁决」才能测按钮。",
      volume: "音量",
      language: "通知语言",
      langAuto: "跟随界面",
      langZh: "简体中文",
      langEn: "English",
      langAutoNote: "（跟随界面）",
      current: "界面当前语言",
      testTitle: "快速测试",
      testHint: "用当前设置各发一条，不受「什么时候提醒」里的开关限制。",
      testAttention: "测试「需要你」",
      testDone: "测试「回复完成」",
      testApprovalBtn: "测试「审批按钮」",
      reset: "恢复默认设置",
      resetDone: "已恢复默认设置。",
      sent: "已发送测试提醒 · 通知语言：",
      testRefused: "系统拒收了这条通知：",
      testNoPermission: "通知权限还没给：先在页面上允许一次，再点测试。",
      permHint: "通知权限尚未授予：先在页面上点击一次并允许通知，系统通知才能弹出（提示音不受影响）。",
      offHint: "已关闭提醒：先打开「启用提醒」再测试。",
      storageFailed: "设置没能保存：浏览器拒绝了这次本地存储写入（空间不足或存储被禁用），改动只在当前页面有效，刷新即还原。",
      secMute: "会话静音",
      muteHint: "把鼠标移到侧边栏的会话上，点铃铛就只关掉这一条会话的提醒：被静音的会话在标题前显示划掉的铃铛，其它会话照旧提醒。",
      muteNone: "还没有静音的会话。",
      muteMuted: "已静音会话数：",
      muteClear: "全部取消静音",
      muteSession: "静音此会话的提醒",
      unmuteSession: "取消静音，恢复此会话的提醒",
      muteMark: "此会话已静音",
      versionLine: "插件版本：dsh-notify-me v"
    };
    var UI_en = {
      nav: "Notify me",
      blurb: "Get told when the agent needs your input, or when a reply finishes in the background.",
      secWays: "How you get told",
      secWhen: "When to alert",
      secTest: "Try it",
      advanced: "Advanced",
      advancedHint: "Alert sounds · External forwarding · Runtime",
      secDiag: "Runtime & diagnostics",
      expand: "Show",
      collapse: "Hide",
      permHintInline: "Not granted yet — allow it once from the page.",
      resetHint: "Put every option above back to its default (picked sound files included).",
      enable: "Enable reminders",
      enableHint: "When off: no toasts, no sounds, and the tab title is left alone.",
      hostEnv: "Environment",
      hostEnvHint: "Auto-detect by default: a dsh-app:// page is the Desktop (DSH Desktop) shell, anything else is the Web. Override it if detection comes out wrong: on the Desktop a toast click fires the dsh:// deep link (the effect is unreliable) and system notifications carry no Approve / Reject buttons; on the Web it is window.focus() plus the Service Worker bridge.",
      hostEnvAuto: "Auto-detect (recommended)",
      hostEnvDesktop: "Desktop (DSH Desktop)",
      hostEnvWeb: "Web (browser)",
      hostEnvMismatch: " (auto-detection sees \"",
      hostEnvMismatchTail: "\"; the manual choice overrides it)",
      hostEnvDesktopForcedNote: " (this page is not dsh-app://: a toast click will try to launch the dsh:// protocol and the browser may show an \"open app?\" prompt)",
      toastHint: "Through the system notification center; needs notification permission, and on the Desktop these carry no Approve / Reject buttons.",
      sound: "Sound",
      soundHint: "Master cue switch; what it plays comes from Advanced → Alert sound.",
      soundSource: "Alert sound",
      soundSourceHint: "Each alert kind picks its own source; the two never affect each other. Default is the built-in cue.",
      soundDoneLabel: "\"Reply finished\" sound",
      soundAttentionLabel: "\"Needs you\" sound",
      soundSynth: "Built-in cue (default)",
      soundCustom: "Custom audio file",
      soundSystem: "System notification sound (OS plays it)",
      soundSynthNote: "The plugin's synthesized cue — \"needs you\" and \"reply finished\" use different patterns.",
      soundSystemNote: "No plugin cue: the toast still appears, but the sound is left to the operating system, so its timbre follows your system notification settings. The Sound switch above still mutes it.",
      soundNone: "No file chosen yet",
      soundPick: "Choose an audio file",
      soundPreview: "Preview",
      soundClear: "Remove",
      soundTooBig: "File is too large; the limit is ",
      soundNotAudio: "That is not an audio file this browser can play.",
      soundSaved: "Custom sound saved: ",
      soundCleared: "Custom sound removed; this alert falls back to the built-in cue.",
      soundReadFail: "Could not read the file.",
      soundQuota: "Not enough browser storage for this file — remove the other kind's custom sound first, or pick a smaller file.",
      soundPreviewDone: "Preview the \"reply finished\" sound",
      soundPreviewAttention: "Preview the \"needs you\" sound",
      soundOffHint: "The Sound switch is off: turn it on to preview (with it off the alerts themselves stay silent too).",
      soundPreviewSystem: "The system sound plays with a toast, not from the plugin — a test alert was sent instead; that sound is it.",
      external: "External notifications",
      externalHint: "Also push alerts to Discord / Bark / Gotify / Feishu / ServerChan / WxPusher / custom webhooks, so you hear about it away from the machine. Same trigger rules as local alerts; a failed delivery is retried after 2 s and 6 s and, if it still fails, recorded in the failure log.",
      externalEnable: "Forward to external targets",
      externalEnableHint: "Master switch: when off, nothing is sent to any external endpoint.",
      externalAttentionLabel: "Forward \"needs you\"",
      externalAttentionHint: "Push approval / plan review / question alerts to the external endpoints too.",
      externalDoneLabel: "Forward \"reply finished\"",
      externalDoneHint: "Push reply-finished alerts to the external endpoints too.",
      externalTargetsLabel: "Push targets",
      externalTargetsHint: "Add as many as you like; each one can be disabled on its own. Feishu: the group-bot webhook; ServerChan: the full .../send/<SendKey>.send URL (Turbo and ServerChan³ both work); WxPusher: the appToken and the receiver UID; Discord: the webhook URL; Bark: https://api.day.app/<device key> (self-hosted: http://<server>/<key>); Gotify: https://<server>/message?token=<app token>; custom: any endpoint accepting JSON (POST: source / event / title / body / text / sessionId / time). DingTalk is not on the list: its robot endpoint sends no CORS headers and only accepts application/json, so a page cannot post to it — relay it through your own box and point a custom target at that.",
      externalPrivacy: "The alert title and body (including the session name and snippet) are sent as-is to the address you enter — only use endpoints you trust. When a custom target has a signing secret, the request carries X-DSH-Notify-Signature (HMAC-SHA256 over the body); that header triggers a CORS preflight, so it only works on a receiver that answers it. A Feishu target with a secret carries timestamp/sign in the body, per Feishu's own algorithm.",
      externalTypeDiscord: "Discord webhook",
      externalTypeBark: "Bark",
      externalTypeGotify: "Gotify",
      externalTypeFeishu: "Feishu group bot",
      externalTypeServerchan: "ServerChan",
      externalTypeWxpusher: "WxPusher",
      externalTypeCustom: "Custom webhook",
      externalUrlPlaceholder: "https://…",
      externalAdd: "Add target",
      externalRemove: "Remove this target",
      externalTypeField: "Target type",
      externalUrlField: "Endpoint URL",
      externalTargetToggle: "Enable or disable this target",
      externalSecretField: "Signing secret",
      externalSecretPlaceholderFeishu: "Verification secret (optional)",
      externalSecretPlaceholderCustom: "HMAC signing secret (optional; empty = unsigned)",
      externalTokenField: "appToken",
      externalTokenPlaceholder: "AT_…",
      externalUidField: "Receiver UID",
      externalUidPlaceholder: "UID_… (comma-separated for several)",
      externalTemplateField: "Message template",
      externalTemplatePlaceholder: "Empty = default: {{title}} then {{body}}",
      externalStatusNever: "not sent yet",
      externalStatusSent: "last delivery ok",
      externalStatusUnverified: "last delivery unconfirmable",
      externalStatusFailed: "last delivery failed",
      externalReasonOpaque: "cross-origin endpoint returns no readable receipt, so delivery cannot be confirmed",
      externalReasonViaRelay: "via same-origin relay",
      externalRelayFoldNote: "This address is the host relay's upstream gateway: a browser cannot post to it (no CORS, and the gateway refuses cross-site POSTs), so sending automatically goes through the same-origin relay with the credential staying on the host.",
      externalDeadLabel: "Failure log",
      externalDeadNone: "No failed deliveries.",
      externalDeadHint: "Failed ",
      externalDeadUnit: " time(s) (10 kept at most; title and body snippet only)",
      externalDeadLast: "Latest: ",
      externalDeadClear: "Clear the failure log",
      externalDeadCleared: "Failure log cleared.",
      externalEmpty: "No push targets yet — press \"Add target\" to create one.",
      externalTestLabel: "Test the external channel",
      externalTestHint: "Send one test message to every push target above (the per-kind forward toggles do not apply to this button).",
      externalTestBtn: "Send test notification",
      externalSending: "Sending…",
      externalTestDone: "Test notification: ",
      externalCountSent: "ok ",
      externalCountUnverified: "unconfirmed ",
      externalCountFailed: "failed ",
      externalNoTargets: "Add at least one push target first.",
      externalOffHint: "Turn on \"Forward to external targets\" first.",
      externalHostBridgeLabel: "Host-side fallback",
      externalHostBridgeHint: "Whether an alert still goes out once this page is closed depends on the host-side fallback: the plugin probes the host at start-up, and once the host answers \"enabled\" the page holds its lease with a heartbeat and releases it on unload, so the two never push the same alert twice.",
      externalRelayLabel: "Same-origin relay",
      externalRelayHint: "The host's same-origin relay route: the page POSTs an alert here and the host adds the credentials before forwarding it to the gateway, so they never live in the browser.",
      externalHostFallbackOn: "Enabled · still pushed after the page closes",
      externalHostFallbackOff: "Disabled",
      externalHostFallbackError: "Host did not answer",
      externalHostBridgeErrorNote: "The host-side channel did not answer (the plugin and host builds differ, or the host-side plugin is not loaded); alerts still follow the page-is-open rules.",
      externalHostBridgeDeniedNote: "The host refused this page's coordination request (this page's origin / Host is not on the allowlist): add this page's origin to the top-level allowedOrigins of the `- id: notify-me` entry in your profile.",
      externalRelayOn: "Enabled",
      externalRelayOff: "Disabled",
      externalRelayAddress: "address: ",
      attentionVisible: "Also alert \"needs you\" while the window is in front",
      attentionVisibleHint: "Alert even while the window has focus. Turn off to hear only once the window goes to the background (another app, covered, or minimised).",
      currentQuiet: "Stay quiet for the conversation on screen",
      currentQuietHint: "A wait belonging to the conversation on screen keeps only the tab marker, so the page is not covered; moving the window to the background or stepping away from it restores alerts.",
      donePolicy: "When \"reply finished\" alerts",
      donePolicyHint: "\"Quiet for the open one\" means the conversation you are reading finishes silently while any other conversation still alerts — useful with several conversations open.",
      dpBackground: "Background only",
      dpSmart: "Quiet for the open one",
      dpAlways: "Always",
      autoDismiss: "Dismiss the toast automatically",
      autoDismissHint: "An alert that arrived while you were away should still be there when you return. \"Keep while away\" only tidies up while the page is in front.",
      adPresent: "Keep while away",
      adAlways: "Always close",
      adNever: "Never close",
      subagentQuiet: "Ignore subagent sessions",
      subagentQuietHint: "Skip sessions spawned by a subagent (the parent conversation covers them); the one you have open still alerts.",
      autoFocus: "Click a toast to open that conversation",
      autoFocusHint: "A click switches to the conversation the alert came from; off means a click does nothing.",
      quickActions: "Decide approvals from the toast",
      quickActionsHint: "Approval notifications carry Approve / Reject; one click settles the request without switching back. Needs a Service Worker browser (http://127.0.0.1 or https); where it cannot run (the Desktop shell) the alert is a plain notification without buttons — clicking it opens the conversation.",
      quickApprovalNote: "\"Approve\" equals \"Allow once\" in the conversation — it allows that one call only.",
      bridgeOff: "Quick-decision buttons are unavailable right now (",
      bridgeOffTail: "); this notification carries no buttons — click it to open the conversation and decide.",
      bridgeOffDesktop: "dsh-app:// pages cannot register a Service Worker (the shell does not grant the allowServiceWorkers privilege), and a system notification carries no Approve / Reject buttons: the approval alert still pops, click it to open the conversation and decide.",
      testApprovalNoBridge: "Test alert sent: Desktop notifications carry no buttons — click it to open the conversation and decide.",
      testNeedsQuick: "Turn on \"Decide approvals from the toast\" above to test the buttons.",
      volume: "Volume",
      language: "Notification language",
      langAuto: "Follow the interface",
      langZh: "简体中文",
      langEn: "English",
      langAutoNote: " (follows the interface)",
      current: "Current interface language",
      testTitle: "Quick test",
      testHint: "Send one of each with the current settings; the \"When to alert\" switches are bypassed.",
      testAttention: "Test \"needs you\"",
      testDone: "Test \"reply finished\"",
      testApprovalBtn: "Test approval buttons",
      reset: "Restore defaults",
      resetDone: "Defaults restored.",
      sent: "Test alert sent · notification language: ",
      testRefused: "The platform refused this toast: ",
      testNoPermission: "Notification permission is not granted: allow it once from the page, then test again.",
      permHint: "Notification permission is not granted yet — click once on the page and allow notifications so toasts can appear (sound is unaffected).",
      offHint: "Reminders are off: enable them first, then test.",
      storageFailed: "Settings were not saved: the browser refused this local-storage write (quota or storage disabled), so the change lasts only for this page and is gone on reload.",
      secMute: "Muted sessions",
      muteHint: "Hover a session in the sidebar and click the bell to silence just that conversation: a muted session shows a crossed bell before its title, and the other sessions keep alerting.",
      muteNone: "No session is muted.",
      muteMuted: "Muted sessions: ",
      muteClear: "Unmute all",
      muteSession: "Mute alerts for this session",
      unmuteSession: "Unmute: resume alerts for this session",
      muteMark: "Alerts muted for this session",
      versionLine: "Plugin version: dsh-notify-me v"
    };
    // ─────────────────── sidebar row glyph ───────────────────────────
    // The settings shell picks the nav glyph from a table keyed by section id
    // (account / models / agent-presets / plugins / archived-sessions) and hands
    // every other section the settings gear; settings.section carries no icon
    // field, so there is no supported way to give our row the bell. Patch the
    // rendered cell instead: find the nav button whose label is ours and swap
    // its <svg> for the brand bell. The panel is portaled fresh on every open,
    // so this re-applies itself; if a host updates its markup the label lookup
    // simply finds nothing and the gear stays.
    function bellNavSvg() {
      var NS = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(NS, "svg");
      var attrs = {
        viewBox: "0 0 24 24", width: "16", height: "16", fill: "none",
        stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round",
        "stroke-linejoin": "round", "aria-hidden": "true", "data-dnm-nav": "1"
      };
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) svg.setAttribute(k, attrs[k]);
      var shapes = [
        ["path", { d: "M12 3.4a5.1 5.1 0 0 0-5.1 5.1v3.1c0 .9-.3 1.7-.9 2.4l-1.1 1.3c-.5.6-.1 1.5.7 1.5h12.8c.8 0 1.2-.9.7-1.5l-1.1-1.3a3.8 3.8 0 0 1-.9-2.4V8.5A5.1 5.1 0 0 0 12 3.4Z" }],
        ["path", { d: "M9.8 19.2a2.4 2.4 0 0 0 4.4 0" }],
        ["circle", { cx: "18.3", cy: "5.3", r: "2.35", fill: "currentColor", stroke: "none" }]
      ];
      for (var i = 0; i < shapes.length; i++) {
        var el = document.createElementNS(NS, shapes[i][0]);
        for (var a in shapes[i][1]) if (Object.prototype.hasOwnProperty.call(shapes[i][1], a)) el.setAttribute(a, shapes[i][1][a]);
        svg.appendChild(el);
      }
      return svg;
    }

    function installNavBell(labelOf) {
      if (typeof document === "undefined" || !document.body || typeof MutationObserver !== "function") {
        return function () {};
      }
      var PANEL = '[data-shortcut-modal="settings"]';
      var observed = null;
      var watching = null;

      function patchPanel(panel) {
        try {
          var label = String(labelOf() || "").trim();
          if (!label || !panel) return;
          var cells = panel.querySelectorAll("button");
          for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            var spans = cell.querySelectorAll("span");
            var hit = false;
            for (var s = 0; s < spans.length; s++) {
              if (String(spans[s].textContent || "").trim() === label) { hit = true; break; }
            }
            if (!hit) continue;
            var svg = cell.querySelector("svg");
            if (!svg || svg.getAttribute("data-dnm-nav") === "1") continue;
            var bell = bellNavSvg();
            // Keep the shell's own icon class so the box size and color match.
            var cls = svg.getAttribute("class");
            if (cls) bell.setAttribute("class", cls);
            if (svg.parentNode) svg.parentNode.replaceChild(bell, svg);
          }
        } catch (e) {}
      }

      function watchPanel(panel) {
        if (!panel || panel === observed) return;
        observed = panel;
        patchPanel(panel);
        if (watching) { try { watching.disconnect(); } catch (e) {} }
        watching = new MutationObserver(function () { patchPanel(observed); });
        watching.observe(panel, { childList: true, subtree: true });
      }

      // The panel is portaled onto <body>, so a body-level childList observer is
      // enough to notice it opening without watching the whole page.
      var opener = new MutationObserver(function () {
        var panel = document.querySelector(PANEL);
        if (panel) watchPanel(panel);
        else if (watching) { try { watching.disconnect(); } catch (e) {} watching = null; observed = null; }
      });
      opener.observe(document.body, { childList: true });
      var existing = document.querySelector(PANEL);
      if (existing) watchPanel(existing);
      return function () {
        try { opener.disconnect(); } catch (e) {}
        if (watching) { try { watching.disconnect(); } catch (e) {} }
      };
    }

    // Small element helper to keep the hand-written page readable.
    function h(tag, props) {
      var args = [tag, props || null];
      for (var i = 2; i < arguments.length; i++) args.push(arguments[i]);
      return React.createElement.apply(React, args);
    }
    // css classes (namespaced to avoid collisions)
    var UI_CSS = "" +
      ".dnm-wrap{width:100%;max-width:720px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary,rgba(20,20,20,.9))}" +
      ".dnm-blurb{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9))}" +
      ".dnm-card{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.05));border-radius:10px;overflow:hidden}" +
      ".dnm-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 14px;min-height:46px;box-sizing:border-box}" +
      ".dnm-row+.dnm-row{border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35))}" +
      ".dnm-rowText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}" +
      ".dnm-rowLabel{font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary,rgba(20,20,20,.9))}" +
      ".dnm-rowHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9))}" +
      ".dnm-switch{flex:none;position:relative;width:34px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.45));background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.2));cursor:pointer;padding:0;transition:background .15s ease}" +
      ".dnm-switch.on{background:var(--dsw-alias-state-business-primary,#3b82f6);border-color:transparent}" +
      ".dnm-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s ease}" +
      ".dnm-switch.on .dnm-knob{left:16px}" +
      ".dnm-radio{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary,#3b82f6);cursor:pointer}" +
      ".dnm-range{width:150px;accent-color:var(--dsw-alias-state-business-primary,#3b82f6)}" +
      ".dnm-select{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));color:var(--dsw-alias-label-primary,rgba(20,20,20,.9));border-radius:8px;padding:5px 8px;font-size:13px;font-family:inherit}" +
      ".dnm-btn{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;color:var(--dsw-alias-label-primary,rgba(20,20,20,.9));border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer;font-family:inherit}" +
      ".dnm-btn:hover{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.1))}" +
      ".dnm-btn[disabled]{opacity:.45;cursor:default}" +
      ".dnm-btnRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
      ".dnm-file{font-size:12px;font-family:inherit;color:var(--dsw-alias-label-primary,rgba(20,20,20,.9));max-width:200px}" +
      ".dnm-targetRow{display:flex;align-items:center;gap:8px;padding:10px 14px;min-height:46px;box-sizing:border-box;flex-wrap:wrap}" +
      ".dnm-targetRow+.dnm-targetRow{border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35))}" +
      // A target's secondary fields (signing secret, receiver id, template)
      // hang under their row, same as dnm-rowSub does for the sound rows.
      ".dnm-targetRowSub{padding-left:26px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.04))}" +
      ".dnm-targetStatus{flex:none;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9))}" +
      ".dnm-targetStatus.ok{color:var(--dsw-alias-state-business-primary,#3b82f6)}" +
      ".dnm-targetStatus.off{opacity:.55}" +
      ".dnm-input{flex:1;min-width:180px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));color:var(--dsw-alias-label-primary,rgba(20,20,20,.9));border-radius:8px;padding:5px 8px;font-size:12px;font-family:inherit}" +
      ".dnm-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9))}" +
      ".dnm-feedback{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9));min-height:18px}" +
      // Page header: mark + title + one-line purpose. The section titles below
      // carry the grouping, so the header stays small.
      ".dnm-head{display:flex;align-items:flex-start;gap:12px}" +
      ".dnm-headIcon{flex:none;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:var(--dsw-alias-state-business-primary,#3b82f6);background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.24)}" +
      ".dnm-headText{min-width:0;display:flex;flex-direction:column;gap:3px;padding-top:1px}" +
      ".dnm-headTitle{font-size:15px;font-weight:600;line-height:21px;color:var(--dsw-alias-label-primary,rgba(20,20,20,.9))}" +
      ".dnm-headSub{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9))}" +
      ".dnm-secTitle{margin:2px 0 -6px;padding:0 2px;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-secondary,rgba(90,90,90,.9));letter-spacing:.02em}" +
      // Sub-rows hang under the row they belong to (volume under Sound)
      // instead of reading as siblings.
      ".dnm-rowSub{padding-left:26px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.04))}" +
      ".dnm-rowSub .dnm-rowLabel{font-weight:500}" +
      ".dnm-rowStack{flex-direction:column;align-items:stretch;gap:10px}" +
      ".dnm-rowStack .dnm-btnRow{justify-content:flex-start;flex-wrap:wrap}" +
      ".dnm-advToggle{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:transparent;color:var(--dsw-alias-label-primary,rgba(20,20,20,.9));border-radius:10px;padding:10px 14px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;text-align:left}" +
      ".dnm-advToggle:hover{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08))}" +
      ".dnm-advToggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:2px}" +
      ".dnm-advRight{display:flex;align-items:center;gap:8px;flex:none;font-weight:400;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9))}" +
      ".dnm-advChev{font-size:10px;translate:0 1px;transition:transform .15s ease}" +
      // A flex item is blockified, so display:inline-block would still stretch to the
      // column width; fit-content is what actually hugs the glyphs.
      ".dnm-rowLabel.dnm-rowTip{width:fit-content;max-width:100%;cursor:help}" +
      ".dnm-rowLabelBtn{cursor:pointer}" +
      ".dnm-rowLabelBtn.dnm-rowTip{display:inline-flex;align-items:center;gap:6px;width:fit-content;cursor:pointer}" +
      ".dnm-chev{font-size:10px;line-height:1;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9))}" +
      ".dnm-rowValue{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9))}" +
      // The long explanation lives in a tooltip next to the pointer, so a
      // row is one line tall. Screen readers still get the text.
      ".dnm-srOnly{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}" +
      ".dnm-tip{position:fixed;left:-9999px;top:-9999px;z-index:2147483001;max-width:270px;box-sizing:border-box;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-3,#26282c);color:var(--dsw-alias-label-secondary,rgba(90,90,90,.9));font-size:12px;line-height:17px;box-shadow:0 6px 18px rgba(0,0,0,.35);pointer-events:none;opacity:0;transition:opacity .12s ease}" +
      ".dnm-tip.on{opacity:1}" +
      ".dnm-advChev.open{transform:rotate(180deg)}" +
      // Sidebar-row mute affordances (issue #23): a hover button in the row's
      // action slot and a marker in its leading slot. They live in the host's
      // own row layout, so everything is sized in em-free pixels and coloured
      // through the alias tokens to survive light and dark themes.
      ".dnm-rowIcon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:none;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9));cursor:pointer;line-height:0}" +
      ".dnm-rowIcon:hover{color:var(--dsw-alias-label-primary,rgba(20,20,20,.9));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14))}" +
      ".dnm-rowIcon.on{color:var(--dsw-alias-label-secondary,rgba(90,90,90,.9))}" +
      ".dnm-rowMark{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none;line-height:0;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9))}";
    (function injectStyle() {
      try {
        if (typeof document === "undefined" || typeof document.createElement !== "function") return;
        var tagId = "dsh-notify-me/settings";
        if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]")) return;
        var s = document.createElement("style");
        s.dataset.plugin = "dsh-notify-me";
        s.dataset.pluginCss = tagId;
        s.textContent = UI_CSS;
        (document.head || document.documentElement).appendChild(s);
      } catch (e) {}
    })();

    // Hover hints: a row keeps one line of text; its explanation shows up in a
    // small box beside the pointer after a short delay. One shared node, so
    // nothing has to be cleaned up per row.
    var TIP_ID = "dsh-notify-me-tip";
    var tipEl = null;
    var tipTimer = null;
    var tipShown = false;
    var tipX = 0;
    var tipY = 0;
    function tipNode() {
      try {
        if (tipEl && tipEl.parentNode) return tipEl;
        if (typeof document === "undefined" || !document.body) return null;
        var node = document.createElement("div");
        node.id = TIP_ID;
        node.className = "dnm-tip";
        node.setAttribute("role", "tooltip");
        document.body.appendChild(node);
        tipEl = node;
        return node;
      } catch (e) { return null; }
    }
    function hideTip() {
      if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
      if (!tipShown) return;
      tipShown = false;
      if (tipEl) tipEl.className = "dnm-tip";
    }
    // Keep the box on screen: flip left of the pointer near the right edge,
    // flip above it near the bottom.
    function placeTip() {
      var node = tipEl;
      if (!node || !tipShown) return;
      var pad = 12;
      var rect = node.getBoundingClientRect();
      var vw = window.innerWidth || 0;
      var vh = window.innerHeight || 0;
      var x = tipX + 14;
      if (x + rect.width + pad > vw) x = tipX - rect.width - 14;
      if (x < pad) x = pad;
      var y = tipY + 18;
      if (y + rect.height + pad > vh) y = tipY - rect.height - 12;
      if (y < pad) y = pad;
      node.style.left = Math.round(x) + "px";
      node.style.top = Math.round(y) + "px";
    }
    function showTip(text) {
      var node = tipNode();
      if (!node) return;
      node.textContent = text;
      tipShown = true;
      node.className = "dnm-tip on";
      placeTip();
    }
    function tipHandlers(text) {
      return {
        onMouseEnter: function (e) {
          tipX = e.clientX;
          tipY = e.clientY;
          if (tipTimer) clearTimeout(tipTimer);
          tipTimer = setTimeout(function () { tipTimer = null; showTip(text); }, 320);
        },
        onMouseMove: function (e) {
          tipX = e.clientX;
          tipY = e.clientY;
          if (tipShown) placeTip();
        },
        onMouseLeave: hideTip
      };
    }
    // Attach the tooltip to the label text only. Hovering the switch or the
    // slider on the right of a row should not pop an explanation.
    function tipTarget(node, hintText) {
      if (!node || typeof node !== "object") return node;
      var props = node.props || {};
      var className = String(props.className || "");
      // React keeps children in props.children; the smoke harness keeps them on
      // the node itself, so look in both places.
      var kids = props.children;
      if (kids === undefined && node.children) kids = node.children.length === 1 ? node.children[0] : node.children;
      if (className.indexOf("dnm-rowLabel") >= 0) {
        var handlers = tipHandlers(hintText);
        var merged = {};
        for (var k in props) merged[k] = props[k];
        merged.className = className + " dnm-rowTip";
        merged["data-dnm-tip"] = hintText;
        merged.onMouseEnter = handlers.onMouseEnter;
        merged.onMouseMove = handlers.onMouseMove;
        merged.onMouseLeave = handlers.onMouseLeave;
        return h(node.type, merged, kids);
      }
      if (Array.isArray(kids)) {
        var changed = false;
        var next = [];
        for (var i = 0; i < kids.length; i++) {
          var mapped = tipTarget(kids[i], hintText);
          if (mapped !== kids[i]) changed = true;
          next.push(mapped);
        }
        return changed ? h(node.type, props, next) : node;
      }
      var single = tipTarget(kids, hintText);
      return single === kids ? node : h(node.type, props, single);
    }
    // A row that has an explanation: single-line label, text in the tooltip.
    function tipRow(className, hintText, children) {
      if (!hintText) return h("div", { className: className }, children);
      var kids = Array.isArray(children)
        ? children.map(function (child) { return tipTarget(child, hintText); })
        : tipTarget(children, hintText);
      return h("div", { className: className }, kids);
    }
    // Read-screen-only copy of the tooltip text.
    function srOnly(text) {
      return text ? h("span", { className: "dnm-srOnly" }, text) : null;
    }
    (function tipDismissOnScroll() {
      try { window.addEventListener("scroll", hideTip, true); } catch (e) {}
    })();

    // A labelled <select> row, for settings that pick one of three behaviours
    // rather than switching something on.
    function rowSelect(key, labelText, hintText, current, options, onPick) {
      return tipRow("dnm-row", hintText, [
        h("div", { className: "dnm-rowText" }, [
          h("div", { className: "dnm-rowLabel" }, labelText),
          srOnly(hintText)
        ]),
        h("select", {
          className: "dnm-select",
          value: current,
          "aria-label": labelText,
          onChange: function (e) { onPick(e.currentTarget.value); }
        }, options.map(function (o) { return h("option", { value: o.value }, o.label); }))
      ]);
    }
    function rowSwitch(key, labelText, hintText, checked, onChange) {
      return tipRow("dnm-row", hintText, [
        h("div", { className: "dnm-rowText" }, [
          h("div", { className: "dnm-rowLabel" }, labelText),
          srOnly(hintText)
        ]),
        h("button", {
          type: "button",
          role: "switch",
          "aria-checked": checked ? "true" : "false",
          // the knob span carries no text of its own, so the row label has to
          // name the button (and the test presser can find it)
          "aria-label": labelText,
          className: "dnm-switch" + (checked ? " on" : ""),
          onClick: function () { onChange(!checked); }
        }, h("span", { className: "dnm-knob" }))
      ]);
    }
    function card(children) {
      return h("div", { className: "dnm-card" }, children);
    }

    // ──────────────── per-session mute: sidebar row UI ─────────────────
    // The host ships no "silence this row" API, so the switch rides the row's
    // own action slot (visible on hover) and leaves a mark in its leading slot
    // while the session is muted — the two slots the schedule plugin already
    // injects into, i.e. the cheapest stable place to hang this off (issue #23).
    function sessionMuteIcon(kind) {
      var base = {
        viewBox: "0 0 16 16",
        width: "14",
        height: "14",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.4",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        focusable: "false",
        "aria-hidden": "true"
      };
      if (kind === "off") {
        // A bell with a slash: "silenced".
        return h("svg", base, [
          h("path", { d: "M5.9 3.4a4.7 4.7 0 0 1 6.8 4.1v2.2l1.1 1.9H4.6" }),
          h("path", { d: "M6.7 13.3a1.5 1.5 0 0 0 2.6 0" }),
          h("path", { d: "M2.3 2.3l11.4 11.4" })
        ]);
      }
      return h("svg", base, [
        h("path", { d: "M3.3 11.2V6.9a4.7 4.7 0 0 1 9.4 0v4.3l1.1 1.9H2.2l1.1-1.9Z" }),
        h("path", { d: "M6.7 13.3a1.5 1.5 0 0 0 2.6 0" })
      ]);
    }
    // Both slots re-render themselves: the host repaints a row only when its own
    // state moves, so a bell that read the config once at mount would keep
    // showing the old state after the settings page or a sibling row changed it.
    function useSessionMuted(sessionId) {
      var bumpState = React.useState(0);
      var bump = bumpState[1];
      React.useEffect(function () {
        return subscribeMuteChange(function () { bump(function (n) { return n + 1; }); });
      }, []);
      return isSessionMuted(sessionId);
    }
    function SessionMuteButton(props) {
      var sid = typeof props.sessionId === "string" ? props.sessionId : "";
      var muted = useSessionMuted(sid);
      var labelText = muted ? props.t("unmuteSession") : props.t("muteSession");
      return h("button", {
        type: "button",
        className: "dnm-rowIcon" + (muted ? " on" : ""),
        title: labelText,
        "aria-label": labelText,
        "aria-pressed": muted ? "true" : "false",
        "data-dnm-mute": sid,
        onClick: function (e) {
          // The row opens the session on click and its action cell stops
          // propagation; stop here too so a host change cannot turn the bell
          // into "open this session".
          e.preventDefault();
          e.stopPropagation();
          if (!sid) return;
          setSessionMuted(sid, !isSessionMuted(sid));
        }
      }, sessionMuteIcon(muted ? "off" : "on"));
    }
    function SessionMuteMark(props) {
      var sid = typeof props.sessionId === "string" ? props.sessionId : "";
      var muted = useSessionMuted(sid);
      if (!muted) return null;
      return h("span", {
        className: "dnm-rowMark",
        role: "img",
        title: props.t("muteMark"),
        "aria-label": props.t("muteMark"),
        "data-dnm-mute-mark": sid
      }, sessionMuteIcon("off"));
    }

    function NotifySettingsView(props) {
      var ctx = props.ctx;
      var t = props.t;
      // Keep the page copy in sync with the active DSH UI language.
      React.useSyncExternalStore(function (cb) { return ctx.locale.subscribe(cb); }, function () { return ctx.locale.getSnapshot(); });
      var cfgState = React.useState(function () { return readConfig(); });
      var cfg = cfgState[0];
      var setCfg = cfgState[1];
      var feedbackState = React.useState("");
      var feedback = feedbackState[0];
      var setFeedback = feedbackState[1];
      // Picked cue files bypass the config object (own localStorage keys), so
      // the page needs its own nudge to re-read them after a change.
      var soundBumpState = React.useState(0);
      var soundBump = soundBumpState[0];
      var setSoundBump = soundBumpState[1];
      function patch(p) {
        setCfg(setConfigLocal(p));
      }
      function previewSound(kind) {
        // The master switch is authoritative here too, so a preview with sound
        // off has to say why it stayed quiet instead of looking broken.
        if (!config.sound) { setFeedback(t("soundOffHint")); return; }
        // 'system' has no cue to play from here: the sound only exists as part
        // of a toast, which the OS then chimes for. The honest preview is
        // therefore a real test alert — otherwise the button is silent and
        // reads as broken.
        if (soundMode(kind) === "system") {
          unlockOnce();
          testAlert(kind);
          setFeedback(t("soundPreviewSystem"));
          return;
        }
        // Otherwise: the same cue the alert itself will play, volume included.
        unlockOnce();
        if (kind === "attention") playAttentionSound();
        else playDoneSound();
      }
      // One row per alert kind. The source select is always there; the file
      // picker only appears for 'custom', so the page stays short for anyone
      // who never touches it.
      function soundRows(kind, labelText) {
        var modeKey = kind === "attention" ? "soundAttention" : "soundDone";
        var previewLabel = t(kind === "attention" ? "soundPreviewAttention" : "soundPreviewDone");
        var mode = soundMode(kind);
        var rec = readSound(kind);
        // The hint states what will actually be heard, so a stored file is
        // named right where the choice is made.
        var note = mode === "system" ? t("soundSystemNote")
          : mode === "custom" ? (rec ? rec.name : t("soundNone"))
            : t("soundSynthNote");
        var rows = [
          h("div", { className: "dnm-row" }, [
            h("div", { className: "dnm-rowText" }, [
              h("div", { className: "dnm-rowLabel" }, labelText),
              h("div", { className: "dnm-rowValue" }, note)
            ]),
            h("div", { className: "dnm-btnRow" }, [
              h("select", {
                className: "dnm-select",
                value: mode,
                "aria-label": labelText,
                onChange: function (e) {
                  var p = {};
                  p[modeKey] = e.currentTarget.value;
                  patch(p);
                }
              }, [
                h("option", { value: "synth" }, t("soundSynth")),
                h("option", { value: "custom" }, t("soundCustom")),
                h("option", { value: "system" }, t("soundSystem"))
              ]),
              h("button", {
                type: "button",
                className: "dnm-btn",
                disabled: !cfg.enabled,
                "aria-label": previewLabel,
                onClick: function () { previewSound(kind); }
              }, t("soundPreview"))
            ])
          ])
        ];
        if (mode !== "custom") return rows;
        var pickNote = (rec ? Math.round((rec.size || 0) / 1024) + " KB · " : t("soundNone") + " · ")
          + "≤" + Math.round(SOUND_MAX_BYTES / 1024) + " KB";
        rows.push(tipRow("dnm-row", pickNote, [
          h("div", { className: "dnm-rowText" }, [
            h("div", { className: "dnm-rowLabel" }, t("soundPick")),
            srOnly(pickNote)
          ]),
          h("div", { className: "dnm-btnRow" }, [
            h("input", {
              type: "file",
              accept: "audio/*",
              className: "dnm-file",
              "aria-label": t("soundPick"),
              onChange: function (e) {
                var input = e.currentTarget;
                var f = input.files && input.files[0];
                if (!f) return;
                if (f.size > SOUND_MAX_BYTES) {
                  // Clear on every exit so re-picking the same file still fires.
                  input.value = "";
                  setFeedback(t("soundTooBig") + Math.round(SOUND_MAX_BYTES / 1024) + " KB");
                  return;
                }
                var fr = new FileReader();
                fr.onload = function () {
                  input.value = "";
                  var data = String(fr.result || "");
                  if (data.indexOf("data:audio/") !== 0) { setFeedback(t("soundNotAudio")); return; }
                  if (!writeSound(kind, { name: f.name, size: f.size, data: data })) {
                    setFeedback(t("soundQuota"));
                    return;
                  }
                  setSoundBump(soundBump + 1);
                  setFeedback(t("soundSaved") + f.name);
                };
                fr.onerror = function () { input.value = ""; setFeedback(t("soundReadFail")); };
                fr.readAsDataURL(f);
              }
            }),
            h("button", {
              type: "button",
              className: "dnm-btn",
              disabled: !rec,
              "aria-label": previewLabel,
              onClick: function () { previewSound(kind); }
            }, t("soundPreview")),
            h("button", {
              type: "button",
              className: "dnm-btn",
              disabled: !rec,
              onClick: function () {
                writeSound(kind, null);
                setSoundBump(soundBump + 1);
                setFeedback(t("soundCleared"));
              }
            }, t("soundClear"))
          ])
        ]));
        return rows;
      }
      function runTest(kind) {
        if (!config.enabled) { setFeedback(t("offHint")); return; }
        // A denied permission means showToast() returns before it tries
        // anything and records no refusal; saying "sent" there would be the
        // same lie issue #18 was about, one layer earlier.
        if (!canToast()) {
          requestPermission(true);
          setFeedback(t("testNoPermission"));
          return;
        }
        unlockOnce();
        // Bypasses the visibility rules on purpose: a test must fire while the
        // page is open, otherwise the button proves nothing.
        var before = lastToastReject;
        var report = function () {
          // "sent" would be a lie when the platform refused the toast: the
          // constructor throws synchronously, and the worker's
          // showNotification() rejects a tick later, so the worker path waits
          // for that promise before it reports (issue #18).
          var refused = lastToastReject && lastToastReject !== before ? lastToastReject : null;
          if (refused) { setFeedback(t("testRefused") + refused.message); return; }
          var langName = effectiveLang() === "en" ? t("langEn") : t("langZh");
          var msg = t("sent") + langName;
          if (kind === "approval" && !bridgeActive()) {
            msg += " · " + (isDesktopShell() ? t("testApprovalNoBridge") : t("bridgeOff") + swState + t("bridgeOffTail"));
          }
          setFeedback(msg);
        };
        lastToastPending = null;
        testAlert(kind);
        var pending = lastToastPending;
        if (pending && typeof pending.then === "function") pending.then(report, report);
        else report();
      }
      // External forwarding rows. Target edits always patch with a fresh array
      // (readConfig may hand out the DEFAULTS entry itself; in-place mutation
      // would silently corrupt the defaults for the next reset).
      var EXTERNAL_TYPE_OPTIONS = [
        ["discord", "externalTypeDiscord"],
        ["bark", "externalTypeBark"],
        ["gotify", "externalTypeGotify"],
        ["feishu", "externalTypeFeishu"],
        ["serverchan", "externalTypeServerchan"],
        ["wxpusher", "externalTypeWxpusher"],
        ["custom", "externalTypeCustom"]
      ];
      // Last verdict for one target, as plain words. The record is written by
      // the delivery engine on every send and survives a reload, so a target
      // that has been silently failing says so where it is configured.
      function externalStatusText(target) {
        var rec = target && target.id ? externalHealth[target.id] : null;
        if (!rec || !rec.at) return t("externalStatusNever");
        var label = rec.status === "sent" ? t("externalStatusSent")
          : rec.status === "unverified" ? t("externalStatusUnverified")
            : t("externalStatusFailed");
        var when = "";
        try { when = new Date(rec.at).toLocaleTimeString(); } catch (e) { when = ""; }
        // An unverified verdict shows why as well. It used to show a bare
        // "sent-unconfirmed", and the state the user was left in — an alert the
        // page said went out and a phone that stayed silent — is exactly what
        // that missing reason hid.
        var why = rec.status === "sent" ? "" : (rec.reason ? " · " + externalReasonText(rec.reason) : "");
        return label + why + (when ? " · " + when : "");
      }
      // The engine's reason codes, in the user's language. An unknown code (a
      // record written by a future version, or a raw HTTP status) is shown as
      // it is rather than dropped: a diagnostic the page refuses to render is
      // the same as no diagnostic at all.
      function externalReasonText(reason) {
        var r = String(reason || "");
        if (r === "opaque") return t("externalReasonOpaque");
        if (r === "via-relay") return t("externalReasonViaRelay");
        return r;
      }
      function targetField(field, i, value, placeholder, label) {
        return h("input", {
          className: "dnm-input",
          value: value || "",
          placeholder: placeholder,
          "aria-label": label,
          onChange: function (e) {
            var fields = {};
            fields[field] = e.currentTarget.value;
            updateTarget(i, fields);
          }
        });
      }
      function externalRows() {
        var rows = [];
        var targets = Array.isArray(cfg.externalTargets) ? cfg.externalTargets : [];
        for (var i = 0; i < targets.length; i++) {
          (function (i) {
            var target = targets[i] || {};
            var type = externalType(target.type);
            var enabled = target.enabled !== false;
            var mainFields = type === "wxpusher"
              ? targetField("token", i, target.token, t("externalTokenPlaceholder"), t("externalTokenField"))
              : targetField("url", i, target.url, t("externalUrlPlaceholder"), t("externalUrlField"));
            rows.push(h("div", { className: "dnm-targetRow" }, [
              h("select", {
                className: "dnm-select",
                value: type,
                "aria-label": t("externalTypeField"),
                onChange: function (e) { updateTarget(i, { type: e.currentTarget.value }); }
              }, EXTERNAL_TYPE_OPTIONS.map(function (o) {
                return h("option", { value: o[0] }, t(o[1]));
              })),
              mainFields,
              h("span", { className: "dnm-targetStatus" + (enabled ? "" : " off") }, externalStatusText(target)),
              h("button", {
                type: "button",
                role: "switch",
                "aria-checked": enabled ? "true" : "false",
                className: "dnm-switch" + (enabled ? " on" : ""),
                "aria-label": t("externalTargetToggle"),
                onClick: function () { updateTarget(i, { enabled: !enabled }); }
              }, h("span", { className: "dnm-knob" })),
              h("button", {
                type: "button",
                className: "dnm-btn",
                "aria-label": t("externalRemove"),
                onClick: function () { removeTarget(i); }
              }, t("externalRemove"))
            ]));
            // Fields that only some target types have. They live on their own
            // line so the type select and the URL stay readable.
            var sub = [];
            if (type === "wxpusher") {
              sub.push(targetField("uid", i, target.uid, t("externalUidPlaceholder"), t("externalUidField")));
            }
            if (type === "feishu" || type === "custom") {
              var secretHint = type === "feishu" ? t("externalSecretPlaceholderFeishu")
                : t("externalSecretPlaceholderCustom");
              sub.push(targetField("secret", i, target.secret, secretHint, t("externalSecretField")));
            }
            if (type !== "discord" && type !== "bark" && type !== "gotify") {
              sub.push(targetField("template", i, target.template, t("externalTemplatePlaceholder"), t("externalTemplateField")));
            }
            if (sub.length) rows.push(h("div", { className: "dnm-targetRow dnm-targetRowSub" }, sub));
            // A target naming the relay's own upstream gateway is delivered
            // through the relay, never straight at it. Saying so next to the
            // address is the only way the user learns why that address works
            // even though a browser can never post to it.
            if (relayFoldPath(target)) {
              rows.push(h("div", { className: "dnm-targetRow dnm-targetRowSub" }, [
                h("div", { className: "dnm-hint" }, t("externalRelayFoldNote"))
              ]));
            }
          })(i);
        }
        return rows;
      }
      // The persisted "these never made it" log: the alert was already shown
      // locally, so this list is the only place a lost external delivery
      // surfaces. Only a title/body snippet is kept, never the endpoint.
      function deadLetterRow() {
        var dead = readExternalDead();
        var last = dead[0];
        var text = dead.length
          ? t("externalDeadHint") + dead.length + t("externalDeadUnit") + (last && last.at ? " · " + t("externalDeadLast") + (last.host ? last.host + " · " : "") + last.at : "")
          : t("externalDeadNone");
        return h("div", { className: "dnm-row" }, [
          h("div", { className: "dnm-rowText" }, [
            h("div", { className: "dnm-rowLabel" }, t("externalDeadLabel")),
            h("div", { className: "dnm-hint" }, text)
          ]),
          dead.length ? h("div", { className: "dnm-btnRow" }, [
            h("button", {
              type: "button",
              className: "dnm-btn",
              "aria-label": t("externalDeadClear"),
              onClick: function () { clearExternalDead(); setFeedback(t("externalDeadCleared")); patch({}); }
            }, t("externalDeadClear"))
          ]) : null
        ]);
      }
      function updateTarget(i, patchFields) {
        var list = (Array.isArray(cfg.externalTargets) ? cfg.externalTargets : []).slice();
        var cur = list[i] || {};
        var next = {};
        for (var k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) next[k] = cur[k];
        for (var p in patchFields) if (Object.prototype.hasOwnProperty.call(patchFields, p)) next[p] = patchFields[p];
        list[i] = next;
        patch({ externalTargets: list });
      }
      function removeTarget(i) {
        var list = (Array.isArray(cfg.externalTargets) ? cfg.externalTargets : []).slice();
        list.splice(i, 1);
        patch({ externalTargets: list });
      }
      function addTarget() {
        var list = (Array.isArray(cfg.externalTargets) ? cfg.externalTargets : []).slice();
        list.push({
          id: "ext" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          type: "discord",
          url: ""
        });
        patch({ externalTargets: list });
      }
      // Explicit channel test: posts a synthetic event to every target even
      // when the per-kind forward toggles are off (they gate real alerts, not
      // this button). The button stays pressable whenever the plugin is on, so
      // the "why did nothing arrive" cases get a hint instead of a dead control.
      function runExternalTest() {
        if (!cfg.enabled) { setFeedback(t("offHint")); return; }
        if (!cfg.externalEnabled) { setFeedback(t("externalOffHint")); return; }
        if (!externalTargets().length) { setFeedback(t("externalNoTargets")); return; }
        setFeedback(t("externalSending"));
        var d = texts();
        sendExternalToAll("attention", d.testExternalTitle, d.testExternalBody, currentSessionId(), true, function (statuses) {
          var s = 0, u = 0, f = 0;
          for (var i = 0; i < statuses.length; i++) {
            if (statuses[i] === "sent") s++;
            else if (statuses[i] === "unverified") u++;
            else f++;
          }
          setFeedback(t("externalTestDone") + t("externalCountSent") + s + " · " + t("externalCountUnverified") + u + " · " + t("externalCountFailed") + f);
        });
      }
      // Read-only host coordination status: whether the host has a fallback
      // (the probe decides this, not the user — there is nothing to configure
      // here, only to report), and the relay address to paste into a webhook
      // once the host offers one. The probe runs in the background, so a page
      // opened before the host answered may still read its first state.
      function hostBridgeRows() {
        var hb = hostBridgeState;
        var hostText = hb.state === "active" ? t("externalHostFallbackOn")
          : hb.state === "error" ? t("externalHostFallbackError")
            : t("externalHostFallbackOff");
        var relayText = t("externalRelayOff");
        if (hb.relayEnabled && hb.relayPath) {
          // The address is this page's own origin plus the route the host
          // published: exactly the string a custom webhook needs.
          var origin = "";
          try { origin = String(location.origin || ""); } catch (e) { origin = ""; }
          relayText = t("externalRelayOn") + " · " + t("externalRelayAddress") + origin + hb.relayPath;
        }
        return [
          tipRow("dnm-row dnm-rowSub", t("externalHostBridgeHint"), [
            h("div", { className: "dnm-rowText" }, [
              h("div", { className: "dnm-rowLabel" }, t("externalHostBridgeLabel")),
              h("div", { className: "dnm-rowValue" }, hostText),
              srOnly(t("externalHostBridgeHint"))
            ])
          ]),
          tipRow("dnm-row dnm-rowSub", t("externalRelayHint"), [
            h("div", { className: "dnm-rowText" }, [
              h("div", { className: "dnm-rowLabel" }, t("externalRelayLabel")),
              h("div", { className: "dnm-rowValue" }, relayText),
              srOnly(t("externalRelayHint"))
            ])
          ]),
          hb.state === "error" ? h("div", { className: "dnm-row" }, [
            h("div", { className: "dnm-rowText" }, [
              h("div", { className: "dnm-hint" }, hostBridgeErrorNoteText(hb.lastReason))
            ])
          ]) : null
        ];
      }
      // Two very different "the host said no" stories, and the difference is
      // what the user has to do about it: a gate refusal is a configuration key
      // they can fix (the allowlist), anything else is a build or deployment
      // problem. `bad-host` / `cross-origin` come straight from the host's own
      // gate, so they name the one thing worth naming.
      function hostBridgeErrorNoteText(reason) {
        if (reason === "bad-host" || reason === "cross-origin") return t("externalHostBridgeDeniedNote");
        return t("externalHostBridgeErrorNote");
      }
      var permOK = ("Notification" in window) ? Notification.permission === "granted" : false;
      var resolvedLang = effectiveLang();
      var resolvedLangName = resolvedLang === "en" ? t("langEn") : t("langZh");
      var langNote = resolvedLangName + (cfg.language === "auto" ? t("langAutoNote") : "");
      // The environment row states what detection saw whenever the manual
      // choice disagrees with it — the override exists for hosts where the
      // protocol read comes out wrong, so the divergence must be visible.
      var envHint = t("hostEnvHint");
      if (cfg.hostEnv === "desktop" && !detectedDesktop()) envHint += t("hostEnvDesktopForcedNote");
      else if (cfg.hostEnv !== "auto" && isDesktopShell() !== detectedDesktop()) {
        envHint += t("hostEnvMismatch") + (detectedDesktop() ? t("hostEnvDesktop") : t("hostEnvWeb")) + t("hostEnvMismatchTail");
      }
      // Page header: the plugin's own mark instead of the host's generic
      // settings gear, so the page is recognisable at a glance while the
      // Settings nav row itself stays host-controlled.
      function headIcon() {
        return h("svg", { viewBox: "0 0 24 24", width: 22, height: 22, fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, [
          h("path", { d: "M12 3.4a5.1 5.1 0 0 0-5.1 5.1v3.1c0 .9-.3 1.7-.9 2.4l-1.1 1.3c-.5.6-.1 1.5.7 1.5h12.8c.8 0 1.2-.9.7-1.5l-1.1-1.3a3.8 3.8 0 0 1-.9-2.4V8.5A5.1 5.1 0 0 0 12 3.4Z" }),
          h("path", { d: "M9.8 19.2a2.4 2.4 0 0 0 4.4 0" }),
          h("circle", { cx: 18.3, cy: 5.3, r: 2.35, fill: "currentColor", stroke: "none" })
        ]);
      }
      function secTitle(labelText) {
        return h("div", { className: "dnm-secTitle" }, labelText);
      }
      // The permission state belongs on the System-notifications row it affects
      // rather than in a footer note the user has to connect to it.
      function toastHintText() {
        return t("toastHint") + (permOK ? "" : " " + t("permHintInline"));
      }
      var advState = React.useState(false);
      var advancedOpen = advState[0];
      var setAdvancedOpen = advState[1];
      // Rows mute sessions from the sidebar while this page is open; subscribe so
      // the muted-sessions card stays truthful without closing Settings.
      React.useEffect(function () {
        return subscribeMuteChange(function () { setCfg(readConfig()); });
      }, []);
      // Dependent controls (volume) stay folded away until the row they belong
      // to is clicked open.
      var subStateHook = React.useState({});
      var subState = subStateHook[0];
      var setSubState = subStateHook[1];
      function discloseRow(opts) {
        var open = !!(subState && subState[opts.key]);
        var toggle = function () {
          setSubState(function (prev) {
            var next = {};
            for (var k in prev) next[k] = prev[k];
            next[opts.key] = !prev[opts.key];
            return next;
          });
        };
        var label = h("div", {
          className: "dnm-rowLabel dnm-rowLabelBtn",
          role: "button",
          tabIndex: 0,
          "aria-expanded": open ? "true" : "false",
          "data-dnm-expand": opts.key,
          onClick: toggle,
          onKeyDown: function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
          }
        }, [
          opts.labelText,
          opts.valueText ? h("span", { className: "dnm-rowValue" }, opts.valueText) : null,
          h("span", { className: "dnm-chev" }, open ? "▾" : "▸")
        ]);
        var kids = [h("div", { className: "dnm-rowText" }, [label, srOnly(opts.hintText)])];
        if (opts.control) kids.push(opts.control);
        var row = tipRow(opts.rowClass || "dnm-row", opts.hintText, kids);
        return open ? [row, opts.sub] : [row];
      }
      var testRow = tipRow("dnm-row dnm-rowStack", t("testHint"), [
        h("div", { className: "dnm-rowText" }, [
          h("div", { className: "dnm-rowLabel" }, t("testTitle")),
          srOnly(t("testHint"))
        ]),
        h("div", { className: "dnm-btnRow" }, [
          h("button", { type: "button", className: "dnm-btn", disabled: !cfg.enabled, onClick: function () { runTest("attention"); } }, t("testAttention")),
          h("button", { type: "button", className: "dnm-btn", disabled: !cfg.enabled, onClick: function () { runTest("done"); } }, t("testDone")),
          h("button", { type: "button", className: "dnm-btn", disabled: !cfg.enabled || !cfg.quickActions, onClick: function () { runTest("approval"); } }, t("testApprovalBtn"))
        ])
      ]);
      return h("div", { className: "dnm-wrap" }, [
        h("div", { className: "dnm-head" }, [
          h("span", { className: "dnm-headIcon" }, headIcon()),
          h("div", { className: "dnm-headText" }, [
            h("div", { className: "dnm-headTitle" }, t("nav")),
            h("p", { className: "dnm-headSub" }, t("blurb"))
          ])
        ]),
        // 1) How the alert reaches you. System notifications only — no channel
        // choice since 1.11.0 — with the volume slider hanging beneath the
        // sound switch.
        secTitle(t("secWays")),
        card([
          rowSwitch("enabled", t("enable"), t("enableHint"), cfg.enabled, function (v) {
            patch({ enabled: v });
            if (!v && attentionActive > 0) { attentionActive = 0; applyTitle(); }
          }),
          cfg.sound ? discloseRow({
            key: "volume",
            labelText: t("sound"),
            hintText: t("soundHint"),
            valueText: String(Math.round(cfg.volume * 100)) + "%",
            control: h("button", {
              type: "button",
              role: "switch",
              "aria-checked": "true",
              "aria-label": t("sound"),
              className: "dnm-switch on",
              onClick: function () { patch({ sound: false }); }
            }, h("span", { className: "dnm-knob" })),
            sub: h("div", { className: "dnm-row dnm-rowSub" }, [
              h("div", { className: "dnm-rowText" }, [
                h("div", { className: "dnm-rowLabel" }, t("volume")),
                h("div", { className: "dnm-rowHint" }, String(Math.round(cfg.volume * 100)) + "%")
              ]),
              h("input", {
                type: "range",
                className: "dnm-range",
                min: 0, max: 100, step: 5,
                value: Math.round(cfg.volume * 100),
                "aria-label": t("volume"),
                onChange: function (e) { patch({ volume: Number(e.currentTarget.value) / 100 }); }
              })
            ])
          }) : rowSwitch("sound", t("sound"), t("soundHint"), false, function (v) { patch({ sound: v }); }),
          rowSwitch("quickActions", t("quickActions"), t("quickActionsHint"), cfg.quickActions, function (v) {
            patch({ quickActions: v });
            if (v) ensureActionBridge();
          })
        ]),
        // 2) Which events are worth interrupting for.
        secTitle(t("secWhen")),
        card([
          rowSwitch("attentionVisible", t("attentionVisible"), t("attentionVisibleHint"), !cfg.attentionHiddenOnly, function (v) { patch({ attentionHiddenOnly: !v }); }),
          rowSwitch("currentQuiet", t("currentQuiet"), t("currentQuietHint"), cfg.currentHiddenOnly, function (v) { patch({ currentHiddenOnly: v }); }),
          rowSelect("donePolicy", t("donePolicy"), t("donePolicyHint"), cfg.donePolicy, [
            { value: "background", label: t("dpBackground") },
            { value: "smart", label: t("dpSmart") },
            { value: "always", label: t("dpAlways") }
          ], function (v) { patch({ donePolicy: v }); }),
          rowSelect("autoDismiss", t("autoDismiss"), t("autoDismissHint"), cfg.autoDismiss, [
            { value: "present", label: t("adPresent") },
            { value: "always", label: t("adAlways") },
            { value: "never", label: t("adNever") }
          ], function (v) { patch({ autoDismiss: v }); }),
          rowSwitch("subagentQuiet", t("subagentQuiet"), t("subagentQuietHint"), cfg.ignoreSubagent, function (v) { patch({ ignoreSubagent: v }); }),
          rowSwitch("autoFocus", t("autoFocus"), t("autoFocusHint"), cfg.autoFocus, function (v) { patch({ autoFocus: v }); })
        ]),
        // 2b) Sessions silenced by hand from the sidebar row. The switch lives on
        // the row itself (hover bell) and as a mark before its title; this card
        // is where the list is visible and can be cleared in one click.
        secTitle(t("secMute")),
        card([
          cfg.mutedSessions.length === 0
            ? h("div", { className: "dnm-row" }, [
              h("div", { className: "dnm-rowText" }, [h("div", { className: "dnm-hint" }, t("muteNone"))])
            ])
            : h("div", { className: "dnm-row" }, [
              h("div", { className: "dnm-rowText" }, [
                h("div", { className: "dnm-rowLabel" }, t("muteMuted") + String(cfg.mutedSessions.length))
              ]),
              h("button", {
                type: "button",
                className: "dnm-btn",
                onClick: function () { patch({ mutedSessions: [] }); }
              }, t("muteClear"))
            ]),
          h("div", { className: "dnm-row" }, [
            h("div", { className: "dnm-rowText" }, [h("div", { className: "dnm-hint" }, t("muteHint"))])
          ])
        ]),
        // 3) Prove the setup works without leaving the page.
        secTitle(t("secTest")),
        card([
          testRow,
          !cfg.quickActions ? h("div", { className: "dnm-row" }, [
            h("div", { className: "dnm-rowText" }, [h("div", { className: "dnm-rowHint" }, t("testNeedsQuick"))])
          ]) : h("div", { className: "dnm-row" }, [
            h("div", { className: "dnm-rowText" }, [h("div", { className: "dnm-rowHint" }, !bridgeActive() ? (isDesktopShell() ? t("bridgeOffDesktop") : t("bridgeOff") + swState + t("bridgeOffTail")) : t("quickApprovalNote"))])
          ]),
          feedback ? h("div", { className: "dnm-row" }, [
            h("div", { className: "dnm-rowText" }, [h("div", { className: "dnm-feedback" }, feedback)])
          ]) : null
        ]),
        // 4) Everything most users never touch, collapsed by default. It all
        // stays mounted-on-demand (no hidden DOM work while closed).
        h("button", {
          type: "button",
          className: "dnm-advToggle",
          "aria-expanded": advancedOpen ? "true" : "false",
          "aria-label": t("advanced"),
          onClick: function () { setAdvancedOpen(!advancedOpen); }
        }, [
          h("span", null, t("advanced")),
          h("span", { className: "dnm-advRight" }, [
            h("span", null, advancedOpen ? t("collapse") : t("advancedHint")),
            h("span", { className: "dnm-advChev" + (advancedOpen ? " open" : "") }, "▼")
          ])
        ]),
        advancedOpen ? [
          secTitle(t("soundSource")),
          // Alert sound source: built-in cue, a picked file, or the platform's
          // own sound. Re-read through soundBump because picked files live
          // outside the config object.
          card([].concat(
            [h("div", { className: "dnm-row" }, [
              h("div", { className: "dnm-rowText" }, [h("div", { className: "dnm-hint" }, t("soundSourceHint"))])
            ])],
            soundRows("done", t("soundDoneLabel")),
            soundRows("attention", t("soundAttentionLabel"))
          )),
          secTitle(t("external")),
          // External forwarding: the same alerts mirrored to the user's own
          // webhook endpoints so "come back" reaches them away from the machine.
          card([].concat(
            [h("div", { className: "dnm-row" }, [
              h("div", { className: "dnm-rowText" }, [h("div", { className: "dnm-hint" }, t("externalHint"))])
            ])],
            [rowSwitch("externalEnabled", t("externalEnable"), t("externalEnableHint"), cfg.externalEnabled, function (v) { patch({ externalEnabled: v }); })],
            [rowSwitch("externalAttention", t("externalAttentionLabel"), t("externalAttentionHint"), cfg.externalAttention, function (v) { patch({ externalAttention: v }); })],
            [rowSwitch("externalDone", t("externalDoneLabel"), t("externalDoneHint"), cfg.externalDone, function (v) { patch({ externalDone: v }); })],
            [tipRow("dnm-row", t("externalTargetsHint"), [
              h("div", { className: "dnm-rowText" }, [
                h("div", { className: "dnm-rowLabel" }, t("externalTargetsLabel")),
                srOnly(t("externalTargetsHint"))
              ])
            ])],
            externalRows(),
            [(Array.isArray(cfg.externalTargets) && cfg.externalTargets.length) ? h("div", { className: "dnm-row" }, [
              h("div", { className: "dnm-rowText" }, [h("div", { className: "dnm-hint" }, t("externalPrivacy"))])
            ]) : h("div", { className: "dnm-row" }, [
              h("div", { className: "dnm-rowText" }, [h("div", { className: "dnm-hint" }, t("externalEmpty"))])
            ])],
            [h("div", { className: "dnm-row" }, [
              h("div", { className: "dnm-btnRow" }, [
                h("button", {
                  type: "button",
                  className: "dnm-btn",
                  "aria-label": t("externalAdd"),
                  onClick: addTarget
                }, t("externalAdd"))
              ])
            ])],
            [deadLetterRow()],
            // Read-only: what the host offered when this page probed it, and the
            // relay address to paste into a webhook. Nothing here is a setting —
            // whether the page heartbeats is the host's answer, not a choice.
            hostBridgeRows(),
            [tipRow("dnm-row", t("externalTestHint"), [
              h("div", { className: "dnm-rowText" }, [
                h("div", { className: "dnm-rowLabel" }, t("externalTestLabel")),
                srOnly(t("externalTestHint"))
              ]),
              h("div", { className: "dnm-btnRow" }, [
                h("button", {
                  type: "button",
                  className: "dnm-btn",
                  "aria-label": t("externalTestLabel"),
                  disabled: !cfg.enabled,
                  onClick: runExternalTest
                }, t("externalTestBtn"))
              ])
            ])]
          )),
          secTitle(t("secDiag")),
          card([
            tipRow("dnm-row", envHint, [
              h("div", { className: "dnm-rowText" }, [
                h("div", { className: "dnm-rowLabel" }, t("hostEnv")),
                srOnly(envHint)
              ]),
              h("select", {
                className: "dnm-select",
                value: cfg.hostEnv,
                "aria-label": t("hostEnv"),
                onChange: function (e) { patch({ hostEnv: e.currentTarget.value }); }
              }, [
                h("option", { value: "auto" }, t("hostEnvAuto")),
                h("option", { value: "desktop" }, t("hostEnvDesktop")),
                h("option", { value: "web" }, t("hostEnvWeb"))
              ])
            ]),
            tipRow("dnm-row", langNote, [
              h("div", { className: "dnm-rowText" }, [
                h("div", { className: "dnm-rowLabel" }, t("language")),
                srOnly(langNote)
              ]),
              h("select", {
                className: "dnm-select",
                value: cfg.language,
                "aria-label": t("language"),
                onChange: function (e) { patch({ language: e.currentTarget.value }); }
              }, [
                h("option", { value: "auto" }, t("langAuto")),
                h("option", { value: "zh" }, t("langZh")),
                h("option", { value: "en" }, t("langEn"))
              ])
            ]),
            tipRow("dnm-row", t("resetHint"), [
              h("div", { className: "dnm-rowText" }, [
                h("div", { className: "dnm-rowLabel" }, t("reset")),
                srOnly(t("resetHint"))
              ]),
              h("button", { type: "button", className: "dnm-btn", onClick: function () {
                // api.resetConfig() also drops the picked cue files, which are
                // stored outside the config.
                setCfg(api.resetConfig());
                applyTitle();
                setSoundBump(soundBump + 1);
                setFeedback(t("resetDone"));
              } }, t("reset"))
            ])
          ])
        ] : null,
        // Always-visible version line at the page foot: bug reports need it,
        // and "which build am I on" should not require the console.
        h("p", { className: "dnm-hint" }, t("versionLine") + api.version),
        configWriteFailed ? h("p", { className: "dnm-warn" }, t("storageFailed")) : null
      ]);
    }

    // ────────────────────────── plugin body ──────────────────────────
    // Hard service requirements only. `uiSession` is deliberately NOT listed:
    // a cordis inject entry is a hard gate (the entry stays pending while the
    // service is missing, and the web boot audit fails on entries that never
    // activate), while hosts older than 0.1.2-alpha.2 have no uiSession at all.
    // It is therefore looked up lazily in bindUiSession() — as are `uiWorkspace`
    // (toast-click navigation on 0.1.6+) and `sessions.open` (its pre-0.1.6
    // predecessor) — with the controller path above as the fallback. The bundle
    // entry "@deepseek-ai/dsh-client-ui-session" stays in package.json's
    // dsh.client.inject so the load order keeps the bundle in the graph.
    var inject = ["sessions", "locale", "slots"];

    /**
     * Client plugin body: watch the sessions service and raise desktop
     * notifications + sounds when the agent needs input or a reply finishes;
     * also contributes a Settings page (settings.section slot).
     * @param ctx - client root context.
     */
    function apply(ctx) {
      rootCtx = ctx;
      try {
        if (ctx.locale && typeof ctx.locale.getLocale === "function") localeSvc = ctx.locale;
      } catch (e) {}
      // Settings UI — only when the full web profile (react + slots + locale)
      // is present. The reminder core above never depends on this.
      try {
        if (React && React.createElement && ctx.slots && ctx.locale && typeof ctx.locale.register === "function" && typeof ctx.slots.inject === "function") {
          // The effect returns register()'s own disposer, so a client-plugin
          // reload (HMR) unregisters the dictionaries before re-registering
          // them; locale.register throws when a namespace already has a locale.
          ctx.effect(function () {
            return ctx.locale.register(NS, { zh: UI_zh, en: UI_en });
          }, "dsh-notify-me: settings dictionaries");
          var t = ctx.locale.bind(NS);
          ctx.slots.inject("settings.section", function () {
            return ctx.slots.register({
              name: "settings.section",
              id: "dsh-notify-me",
              order: 45,
              label: function () { return t("nav"); },
              locale: NS,
              inject: function () { return { t: t }; }
            }, function (ownerProps) {
              return React.createElement(NotifySettingsView, { ctx: ctx, t: t });
            });
          });
          // Same page, different layer: give the sidebar row the bell instead of
          // the gear the shell falls back to for unknown section ids.
          ctx.effect(function () {
            return installNavBell(function () { return t("nav"); });
          }, "dsh-notify-me: sidebar glyph");
          // Per-session mute (issue #23): a bell in the row's hover actions and a
          // crossed bell before the title while the session is muted. Both are
          // host-declared list slots, so a host that does not have them simply
          // never calls these factories; each is attempted on its own so a host
          // with only one of the two still gets that one.
          try {
            ctx.slots.inject("sidebar.workspaces.session.row.action", function () {
              return ctx.slots.register({
                name: "sidebar.workspaces.session.row.action",
                id: "dsh-notify-me-mute",
                order: 20,
                locale: NS,
                inject: function () { return { t: t }; }
              }, function (ownerProps) {
                return React.createElement(SessionMuteButton, { sessionId: ownerProps.sessionId, t: t });
              });
            });
          } catch (e) {
            try { console.warn("[dsh-notify-me] row action slot unavailable", e); } catch (e2) {}
          }
          try {
            ctx.slots.inject("sidebar.session.row.leading", function () {
              return ctx.slots.register({
                name: "sidebar.session.row.leading",
                id: "dsh-notify-me-mute-mark",
                order: 20,
                locale: NS,
                inject: function () { return { t: t }; }
              }, function (ownerProps) {
                return React.createElement(SessionMuteMark, { sessionId: ownerProps.sessionId, t: t });
              });
            });
          } catch (e) {
            try { console.warn("[dsh-notify-me] row leading slot unavailable", e); } catch (e2) {}
          }
        }
      } catch (e) {
        try { console.error("[dsh-notify-me] settings page unavailable", e); } catch (e2) {}
      }
      ctx.effect(function () {
        var disposed = false;
        var unsubs = [];
        var retryTimer = null;
        try {
          var sessionsSvc = ctx.sessions;
          if (!sessionsSvc || !sessionsSvc.list || typeof sessionsSvc.list.subscribe !== "function") {
            try { console.log("[dsh-notify-me] sessions service unavailable — watchers idle"); } catch (e) {}
            return;
          }
          listStore = sessionsSvc.list;
          unsubs.push(sessionsSvc.list.subscribe(onListChanged));
          // A wait kept quiet because it was already on screen still has to
          // reach the user the moment they leave the page.
          var onVisibility = function () { try { flushQuieted(); } catch (e) {} };
          try { document.addEventListener("visibilitychange", onVisibility); } catch (e) {}
          unsubs.push(function () { try { document.removeEventListener("visibilitychange", onVisibility); } catch (e) {} });
          for (var ai = 0; ai < ACTIVITY_EVENTS.length; ai++) {
            try { window.addEventListener(ACTIVITY_EVENTS[ai], noteActivity, { passive: true, capture: true }); } catch (e) {}
          }
          unsubs.push(function () {
            for (var ai = 0; ai < ACTIVITY_EVENTS.length; ai++) {
              try { window.removeEventListener(ACTIVITY_EVENTS[ai], noteActivity, { capture: true }); } catch (e) {}
            }
          });
          // Same re-arm for the other half of "went away": losing window focus.
          try { window.addEventListener("focus", onPageFocus); } catch (e) {}
          try { window.addEventListener("blur", onPageBlur); } catch (e) {}
          unsubs.push(function () {
            try { window.removeEventListener("focus", onPageFocus); } catch (e) {}
            try { window.removeEventListener("blur", onPageBlur); } catch (e) {}
          });
          // Quick-decision bridge: register the worker half of this bundle (a
          // no-op where quickActions is off or a worker cannot run) and start
          // listening for toast-button relays.
          try { ensureActionBridge(); } catch (e) {}
          // Host-side fallback coordination: probe once and keep the page lease
          // alive while the host says it has a fallback to coordinate with. Its
          // disposer goes on the same list as the other listeners, so disabling
          // the plugin stops the probe and hands the lease back.
          unsubs.push(initHostBridge());
          // Interaction source first: it owns the title marker once present, so
          // binding it before the controller scan keeps a single mark per wait.
          bindUiSession();
          // initial scan (baseline only; no alerts for pre-existing sessions)
          onListChanged();
          // binding may resolve a tick later; re-check periodically while idle
          retryTimer = setInterval(function () {
            if (disposed) return;
            try { bindCurrentFace(); } catch (e) {}
            try { bindUiSession(); } catch (e) {}
          }, 1500);
          try { console.log("[dsh-notify-me] active — window.__dshNotifyMe 可配置提醒 (enabled=" + config.enabled + ", lang=" + effectiveLang() + ", sound=" + config.sound + ")"); } catch (e) {}
        } catch (e) {
          try { console.error("[dsh-notify-me] init failed", e); } catch (e2) {}
        }
        return function () {
          disposed = true;
          if (retryTimer) clearInterval(retryTimer);
          if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {} idleTimer = null; }
          for (var i = 0; i < unsubs.length; i++) { try { unsubs[i](); } catch (e) {} }
          detachFace();
          detachUiSession();
        };
      }, "dsh-notify-me: watchers");
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
      }
    });
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : null);
