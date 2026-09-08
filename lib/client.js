// dsh-notify-me — browser half (client plugin bundle).
//
// Loaded by dsh-client-modules at /plugins/dsh-notify-me/client.js and
// executed through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS with
// require() resolved against the shell's module table — the same shape the
// shipped ui-* packages' tsdown bundles emit.
//
// What this plugin does (all client-side, no settings transport needed):
//   - watches the "sessions" service (SessionRuntime): the selected
//     session's ConversationSnapshot (running / pending interactions) and the
//     session-list summaries of every other session;
//   - fires a Windows desktop Notification (+ optional sound) when the agent
//     needs the user's input — pending interaction kinds 'approval',
//     'plan-review' or 'question' — and when a reply/turn finishes;
//   - preferences persist in localStorage (origin-scoped, like other
//     third-party client plugins) and are tweakable on window.__dshNotifyMe.

window.__ModuleLoader__.load({
  id: "dsh-notify-me",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // ───────────────────────── configuration ─────────────────────────
    var LS_CONFIG = "dshNotifyMe.config";
    var DEFAULTS = {
      // toast + sound are only useful while the user is elsewhere; the tab
      // being hidden is the reliable "away" signal.
      attentionHiddenOnly: false, // needs-input alerts even while the page is visible
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
    var originalTitle = null;
    var attentionActive = 0;
    function applyTitle() {
      try {
        if (originalTitle === null) originalTitle = document.title;
        document.title = attentionActive > 0 ? "🔔 需要你 · " + originalTitle : originalTitle;
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

    // ─────────────────────── shared alert core ───────────────────────
    var attentionKeysFired = Object.create(null); // dedupe per pending key
    var lastAttentionAt = 0;

    function hidden() { return document.hidden || document.visibilityState === "hidden"; }

    function fire(kind, title, body) {
      if (kind === "attention" && config.attentionHiddenOnly && !hidden()) return;
      if (kind === "done" && config.doneHiddenOnly && !hidden()) return;
      showToast(kind, title, body);
      if (kind === "attention") {
        playAttentionSound();
        acquireTitleMark();
      } else {
        playDoneSound();
      }
      try {
        if (window.__dshNotifyMe && window.__dshNotifyMe.onEvent) {
          window.__dshNotifyMe.onEvent(kind, { title: title, body: body });
        }
      } catch (e) {}
    }
    function fireAttention(kind, sessionLabel, detail) {
      var label = { approval: "审批请求", "plan-review": "方案待确认", question: "提问" }[kind] || "需要操作";
      var d = detail || "";
      fire("attention", "DSH · " + label, (sessionLabel ? sessionLabel + "：" : "") + d);
    }
    function fireDone(sessionLabel, snippet) {
      var body = sessionLabel ? sessionLabel : "回复已完成";
      if (snippet) body = body + "\n" + snippet;
      fire("done", "DSH · 回复完成", body);
    }

    // ───────────────────────── state machine ─────────────────────────
    // prevById: per-session-id baseline of what we have already reported.
    //   { running: bool, pendingKeys: string[] , doneArmed: bool, seeded: bool }
    var prevById = Object.create(null);
    var faceSub = null; // current session face unsubscribe
    var currentFaceId = null;
    var listStore = null;
    var rootCtx = null; // client cordis context, captured at apply()

    function textFromPayload(payload) {
      if (!payload || typeof payload !== "object") return "";
      var keys = ["text", "question", "prompt", "title", "summary", "description", "message", "operation", "name", "tool"];
      for (var i = 0; i < keys.length; i++) {
        var v = payload[keys[i]];
        if (typeof v === "string" && v.trim()) return v.length > 160 ? v.slice(0, 160) + "…" : v;
        if (typeof v === "object" && v !== null && typeof v.text === "string" && v.text.trim()) {
          var s = v.text;
          return s.length > 160 ? s.slice(0, 160) + "…" : s;
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
      if (newKeys.length > 0) {
        var it = newKeys[0];
        var detail = textFromPayload(it.payload);
        if (!detail) detail = { approval: "有审批待处理", "plan-review": "方案待确认", question: "有提问待回答" }[it.kind] || "需要你操作";
        var label = row.label && row.label !== "current" ? row.label : "当前对话";
        fireAttention(it.kind, label, detail);
        lastAttentionAt = Date.now();
      }

      // 2) a non-selected session finished while we were away (sidebar "done")
      var notified = false;
      if (!row.face && row.completed && prev && !prev.completed && prev.seeded) {
        fireDone(row.label || "后台会话", "");
        notified = true;
      }

      // 3) running true -> false on a session we were watching: a reply finished
      if (!notified && prev && prev.seeded && wasRunning && !runningNow && !hasPendingNow) {
        // ignore the edge if it happened in the same tick as an attention alert
        if (Date.now() - lastAttentionAt < 300) {
          /* answered by an attention alert above */
        } else {
          fireDone(row.label && row.label !== "current" ? row.label : "当前对话", row.face ? snippetOfLastAssistant(row.faceSnap) : "");
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
      if (prev && prevPendingKeys.length > 0 && pendingNow.length === 0) {
        releaseTitleMark();
      }
    }

    // face -> row adapter (selected session, rich data)
    function evalSessionFace(sessionId, snap) {
      if (sessionId !== currentFaceId) return;
      var pend = (snap.pending || []).map(function (p) {
        return { key: p.key || (p.kind + ":" + sessionId), kind: p.kind, payload: p.payload || null };
      });
      var label = "current";
      evaluateRow({
        id: sessionId,
        running: !!snap.running,
        pending: pend,
        completed: false,
        face: true,
        faceSnap: snap,
        label: label
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

    // ──────────────────────── global control API ─────────────────────
    var api = {
      version: "0.1.0",
      get config() { return readConfig(); },
      setConfig: function (patch) { config = writeConfig(patch); return config; },
      resetConfig: function () {
        try { localStorage.removeItem(LS_CONFIG); } catch (e) {}
        config = readConfig();
        return config;
      },
      // manual test; run it after clicking anywhere so permission can be granted.
      test: function (kind) {
        kind = kind === "attention" ? "attention" : "done";
        unlockOnce();
        if (kind === "attention") fireAttention("question", "测试", "这是一条测试提醒：DSH 需要你的操作");
        else fireDone("测试提醒", "");
        return "sent " + kind + " (permission=" + ("Notification" in window ? Notification.permission : "n/a") + ")";
      }
    };
    window.__dshNotifyMe = api;

    // ────────────────────────── plugin body ──────────────────────────
    var inject = ["sessions"];

    /**
     * Client plugin body: watch the sessions service and raise desktop
     * notifications + sounds when the agent needs input or a reply finishes.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      rootCtx = ctx;
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
          // initial scan (baseline only; no alerts for pre-existing state)
          onListChanged();
          // binding may resolve a tick later; re-check periodically while idle
          retryTimer = setInterval(function () {
            if (disposed) return;
            try { bindCurrentFace(); } catch (e) {}
          }, 1500);
          console.log("[dsh-notify-me] active — window.__dshNotifyMe 可配置提醒 (toast=" + config.toast + ", sound=" + config.sound + ")");
        } catch (e) {
          try { console.error("[dsh-notify-me] init failed", e); } catch (e2) {}
        }
        return function () {
          disposed = true;
          if (retryTimer) clearInterval(retryTimer);
          for (var i = 0; i < unsubs.length; i++) { try { unsubs[i](); } catch (e) {} }
          detachFace();
        };
      }, "dsh-notify-me: watchers");
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
