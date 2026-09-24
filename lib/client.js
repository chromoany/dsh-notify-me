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
//       * "uiSession" -> pendingInteractions (a Map<sessionId, interaction>
//         snapshot whose values carry kind 'approval' | 'plan-review' |
//         'question'). Present since DSH 0.1.2-alpha.2; the controller
//         snapshots stopped carrying `pending` in the same release, so this is
//         the only live source of "the agent is waiting on you" on 0.1.2+.
//         It is resolved through ctx.get() — cordis throws on a plain
//         ctx.uiSession read for any name absent from the plugin's inject map;
//       * "sessions" -> the selected session's ConversationSnapshot (running)
//         and the session-list summaries of every other session (running /
//         completed), which carry the "reply finished" edge on every version;
//   - fires a Windows desktop Notification (+ optional sound) when the agent
//     needs the user's input — pending interaction kinds 'approval',
//     'plan-review' or 'question' — and when a reply/turn finishes;
//   - registers a "通知提醒 / Notify me" page into DSH Settings
//     (settings.section slot) exposing an on/off master switch, per-channel
//     toggles, volume and the notification language (follow-interface /
//     Simplified Chinese / English);
//   - preferences persist in localStorage (origin-scoped, like other
//     third-party client plugins) and are tweakable on window.__dshNotifyMe.

window.__ModuleLoader__.load({
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
      // toast + sound are only useful while the user is elsewhere; the tab
      // being hidden is the reliable "away" signal.
      attentionHiddenOnly: false, // needs-input alerts even while the page is visible
      // A wait inside the conversation already on screen needs no toast: the
      // approval card is right there, and a toast lands on top of it. Leaving
      // the page brings that alert back (see flushQuieted).
      currentHiddenOnly: true, // the visible session's own waits stay silent
      doneHiddenOnly: true, // reply-finished alerts only when the page is hidden
      toast: true,
      sound: true,
      volume: 0.5,
      autoFocus: true // clicking the toast focuses the DSH window
    };
    function readConfig() {
      var cfg = {};
      try {
        var raw = localStorage.getItem(LS_CONFIG);
        if (raw) cfg = JSON.parse(raw);
      } catch (e) { /* corrupt storage -> defaults */ }
      for (var k in DEFAULTS) if (!(k in cfg)) cfg[k] = DEFAULTS[k];
      return cfg;
    }
    function writeConfig(patch) {
      var cfg = readConfig();
      for (var k in patch) cfg[k] = patch[k];
      try { localStorage.setItem(LS_CONFIG, JSON.stringify(cfg)); } catch (e) {}
      return cfg;
    }
    var config = readConfig();
    // Persist a patch, swap the live module config and re-apply any active
    // title marker (its prefix follows the notification language).
    function setConfigLocal(patch) {
      config = writeConfig(patch);
      applyTitle();
      return config;
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
        sep: "：",
        testAttention: "这是一条测试提醒：DSH 需要你的操作",
        testDone: "测试提醒 · 回复完成示例"
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
        sep: ": ",
        testAttention: "This is a test alert: DSH is waiting for your input",
        testDone: "Test alert · reply-finished sample"
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
    function requestPermission() {
      if (!("Notification" in window) || permAsked) return;
      permAsked = true;
      try {
        if (Notification.permission === "default") {
          Notification.requestPermission().catch(function () {});
        }
      } catch (e) {}
    }
    function canToast() {
      return config.toast && "Notification" in window && Notification.permission === "granted";
    }
    function showToast(kind, title, body) {
      if (!canToast()) return;
      try {
        var n = new Notification(title, {
          body: body || "",
          tag: "dsh-notify-me-" + kind,
          renotify: true,
          icon: (location.origin || "") + "/favicon.svg"
        });
        if (config.autoFocus) {
          n.onclick = function () {
            try { window.focus(); } catch (e) {}
            n.close();
          };
        }
        setTimeout(function () { n.close(); }, 15000);
      } catch (e) {}
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
    function playAttentionSound() {
      if (!config.sound) return;
      unlockAudio();
      tone(880, 0.0, 140, config.volume);
      tone(1174, 0.16, 140, config.volume);
      tone(1568, 0.32, 200, config.volume);
    }
    function playDoneSound() {
      if (!config.sound) return;
      unlockAudio();
      tone(659, 0.0, 150, config.volume);
      tone(988, 0.18, 260, config.volume);
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

    // ────────────────────────── title marker ─────────────────────────
    // The host owns document.title (it tracks the session/workspace name), so
    // the base title is re-read on every apply instead of being frozen once —
    // and the exact string we last wrote is remembered, so the host taking the
    // title over (or an earlier load leaving a marker behind) can never make us
    // mistake our own marker for the base title.
    var attentionActive = 0;
    var hostBase = null; // document.title as the host last left it
    var writtenTitle = null; // exact string this plugin last put into document.title
    // Our own marker prefix never belongs to the base title — strip a leftover
    // one (an earlier load that was closed while a wait was pending, or a title
    // the host tracked while a marker was up) before storing the base.
    function cleanBase(t) {
      var d = texts();
      var prefixes = [d.marker, TXT.zh.marker, TXT.en.marker];
      for (var i = 0; i < prefixes.length; i++) {
        while (t.indexOf(prefixes[i]) === 0) t = t.slice(prefixes[i].length);
      }
      return t;
    }
    function applyTitle() {
      try {
        var current = String(document.title || "");
        if (current !== writtenTitle) hostBase = cleanBase(current);
        var next = (config.enabled && attentionActive > 0) ? texts().marker + hostBase : hostBase;
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
    function unmarkAttention(key) {
      delete quietedAttention[key]; // the wait is over; a queued alert dies with it
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

    function hidden() { return document.hidden || document.visibilityState === "hidden"; }

    // Deliver one alert regardless of visibility rules (used by the test
    // buttons); respects the master switch and permission state. The title
    // marker is NOT touched here — its ownership belongs to the watchers
    // (markAttention / unmarkAttention), which keeps the counter balanced.
    function deliver(kind, title, body) {
      if (!config.enabled) return;
      showToast(kind, title, body);
      if (kind === "attention") {
        playAttentionSound();
      } else {
        playDoneSound();
      }
      try {
        if (window.__dshNotifyMe && window.__dshNotifyMe.onEvent) {
          window.__dshNotifyMe.onEvent(kind, { title: title, body: body });
        }
      } catch (e) {}
    }
    function fire(kind, title, body, isCurrent) {
      if (!config.enabled) return false;
      if (kind === "attention" && config.attentionHiddenOnly && !hidden()) return false;
      // The wait belongs to the conversation the user is looking at right now:
      // the approval card is already on screen, so a toast would only cover the
      // thing it is asking about. The caller keeps the tab marker, and
      // flushQuieted() re-delivers the alert the moment the page is backgrounded.
      if (kind === "attention" && quietedByVisibleSession(isCurrent)) return false;
      if (kind === "done" && config.doneHiddenOnly && !hidden()) return false;
      deliver(kind, title, body);
      return true;
    }
    // True when this alert must stay silent purely because it is about the
    // session already on screen. Kept separate from fire() so the caller can
    // queue exactly this case and nothing else.
    function quietedByVisibleSession(isCurrent) {
      return !!(isCurrent && config.currentHiddenOnly && !hidden());
    }
    // Queued copies of the alerts that rule suppressed. Delivered by key so a
    // wait that got answered while the user was still on the page never fires.
    function queueQuieted(key, copy) {
      if (key && copy) quietedAttention[key] = copy;
    }
    function flushQuieted() {
      if (!config.enabled || !hidden()) return;
      var keys = Object.keys(quietedAttention);
      for (var i = 0; i < keys.length; i++) {
        var copy = quietedAttention[keys[i]];
        delete quietedAttention[keys[i]];
        fire("attention", copy.title, copy.body, false);
      }
    }
    // A display label for a session row ("current" maps to the localized
    // "当前对话 / Current conversation" placeholder).
    function sessionLabelText(row) {
      var raw = row && row.label;
      if (!raw || raw === "current") return texts().current;
      return raw;
    }
    // The session the user is looking at, or null while the list is not ready.
    function currentSessionId() {
      try {
        var st = listStore && listStore.getSnapshot();
        return (st && st.current) || null;
      } catch (e) { return null; }
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
          if (st.current === sid) return texts().current;
        }
      } catch (e) {}
      return sid;
    }
    // Returns null once the alert went out, or the copy it would have shown
    // when only the visible-session rule held it back — the caller queues that
    // copy by interaction key so it can still fire from the background.
    function fireAttention(kind, sessionLabel, detail, isCurrent) {
      var d = texts();
      var label = d.kind[kind] || d.kindDefault;
      var content = detail || d.bodyKind[kind] || d.bodyDefault;
      var who = sessionLabel || "";
      var title = "DSH · " + label;
      var body = (who ? who + d.sep : "") + content;
      if (quietedByVisibleSession(isCurrent)) return { title: title, body: body };
      fire("attention", title, body, isCurrent);
      return null;
    }
    function fireDone(sessionLabel, snippet) {
      var d = texts();
      var body = sessionLabel || d.doneBody;
      if (snippet) body = body + "\n" + snippet;
      fire("done", d.doneTitle, body);
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
    var faceSub = null; // current session face unsubscribe
    var currentFaceId = null;
    var listStore = null;
    var rootCtx = null; // client cordis context, captured at apply()
    // uiSession pending-interaction watcher (DSH >= 0.1.2-alpha.2)
    var uiPending = false; // true once the interaction snapshot is readable
    var uiSub = null;
    var uiStore = null; // the interaction store we hold a subscription on
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
    // Evaluate one row/face observation. row: {id, running, pending:[{key,kind,payload}], completed, label, face:bool}
    function evaluateRow(row) {
      var prev = prevById[row.id];
      var runningNow = !!row.running;
      var pendingNow = row.pending || [];
      var prevPendingKeys = prev ? prev.pendingKeys : [];
      var wasRunning = prev ? prev.running : false;
      var newKeys = [];
      for (var i = 0; i < pendingNow.length; i++) {
        var pk = pendingNow[i].key;
        if (prevPendingKeys.indexOf(pk) === -1 && !attentionKeysFired[pk]) {
          newKeys.push(pendingNow[i]);
          attentionKeysFired[pk] = true;
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
      if (newKeys.length > 0) {
        var it = newKeys[0];
        var copy = fireAttention(it.kind, sessionLabelText(row), textFromPayload(it.payload), !!row.face);
        if (copy) queueQuieted(it.key, copy);
        lastAttentionAt = Date.now();
        markAttention(it.key);
      }

      // 2) a non-selected session finished while we were away (sidebar "done")
      var notified = false;
      if (!row.face && row.completed && prev && !prev.completed && prev.seeded) {
        fireDone(sessionLabelText(row), "");
        notified = true;
      }

      // 3) running true -> false on a session we were watching: a reply finished
      if (!notified && prev && prev.seeded && wasRunning && !runningNow && !hasPendingNow) {
        // ignore the edge if it happened in the same tick as an attention alert
        if (Date.now() - lastAttentionAt < 300) {
          /* answered by an attention alert above */
        } else {
          fireDone(sessionLabelText(row), row.face ? snippetOfLastAssistant(row.faceSnap) : "");
        }
      }

      // store the next baseline
      prevById[row.id] = {
        running: runningNow,
        pendingKeys: pendingNow.map(function (p) { return p.key; }),
        completed: !!row.completed,
        seeded: true
      };

      // a wait we alerted about has been resolved -> drop the title marker
      if (!uiPending && prev && prevPendingKeys.length > 0 && pendingNow.length === 0) {
        for (var r = 0; r < prevPendingKeys.length; r++) unmarkAttention(prevPendingKeys[r]);
      }
    }

    // face -> row adapter (selected session, rich data)
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
        label: "current"
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
        label: sum.displayTitle || sum.title || sid
      });
    }

    // ─────────────────────── subscription wiring ─────────────────────
    function bindCurrentFace() {
      if (!listStore) return;
      try {
        var st = listStore.getSnapshot();
        var cur = st && st.current;
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
        var cur = st && st.current;
        bindCurrentFace();
        bindUiSession();
        var byId = (st && st.byId) || {};
        for (var sid in byId) {
          if (sid === cur) continue; // current handled by the face watcher
          var sum = byId[sid];
          if (!sum) continue;
          evalListRow(sid, sum, cur);
        }
        // sessions that vanished: keep baseline (they may reappear) - no action.
      } catch (e) {}
    }

    // ─────────────── uiSession pending-interaction watcher ───────────
    // DSH >= 0.1.2-alpha.2 moved pending interactions out of the Controller
    // snapshots into their own store (uiSession.pendingInteractions), a
    // Map<sessionId, interaction> whose values carry kind + key + sessionId and
    // the domain's own detail fields. It is the only live "the agent is waiting
    // on you" source on those hosts.
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
    // Did some entry on this host ever provide the service? Separates the
    // normal "older host has no interaction store" case (stay silent, the
    // controller path still works there) from "provided but unreachable",
    // which is a real defect and deserves one console warning.
    function serviceWasProvided(name) {
      try {
        var props = rootCtx && rootCtx.reflect && rootCtx.reflect.props;
        return !!(props && props[name]);
      } catch (e) { return false; }
    }
    function noteUiBind(note) {
      if (uiBindNote === note) return;
      uiBindNote = note;
      if (note === "bound" || uiWarned || !serviceWasProvided("uiSession")) return;
      uiWarned = true;
      try {
        console.warn("[dsh-notify-me] uiSession is provided but not reachable (" + note + ") — approval alerts fall back to the legacy controller path, which stopped reporting pending interactions in DSH 0.1.2+");
      } catch (e) {}
    }
    function bindUiSession() {
      var svc = lookupService("uiSession");
      var store = svc && svc.pendingInteractions;
      if (!store || typeof store.getSnapshot !== "function" || typeof store.subscribe !== "function") {
        noteUiBind(svc ? "uiSession has no pendingInteractions store" : "uiSession not visible");
        return;
      }
      if (uiSub && uiStore === store) { noteUiBind("bound"); return; }
      // the service instance was swapped (plugin HMR): drop the stale
      // subscription and its marks, then bind the live store
      if (uiSub) detachUiSession();
      uiStore = store;
      uiPending = true; // this watcher now owns the title marker
      uiSub = store.subscribe(function () { try { evalUiPending(); } catch (e) {} });
      noteUiBind("bound");
      evalUiPending(); // seed: a wait that predates this plugin still alerts once
    }
    function evalUiPending() {
      var svc = lookupService("uiSession");
      var store = svc && svc.pendingInteractions;
      if (!store || typeof store.getSnapshot !== "function") return;
      var snap = store.getSnapshot(); // Map<sessionId, interaction>
      if (!snap || typeof snap.forEach !== "function") return;
      var seen = Object.create(null);
      snap.forEach(function (it, sid) {
        if (!it) return;
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
        var copy = fireAttention(it.kind, labelForSessionId(sid), textFromPayload(it), currentSessionId() === sid);
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
    function detachUiSession() {
      if (uiSub) { try { uiSub(); } catch (e) {} uiSub = null; }
      uiStore = null;
      // drop every mark this watcher holds; hosts without the interaction store
      // go back to the controller marker path
      for (var s in uiBaseline) unmarkAttention(uiBaseline[s].key);
      uiBaseline = Object.create(null);
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
    api.version = "1.1.7";
    api.setConfig = function (patch) { return setConfigLocal(patch); };
    api.resetConfig = function () {
      try { localStorage.removeItem(LS_CONFIG); } catch (e) {}
      config = readConfig();
      return config;
    };
    // manual test; run it after clicking anywhere so permission can be granted.
    // Test alerts fire regardless of the page-open visibility rules.
    api.test = function (kind) {
      kind = kind === "attention" ? "attention" : "done";
      unlockOnce();
      testAlert(kind);
      return "sent " + kind + " (lang=" + effectiveLang() + ", permission=" + ("Notification" in window ? Notification.permission : "n/a") + ")";
    };
    // Live diagnostics for the "why did nothing pop" case. The needs-input
    // channel has two possible owners on current hosts (uiSession on 0.1.2+,
    // the controller snapshots before that) and both used to fail silently, so
    // the binding state has to be readable from the page itself.
    api.debug = function () {
      return {
        version: api.version,
        enabled: config.enabled,
        language: effectiveLang(),
        attentionHiddenOnly: config.attentionHiddenOnly,
        currentHiddenOnly: config.currentHiddenOnly,
        doneHiddenOnly: config.doneHiddenOnly,
        toast: config.toast,
        sound: config.sound,
        permission: ("Notification" in window) ? Notification.permission : "n/a",
        visibility: hidden() ? "hidden" : "visible",
        uiSession: uiPending ? "bound" : "unbound",
        uiSessionNote: uiBindNote,
        sessionBaselines: Object.keys(prevById).length,
        pendingBaselines: Object.keys(uiBaseline).length,
        firedKeys: Object.keys(attentionKeysFired),
        markedKeys: Object.keys(attentionKeysMarked),
        quietedKeys: Object.keys(quietedAttention),
        lastAttentionAt: lastAttentionAt ? new Date(lastAttentionAt).toISOString() : null
      };
    };
    window.__dshNotifyMe = api;

    // ────────────────── Settings page (react only, optional) ─────────
    // Registered when the web profile provides react + slots + locale; the
    // reminder core above never depends on any of it.
    var NS = "dsh-notify-me";
    var UI_zh = {
      nav: "通知提醒",
      blurb: "当模型停下来需要你操作（审批 / 方案待确认 / 提问），或回复在后台完成时，用系统通知、提示音和标签页标题提醒你。",
      enable: "启用提醒",
      enableHint: "总开关：关闭后不再弹系统通知、不播放提示音，也不再改动标签页标题。",
      toast: "系统通知",
      toastHint: "经浏览器弹出系统 Toast（Windows 通知中心）；需要已授予通知权限。",
      sound: "提示音",
      soundHint: "WebAudio 合成音，「需要你」与「回复完成」使用不同音型。",
      attentionVisible: "页面打开时也提醒「需要你」",
      attentionVisibleHint: "默认开启：模型在等你审批 / 确认方案 / 回答问题（含提问弹窗）时，即使页面在最前也会提醒。",
      currentQuiet: "当前对话不弹通知",
      currentQuietHint: "默认开启：等待就发生在你正看着的这个对话里时，只留标签页标记，不弹系统通知、不响提示音，免得挡住审批卡片；页面切到后台后照常提醒。",
      doneVisible: "页面打开时也提醒「回复完成」",
      doneVisibleHint: "默认关闭：「完成」只在页面隐藏或切到后台时才提醒，避免打扰。",
      autoFocus: "点击通知把 DSH 切回前台",
      volume: "音量",
      language: "通知语言",
      langAuto: "跟随界面",
      langZh: "简体中文",
      langEn: "English",
      langAutoNote: "（跟随界面）",
      current: "界面当前语言",
      testTitle: "快速测试",
      testHint: "用当前设置各发一条测试提醒（不受上面「页面打开时也提醒」开关限制）。",
      testAttention: "测试「需要你」",
      testDone: "测试「回复完成」",
      reset: "恢复默认设置",
      resetDone: "已恢复默认设置。",
      sent: "已发送测试提醒 · 通知语言：",
      permHint: "通知权限尚未授予：先在页面上点击一次并允许通知，系统通知才能弹出（提示音不受影响）。",
      offHint: "已关闭提醒：先打开「启用提醒」再测试。"
    };
    var UI_en = {
      nav: "Notify me",
      blurb: "When the agent stops and needs your input (approval / plan review / question) or a reply finishes in the background, get a system notification, a sound, and a tab-title marker.",
      enable: "Enable reminders",
      enableHint: "Master switch: when off, no toasts, no sounds, and the tab title is never modified.",
      toast: "System notifications",
      toastHint: "Native toasts via the browser (Windows notification center); requires notification permission.",
      sound: "Sound",
      soundHint: "WebAudio beeps — \"needs you\" and \"reply finished\" use different patterns.",
      attentionVisible: "Also alert \"needs you\" while the page is open",
      attentionVisibleHint: "On by default: alert even in the foreground when the model waits for approval / plan review / a question.",
      currentQuiet: "Stay quiet for the conversation on screen",
      currentQuietHint: "On by default: a wait inside the conversation you are looking at keeps only the tab marker — no toast or sound landing on the approval card. Backgrounding the page puts the alert back.",
      doneVisible: "Also alert \"reply finished\" while the page is open",
      doneVisibleHint: "Off by default: \"done\" only alerts while the page is hidden or backgrounded, to avoid noise.",
      autoFocus: "Click a toast to focus the DSH window",
      volume: "Volume",
      language: "Notification language",
      langAuto: "Follow the interface",
      langZh: "简体中文",
      langEn: "English",
      langAutoNote: " (follows the interface)",
      current: "Current interface language",
      testTitle: "Quick test",
      testHint: "Send one test alert with the current settings (not limited by the \"while the page is open\" toggles above).",
      testAttention: "Test \"needs you\"",
      testDone: "Test \"reply finished\"",
      reset: "Restore defaults",
      resetDone: "Defaults restored.",
      sent: "Test alert sent · notification language: ",
      permHint: "Notification permission is not granted yet — click once on the page and allow notifications so toasts can appear (sound is unaffected).",
      offHint: "Reminders are off: enable them first, then test."
    };
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
      ".dnm-range{width:150px;accent-color:var(--dsw-alias-state-business-primary,#3b82f6)}" +
      ".dnm-select{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));color:var(--dsw-alias-label-primary,rgba(20,20,20,.9));border-radius:8px;padding:5px 8px;font-size:13px;font-family:inherit}" +
      ".dnm-btn{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;color:var(--dsw-alias-label-primary,rgba(20,20,20,.9));border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer;font-family:inherit}" +
      ".dnm-btn:hover{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.1))}" +
      ".dnm-btn[disabled]{opacity:.45;cursor:default}" +
      ".dnm-btnRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
      ".dnm-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9))}" +
      ".dnm-feedback{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(120,120,120,.9));min-height:18px}";
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

    function rowSwitch(key, labelText, hintText, checked, onChange) {
      return h("div", { className: "dnm-row" }, [
        h("div", { className: "dnm-rowText" }, [
          h("div", { className: "dnm-rowLabel" }, labelText),
          hintText ? h("div", { className: "dnm-rowHint" }, hintText) : null
        ]),
        h("button", {
          type: "button",
          role: "switch",
          "aria-checked": checked ? "true" : "false",
          className: "dnm-switch" + (checked ? " on" : ""),
          onClick: function () { onChange(!checked); }
        }, h("span", { className: "dnm-knob" }))
      ]);
    }
    function card(children) {
      return h("div", { className: "dnm-card" }, children);
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
      function patch(p) {
        setCfg(setConfigLocal(p));
      }
      function runTest(kind) {
        if (!config.enabled) { setFeedback(t("offHint")); return; }
        unlockOnce();
        // Bypasses the visibility rules on purpose: a test must fire while the
        // page is open, otherwise the button proves nothing.
        testAlert(kind);
        var langName = effectiveLang() === "en" ? t("langEn") : t("langZh");
        setFeedback(t("sent") + langName);
      }
      var permOK = ("Notification" in window) ? Notification.permission === "granted" : false;
      var resolvedLang = effectiveLang();
      var resolvedLangName = resolvedLang === "en" ? t("langEn") : t("langZh");
      return h("div", { className: "dnm-wrap" }, [
        h("p", { className: "dnm-blurb" }, t("blurb")),
        card([
          rowSwitch("enabled", t("enable"), t("enableHint"), cfg.enabled, function (v) {
            patch({ enabled: v });
            if (!v && attentionActive > 0) { attentionActive = 0; applyTitle(); }
          })
        ]),
        card([
          rowSwitch("toast", t("toast"), t("toastHint"), cfg.toast, function (v) { patch({ toast: v }); }),
          rowSwitch("sound", t("sound"), t("soundHint"), cfg.sound, function (v) { patch({ sound: v }); }),
          rowSwitch("attentionVisible", t("attentionVisible"), t("attentionVisibleHint"), !cfg.attentionHiddenOnly, function (v) { patch({ attentionHiddenOnly: !v }); }),
          rowSwitch("currentQuiet", t("currentQuiet"), t("currentQuietHint"), cfg.currentHiddenOnly, function (v) { patch({ currentHiddenOnly: v }); }),
          rowSwitch("doneVisible", t("doneVisible"), t("doneVisibleHint"), !cfg.doneHiddenOnly, function (v) { patch({ doneHiddenOnly: !v }); }),
          rowSwitch("autoFocus", t("autoFocus"), null, cfg.autoFocus, function (v) { patch({ autoFocus: v }); }),
          h("div", { className: "dnm-row" }, [
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
        ]),
        card([
          h("div", { className: "dnm-row" }, [
            h("div", { className: "dnm-rowText" }, [
              h("div", { className: "dnm-rowLabel" }, t("language")),
              h("div", { className: "dnm-rowHint" }, resolvedLangName + (cfg.language === "auto" ? t("langAutoNote") : ""))
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
          h("div", { className: "dnm-row" }, [
            h("div", { className: "dnm-rowText" }, [
              h("div", { className: "dnm-rowLabel" }, t("testTitle")),
              h("div", { className: "dnm-rowHint" }, t("testHint"))
            ]),
            h("div", { className: "dnm-btnRow" }, [
              h("button", { type: "button", className: "dnm-btn", disabled: !cfg.enabled, onClick: function () { runTest("attention"); } }, t("testAttention")),
              h("button", { type: "button", className: "dnm-btn", disabled: !cfg.enabled, onClick: function () { runTest("done"); } }, t("testDone"))
            ])
          ]),
          h("div", { className: "dnm-row" }, [
            h("div", { className: "dnm-rowText" }, [
              h("div", { className: "dnm-rowLabel" }, t("reset")),
              h("div", { className: "dnm-rowHint" }, " ")
            ]),
            h("button", { type: "button", className: "dnm-btn", onClick: function () {
              try { localStorage.removeItem(LS_CONFIG); } catch (e) {}
              config = readConfig();
              applyTitle();
              setCfg(config);
              setFeedback(t("resetDone"));
            } }, t("reset"))
          ]),
          !permOK ? h("div", { className: "dnm-row" }, [
            h("div", { className: "dnm-rowText" }, [h("div", { className: "dnm-rowHint" }, t("permHint"))])
          ]) : null
        ]),
        h("p", { className: "dnm-feedback" }, feedback)
      ]);
    }

    // ────────────────────────── plugin body ──────────────────────────
    // Hard service requirements only. `uiSession` is deliberately NOT listed:
    // a cordis inject entry is a hard gate (the entry stays pending while the
    // service is missing, and the web boot audit fails on entries that never
    // activate), while hosts older than 0.1.2-alpha.2 have no uiSession at all.
    // It is therefore looked up lazily in bindUiSession(), with the controller
    // path above as the fallback. The bundle entry
    // "@deepseek-ai/dsh-client-ui-session" stays in package.json's
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
          ctx.effect(function () {
            ctx.locale.register(NS, { zh: UI_zh, en: UI_en });
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
          try { console.log("[dsh-notify-me] active — window.__dshNotifyMe 可配置提醒 (enabled=" + config.enabled + ", lang=" + effectiveLang() + ", toast=" + config.toast + ", sound=" + config.sound + ")"); } catch (e) {}
        } catch (e) {
          try { console.error("[dsh-notify-me] init failed", e); } catch (e2) {}
        }
        return function () {
          disposed = true;
          if (retryTimer) clearInterval(retryTimer);
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
