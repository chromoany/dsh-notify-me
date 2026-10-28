// Offline smoke test for dsh-notify-me/lib/client.js
// Runs the plugin bundle inside a mocked browser-ish environment and drives
// fake host state, asserting the alert machinery fires without throwing and
// produces the expected title/onEvent changes.
//
// Three hosts are exercised, because pending interactions changed owners twice:
//   * legacy  — DSH <= 0.1.1-rc.2: no `uiSession` service; the controller's
//               session snapshot carries `pending: [{key,kind,payload}]`.
//   * current — DSH 0.1.2-alpha.2 .. 0.1.5-rc.3: those snapshots no longer carry
//               `pending`; interactions live in ctx.uiSession.pendingInteractions
//               (a Map<sessionId, interaction>).
//   * modern  — DSH >= 0.1.6-alpha.2 (incl. 0.2.0-rc.2): that store is gone,
//               replaced by ctx.uiSession.sessionStatus
//               (a Map<sessionId, {running, pendingInteraction, completionUnread}>);
//               the list snapshot also stops carrying `current`, so the
//               on-screen session is the row with retainedBy.mainView > 0.
// The reply-finished channel (running/completed) is host-independent;
// completionUnreadChannel() covers its 0.1.6+ level flag (sessionStatus rows'
// `completionUnread`, 1.5.0): one report per unread instance, the "完成未读"
// title marker, and the dedupe against the running edge when both views of one
// completion arrive.
// subagentSessions() covers the background-subagent mute and its one exception —
// the subagent session the user has open (1.4.0).
// quickActionsHost() additionally runs the bundle's Service Worker half in a
// worker-shaped context and drives a toast button press end to end (approval
// quick decisions, 1.3.0+).
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

// Boot the bundle over a mocked window/document and return the handles the
// tests drive: the module exports, the exposed window API, and the stubs.
function bootBundle(opts) {
  let title = 'DeepSeek Harness';
  const listeners = { pointerdown: [], keydown: [] };
  const captured = {};
  // A granted-permission Notification stand-in so a test can grab the toast the
  // plugin raised and click it the way Windows would.
  let lastNotification = null;
  class FakeNotification {
    constructor(title, config) { this.title = title; this.config = config; this.closed = false; lastNotification = this; }
    close() { this.closed = true; }
  }
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = () => Promise.resolve('granted');
  const Notify = (opts && opts.withNotification) ? FakeNotification : undefined;

  const windowStub = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      const arr = listeners[type] || [];
      const i = arr.indexOf(fn); if (i !== -1) arr.splice(i, 1);
    },
    focus() {},
    __ModuleLoader__: { load(reg) { captured.reg = reg; } },
    __dshNotifyMe: undefined,
    AudioContext: undefined,
    webkitAudioContext: undefined,
  };
  // Only present when the test asked for it: an own `Notification` key holding
  // undefined would make `"Notification" in window` true while the global stays
  // undefined — exactly the shape that used to break canToast().
  if (Notify) windowStub.Notification = Notify;
  const docListeners = { visibilitychange: [] };
  const documentStub = {
    hidden: false,
    visibilityState: 'visible',
    get title() { return title; },
    set title(v) { title = v; },
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      const arr = docListeners[type] || [];
      const i = arr.indexOf(fn); if (i !== -1) arr.splice(i, 1);
    },
  };
  const storage = {};
  const sandbox = {
    window: windowStub,
    document: documentStub,
    location: { origin: 'http://127.0.0.1:3080' },
    Notification: Notify,
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
    },
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Symbol, Object, JSON, Date, Math, Array, String, Number,
  };
  vm.createContext(sandbox);
  // Test-specific environment extras (service-worker bridge stubs, __DSH_BOOT__,
  // a shared BroadcastChannel hub) go in before the bundle evaluates.
  if (opts && typeof opts.extend === 'function') opts.extend(sandbox, windowStub);
  vm.runInContext(SRC, sandbox, { filename: 'client.js' });
  if (!captured.reg) throw new Error('plugin did not register via __ModuleLoader__.load');
  if (captured.reg.id !== 'dsh-notify-me') throw new Error('unexpected id ' + captured.reg.id);

  // The alert sink is installed before apply() on purpose: binding an
  // interaction store can alert synchronously for a wait that already exists.
  const events = [];
  windowStub.__dshNotifyMe = { onEvent: (kind, payload) => events.push({ kind, ...payload }) };

  return {
    // require("react") resolves to {} by default, which is exactly the
    // no-settings-page environment the reminder core must survive; a case that
    // wants the Settings page renders it by supplying opts.require instead.
    mod: captured.reg.factory((name) => ((opts && opts.require) ? opts.require(name) : {})),
    win: windowStub,
    doc: documentStub,
    events,
    getTitle: () => title,
    lastNotification: () => lastNotification,
    // Drive a real visibilitychange the way the browser would.
    fireVisibility: () => { for (const fn of [...docListeners.visibilitychange]) fn(); },
    // The pagehide / pageshow listeners (the lease's release and its
    // back/forward-cache restore), handed out so a case can drive both.
    pagehideListeners: () => [...(listeners.pagehide || [])],
    firePageShow: (persisted) => {
      for (const fn of [...(listeners.pageshow || [])]) fn({ type: 'pageshow', persisted: !!persisted });
    },
    // Drive a real window focus/blur: a desktop window can sit behind another
    // app while document.visibilityState still reads "visible".
    setWindowFocus: (focused) => {
      for (const fn of [...(listeners[focused ? 'focus' : 'blur'] || [])]) fn();
    },
    hasFocusListener: () => (listeners.focus || []).length > 0 && (listeners.blur || []).length > 0,
  };
}

// The reminder core needs `sessions` + `effect`; `uiSession` is optional and
// only present on its host generation. Both are built from plain objects so the
// test can move the host state one notification at a time.
//   withUiSession    — 0.1.2 .. 0.1.5 host: uiSession.pendingInteractions
//   withSessionStatus— 0.1.6+/0.2 host: uiSession.sessionStatus only, and the
//                      sessions service has no open() (navigation moved to
//                      uiWorkspace.openSession, offered by withWorkspace)
function buildHost({ withUiSession, withSessionStatus, withWorkspace }) {
  const listeners = { list: [], face: [], uiPending: [], status: [] };
  let listState = { ids: [], byId: {}, current: 's1', phase: 'ready' };
  let faceSnap = { sessionId: 's1', running: false, pending: [], nodes: [], partial: null };
  let uiSnapshot = new Map();
  let statusSnapshot = new Map();
  const cleanups = [];
  const opened = []; // sessions the plugin asked the host to select

  const sessionsFake = {
    list: {
      getSnapshot: () => listState,
      subscribe: (fn) => { listeners.list.push(fn); return () => { listeners.list = listeners.list.filter((f) => f !== fn); }; },
    },
    binding: () => ({
      session: {
        subscribe: (fn) => { listeners.face.push(fn); return () => { listeners.face = listeners.face.filter((f) => f !== fn); }; },
        getSnapshot: () => faceSnap,
      },
    }),
  };
  // 0.1.6+ removed sessions.open(id); only the pre-0.1.6 generation has it.
  if (!withSessionStatus) sessionsFake.open = (id) => { opened.push(id); };

  const ctx = {
    sessions: sessionsFake,
    effect: (fn) => { const r = fn(); if (typeof r === 'function') cleanups.push(r); },
  };
  if (withUiSession) {
    ctx.uiSession = {
      pendingInteractions: {
        getSnapshot: () => uiSnapshot,
        subscribe: (fn) => { listeners.uiPending.push(fn); return () => { listeners.uiPending = listeners.uiPending.filter((f) => f !== fn); }; },
      },
    };
  }
  if (withSessionStatus) {
    // 0.2.0-rc.2 shape: sessionStatus only; pendingInteractions is gone.
    ctx.uiSession = {
      sessionStatus: {
        getSnapshot: () => statusSnapshot,
        subscribe: (fn) => { listeners.status.push(fn); return () => { listeners.status = listeners.status.filter((f) => f !== fn); }; },
      },
    };
  }
  if (withWorkspace) {
    ctx.uiWorkspace = { openSession: (id) => { opened.push(id); } };
  }

  return {
    ctx,
    listeners,
    cleanups,
    opened,
    setList: (v) => { listState = v; },
    setFace: (v) => { faceSnap = v; },
    faceSnap: () => faceSnap,
    setUiPending: (map) => { uiSnapshot = map; },
    setStatus: (map) => { statusSnapshot = map; },
    notifyList: () => { for (const l of [...listeners.list]) l(); },
    notifyFace: () => { for (const l of [...listeners.face]) l(); },
    notifyUi: () => { for (const l of [...listeners.uiPending]) l(); },
    notifyStatus: () => { for (const l of [...listeners.status]) l(); },
  };
}

// One sessionStatus row, shaped like the shipped 0.1.6+/0.2 SessionStatus.
function statusRow(pendingInteraction, extra) {
  return Object.assign({ running: true, pendingInteraction: pendingInteraction || null, completionUnread: false }, extra || {});
}

// Interaction objects shaped like the shipped 0.1.2+ classes.
function approval(key, extra) {
  return Object.assign({ key, kind: 'approval', sessionId: 's1', toolName: 'pwsh', reason: 'needs elevated shell' }, extra || {});
}
function question(key, extra) {
  return Object.assign({ key, kind: 'question', sessionId: 's1', questions: [{ id: 'q1', question: '继续吗？', options: [] }] }, extra || {});
}
function planReview(key, extra) {
  return Object.assign({ key, kind: 'plan-review', sessionId: 's1', questions: [{ id: 'q1', question: '执行这个方案？', detail: '第一步…', intent: { kind: 'plan-review' } }] }, extra || {});
}

async function legacyHost() {
  console.log('\n— legacy host (no uiSession: controller snapshot carries pending) —');
  const b = bootBundle();
  const host = buildHost({ withUiSession: false });
  host.setFace({ sessionId: 's1', running: false, pending: [], nodes: [], partial: null });
  const { mod, win, doc, events, getTitle } = b;

  assert(Array.isArray(mod.inject) && typeof mod.apply === 'function', 'export shape');
  assert(mod.inject.indexOf('uiSession') === -1,
    'uiSession must NOT be a hard inject entry (a missing service would leave the entry pending and fail the web boot audit)');
  console.log('export shape OK: inject=', JSON.stringify(mod.inject));

  mod.apply(host.ctx);
  assert(typeof win.__dshNotifyMe === 'object', 'global api exposed');
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  assert(win.__dshNotifyMe.version === PKG_VERSION,
    'window.__dshNotifyMe.version (' + win.__dshNotifyMe.version + ') != package.json version (' + PKG_VERSION + ')');
  console.log('version OK:', PKG_VERSION);

  // 1) running -> idle while hidden fires "done" with the assistant snippet
  doc.hidden = true; doc.visibilityState = 'hidden';
  assert(host.listeners.face.length === 1 && host.listeners.list.length === 1, 'face + list subscribed');
  host.setFace({ ...host.faceSnap(), running: true });
  host.notifyFace();
  host.setFace({ ...host.faceSnap(), running: false, nodes: [
    { kind: 'user', seq: 1, content: [] },
    { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: '你好，我是 DSH' }] },
  ] });
  host.notifyFace();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'done fired for running->idle');
  assert(events[0].body.indexOf('你好') !== -1, 'done carries last-assistant snippet');
  assert(getTitle().indexOf('需要你') === -1, 'no attention marker for done');

  // 2) a pending question on the selected session alerts once + marks the tab
  events.length = 0;
  host.setFace({ ...host.faceSnap(), running: true, pending: [{ key: 'q:abc', kind: 'question', sessionId: 's1', payload: { questions: [{ text: '要不要继续？' }] } }] });
  host.notifyFace();
  assert(events.filter((e) => e.kind === 'attention').length === 1, 'attention fired on question');
  assert(getTitle().indexOf('需要你') !== -1, 'title marker set on attention');
  events.length = 0;
  host.notifyFace();
  assert(events.length === 0, 'no duplicate alert for the same pending key');

  // 3) pending resolves; the turn later completes -> marker drops, done fires
  await sleep(400);
  host.setFace({ ...host.faceSnap(), pending: [], running: true });
  host.notifyFace();
  assert(getTitle().indexOf('需要你') === -1, 'title marker cleared when pending resolved');
  events.length = 0;
  host.setFace({ ...host.faceSnap(), running: false });
  host.notifyFace();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'done fired after pending settled');

  // 4) background session completion via list row (completed edge)
  await sleep(400);
  host.setList({ ids: ['bg1'], byId: { bg1: { running: true, displayTitle: '后台任务', completed: false } }, current: 's1', phase: 'ready' });
  host.notifyList();
  events.length = 0;
  host.setList({ ids: ['bg1'], byId: { bg1: { running: false, displayTitle: '后台任务', completed: true } }, current: 's1', phase: 'ready' });
  host.notifyList();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'background session completion alerted');
  assert(getTitle().indexOf('✅') !== -1, 'the row.completed reminder bit marks the tab');

  // 5) doneHiddenOnly default suppresses "done" while the page is visible
  events.length = 0;
  doc.hidden = false; doc.visibilityState = 'visible';
  await sleep(400);
  host.setList({ ids: ['bg1'], byId: { bg1: { running: true, displayTitle: 'x', completed: false } }, current: 's1', phase: 'ready' });
  host.notifyList();
  assert(getTitle().indexOf('✅') === -1, 're-running the session releases the unread mark');
  host.setList({ ids: ['bg1'], byId: { bg1: { running: false, displayTitle: 'x', completed: true } }, current: 's1', phase: 'ready' });
  host.notifyList();
  assert(events.length === 0, 'done suppressed while page visible (doneHiddenOnly default)');

  // 6) config round trip; visible "done" once doneHiddenOnly=false
  const cfg = win.__dshNotifyMe.setConfig({ doneHiddenOnly: false, sound: false });
  assert(cfg.doneHiddenOnly === false, 'setConfig persisted');
  await sleep(400);
  host.setList({ ids: ['bg1'], byId: { bg1: { running: true, displayTitle: 'x', completed: false } }, current: 's1', phase: 'ready' });
  host.notifyList();
  host.setList({ ids: ['bg1'], byId: { bg1: { running: false, displayTitle: 'x', completed: true } }, current: 's1', phase: 'ready' });
  host.notifyList();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'done fires when doneHiddenOnly=false even visible');

  // 7) defaults + reset
  const d = win.__dshNotifyMe.config;
  assert(d.enabled === true && d.language === 'auto', 'default enabled/language');
  const back = win.__dshNotifyMe.setConfig({ enabled: false, language: 'en' });
  assert(back.enabled === false && back.language === 'en', 'enabled/language settable via setConfig');
  const restored = win.__dshNotifyMe.resetConfig();
  assert(restored.enabled === true && restored.language === 'auto', 'resetConfig restores defaults');

  // 8) English pinned copy + marker
  win.__dshNotifyMe.setConfig({ language: 'en', doneHiddenOnly: false, sound: false });
  doc.hidden = true; doc.visibilityState = 'hidden';
  events.length = 0;
  host.setFace({ ...host.faceSnap(), running: true, pending: [{ key: 'q:en1', kind: 'question', sessionId: 's1', payload: null }] });
  host.notifyFace();
  const att = events.filter((e) => e.kind === 'attention');
  assert(att.length === 1, 'attention fired with language=en');
  assert(att[0].title === 'DSH · Question', 'en attention title');
  assert(att[0].body.indexOf('Current conversation') !== -1, 'en attention body');
  assert(getTitle().indexOf('Action needed') !== -1 && getTitle().indexOf('需要你') === -1, 'en title marker');
  events.length = 0;
  await sleep(400);
  host.setFace({ ...host.faceSnap(), pending: [], running: true });
  host.notifyFace();
  assert(getTitle().indexOf('Action needed') === -1, 'en marker cleared');
  doc.hidden = true; doc.visibilityState = 'hidden';
  host.setFace({ ...host.faceSnap(), running: false, nodes: [], partial: null });
  host.notifyFace();
  const dn = events.filter((e) => e.kind === 'done');
  assert(dn.length === 1 && dn[0].title === 'DSH · Reply finished', 'en done title');
  doc.hidden = false; doc.visibilityState = 'visible';

  // 9) master switch off silences everything
  win.__dshNotifyMe.setConfig({ enabled: false, language: 'zh' });
  events.length = 0;
  host.setFace({ ...host.faceSnap(), running: true, pending: [{ key: 'q:off1', kind: 'approval', sessionId: 's1', payload: null }] });
  host.notifyFace();
  assert(events.length === 0, 'no alert while master switch is off');
  assert(getTitle().indexOf('需要你') === -1, 'no marker while master switch is off');
  host.setFace({ ...host.faceSnap(), pending: [] });
  host.notifyFace();
  const armed = win.__dshNotifyMe.setConfig({ enabled: true, doneHiddenOnly: true, sound: false });
  assert(armed.enabled === true, 'master switch can be re-enabled');

  // 10) test buttons ignore the visibility rules
  doc.hidden = false; doc.visibilityState = 'visible';
  events.length = 0;
  const doneStatus = win.__dshNotifyMe.test('done');
  assert(events.filter((e) => e.kind === 'done').length === 1, 'test "done" fires while page visible');
  assert(getTitle().indexOf('需要你') === -1, 'done test leaves no attention marker');
  assert(typeof doneStatus === 'string' && doneStatus.indexOf('sent done') === 0, 'test returns a status string');
  events.length = 0;
  win.__dshNotifyMe.test('attention');
  assert(events.filter((e) => e.kind === 'attention').length === 1, 'test "attention" fires while page visible');
  assert(getTitle().indexOf('需要你') !== -1, 'attention test sets the marker');

  // 11) the unread mark dies with the reminder bit the host drops on select
  //     (its completedNotifications are cleared the moment a session opens)
  host.setList({ ids: ['bg1'], byId: { bg1: { running: false, displayTitle: '后台任务', completed: true } }, current: 's1', phase: 'ready' });
  host.notifyList();
  assert(getTitle().indexOf('✅') !== -1, 'the finished row still holds the unread mark');
  host.setList({ ids: ['bg1'], byId: { bg1: { running: false, displayTitle: '后台任务', completed: true, retainedBy: { mainView: 1 } } }, phase: 'ready' });
  host.notifyList();
  assert(getTitle().indexOf('✅') === -1, 'selecting the session releases the mark');

  // cleanup must unsubscribe
  for (const c of [...host.cleanups]) c();
  assert(host.listeners.list.length === 0, 'list unsubscribed after dispose');
  assert(host.listeners.face.length === 0, 'face unsubscribed after dispose');
}

async function currentHost() {
  console.log('\n— current host (0.1.2+: uiSession.pendingInteractions) —');
  const b = bootBundle();
  // The snapshot Map must exist before the plugin applies: the shipped
  // uiSession service builds its store in the constructor, before any consumer
  // can register an interaction.
  const host = buildHost({ withUiSession: true });
  host.setUiPending(new Map());
  let face = { sessionId: 's1', running: true, nodes: [], partial: null };
  const setFace = (patch) => { face = { ...face, ...patch }; host.setFace(face); };
  const postPending = (key, kind, payload) => setFace({ pending: [{ key, kind, sessionId: 's1', payload: payload || null }] });
  const clearPending = () => setFace({ pending: [] });
  const { mod, win, doc, events, getTitle } = b;

  mod.apply(host.ctx);
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  assert(host.listeners.uiPending.length === 1, 'pendingInteractions subscribed');
  assert(host.listeners.face.length === 1 && host.listeners.list.length === 1, 'controller watchers still bound');
  doc.hidden = true; doc.visibilityState = 'hidden';

  // 1) an approval appears -> attention, once, with the tool detail
  host.setUiPending(new Map([['s1', approval('approval:1')]]));
  host.notifyUi();
  let att = events.filter((e) => e.kind === 'attention');
  assert(att.length === 1, 'attention fired for a new approval');
  assert(att[0].title === 'DSH · 审批请求', 'approval kind mapped to zh copy, got ' + att[0].title);
  assert(att[0].body.indexOf('pwsh') !== -1 && att[0].body.indexOf('needs elevated shell') !== -1,
    'approval body carries toolName + reason, got ' + att[0].body);
  assert(getTitle().indexOf('需要你') !== -1, 'title marker set on approval');

  // 2) repeated notifications for the same interaction do not re-alert
  events.length = 0;
  host.notifyUi();
  host.notifyUi();
  assert(events.length === 0, 'no duplicate alert for the same interaction key');
  assert(getTitle().indexOf('需要你') !== -1, 'marker stays while the wait is open');

  // 3) the wait is answered -> marker released
  events.length = 0;
  host.setUiPending(new Map());
  host.notifyUi();
  assert(getTitle().indexOf('需要你') === -1, 'title marker cleared when the interaction disappears');

  // 4) question + plan-review map to their own copy; the batch text is used
  host.setUiPending(new Map([['s1', question('question:7')]]));
  host.notifyUi();
  att = events.filter((e) => e.kind === 'attention');
  assert(att.length === 1 && att[0].title === 'DSH · 提问', 'question kind copy');
  assert(att[0].body.indexOf('继续吗？') !== -1, 'question body carries the question text, got ' + att[0].body);
  events.length = 0;
  host.setUiPending(new Map([['s1', planReview('question:8')]]));
  host.notifyUi();
  att = events.filter((e) => e.kind === 'attention');
  assert(att.length === 1 && att[0].title === 'DSH · 方案待确认', 'plan-review kind copy');
  assert(getTitle().indexOf('需要你') !== -1, 'marker set for plan review');

  // 5) a wait in a background session is labelled with its sidebar title
  events.length = 0;
  host.setList({ ids: ['s2'], byId: { s2: { running: true, displayTitle: '后台任务', completed: false } }, current: 's1', phase: 'ready' });
  host.setUiPending(new Map([['s2', question('question:9', { sessionId: 's2' })]]));
  host.notifyUi();
  att = events.filter((e) => e.kind === 'attention');
  assert(att.length === 1, 'background session wait alerted');
  assert(att[0].body.indexOf('后台任务') !== -1, 'background wait carries the session title, got ' + att[0].body);

  // 6) several waits in different sessions: one mark each, released per wait
  events.length = 0;
  host.setList({ ids: ['s2', 's3'], byId: {
    s2: { running: true, displayTitle: '后台任务', completed: false },
    s3: { running: true, displayTitle: '第三个会话', completed: false },
  }, current: 's1', phase: 'ready' });
  host.setUiPending(new Map([
    ['s2', question('question:10', { sessionId: 's2' })],
    ['s3', approval('approval:11', { sessionId: 's3' })],
  ]));
  host.notifyUi();
  assert(events.filter((e) => e.kind === 'attention').length === 2, 'two concurrent waits alert once each');
  events.length = 0;
  host.setUiPending(new Map([['s2', question('question:10', { sessionId: 's2' })]]));
  host.notifyUi();
  assert(events.length === 0, 'a surviving wait does not re-alert');
  assert(getTitle().indexOf('需要你') !== -1, 'marker survives while one wait remains');
  host.setUiPending(new Map());
  host.notifyUi();
  assert(getTitle().indexOf('需要你') === -1, 'all waits gone -> marker cleared');

  // 7) a wait that already existed before the plugin attached still alerts once
  //    (fresh boot: the interaction is registered before the plugin applies)
  const late = bootBundle();
  const lateHost = buildHost({ withUiSession: true });
  lateHost.setUiPending(new Map([['s1', approval('approval:20')]]));
  late.doc.hidden = true; late.doc.visibilityState = 'hidden';
  late.mod.apply(lateHost.ctx); // alerts synchronously for the pre-existing wait
  const seeded = late.events.filter((e) => e.kind === 'attention');
  assert(seeded.length === 1, 'pre-existing wait alerts once on bind, got ' + seeded.length);
  assert(late.getTitle().indexOf('需要你') !== -1, 'pre-existing wait marks the tab');
  late.events.length = 0;
  lateHost.setUiPending(new Map());
  lateHost.notifyUi();
  assert(late.getTitle().indexOf('需要你') === -1, 'pre-existing wait releases its mark');
  for (const c of [...lateHost.cleanups]) c();

  // 8) a wait reported through uiSession is not re-alerted by the controller
  //    path (belt and braces for hosts that carry both sources)
  events.length = 0;
  host.setUiPending(new Map([['s1', approval('approval:30')]]));
  host.notifyUi();
  assert(events.filter((e) => e.kind === 'attention').length === 1, 'approval 30 alerted once');
  events.length = 0;
  postPending('approval:30', 'approval');
  host.notifyFace();
  assert(events.filter((e) => e.kind === 'attention').length === 0,
    'the controller path does not re-alert a wait already reported through uiSession');
  clearPending();
  host.notifyFace();
  events.length = 0;
  host.setUiPending(new Map());
  host.notifyUi();
  assert(getTitle().indexOf('需要你') === -1, 'marker cleared exactly once for the shared wait');

  // 9) the reply-finished channel still works on this host (the 300ms
  //    attention->done cooldown is a deliberate "same tick" guard, so give it
  //    room — in the real host these edges are seconds apart)
  await sleep(400);
  doc.hidden = true; doc.visibilityState = 'hidden';
  host.setList({ ids: [], byId: {}, current: 's1', phase: 'ready' });
  setFace({ running: true, nodes: [] });
  host.notifyFace();
  events.length = 0;
  setFace({ running: false, nodes: [{ kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: '做完了' }] }] });
  host.notifyFace();
  const done = events.filter((e) => e.kind === 'done');
  assert(done.length === 1 && done[0].body.indexOf('做完了') !== -1,
    'reply-finished still fires on the current host, got ' + JSON.stringify(done));

  // 10) master switch off silences the interaction channel too
  win.__dshNotifyMe.setConfig({ enabled: false, language: 'zh' });
  events.length = 0;
  host.setUiPending(new Map([['s1', approval('approval:12')]]));
  host.notifyUi();
  assert(events.length === 0, 'no alert while master switch is off');

  // 11) a wait in the conversation already on screen stays silent while it is
  //     on screen, and still reaches the user once the page is backgrounded
  doc.hidden = false; doc.visibilityState = 'visible';
  win.__dshNotifyMe.setConfig({ currentHiddenOnly: true, sound: false, language: 'zh', enabled: true });
  host.setList({ ids: ['s1'], byId: { s1: { running: true, displayTitle: '当前会话', completed: false } }, current: 's1', phase: 'ready' });
  events.length = 0;
  host.setUiPending(new Map([['s1', approval('approval:40')]]));
  host.notifyUi();
  assert(events.length === 0, 'a wait in the conversation on screen stays silent');
  assert(getTitle().indexOf('需要你') !== -1, 'the silent wait still marks the tab');
  assert(win.__dshNotifyMe.debug().quietedKeys.indexOf('approval:40') !== -1,
    'the silent wait is queued for the background');
  doc.hidden = true; doc.visibilityState = 'hidden';
  b.fireVisibility();
  const flushed = events.filter((e) => e.kind === 'attention');
  assert(flushed.length === 1 && flushed[0].title === 'DSH · 审批请求',
    'the queued wait is delivered once the page is backgrounded, got ' + JSON.stringify(flushed));

  // 12) a background session still alerts while the page is visible
  doc.hidden = false; doc.visibilityState = 'visible';
  events.length = 0;
  host.setList({ ids: ['s2'], byId: { s2: { running: true, displayTitle: '后台任务', completed: false } }, current: 's1', phase: 'ready' });
  host.setUiPending(new Map([['s2', approval('approval:41', { sessionId: 's2' })]]));
  host.notifyUi();
  assert(events.filter((e) => e.kind === 'attention').length === 1,
    'a background session still alerts while the page is visible');

  // 13) a wait answered while still on screen is never delivered later
  doc.hidden = false; doc.visibilityState = 'visible';
  events.length = 0;
  host.setList({ ids: ['s1'], byId: { s1: { running: true, displayTitle: '当前会话', completed: false } }, current: 's1', phase: 'ready' });
  host.setUiPending(new Map([['s1', approval('approval:42')]]));
  host.notifyUi();
  assert(events.length === 0, 'an on-screen wait is silent again');
  host.setUiPending(new Map());
  host.notifyUi();
  doc.hidden = true; doc.visibilityState = 'hidden';
  b.fireVisibility();
  assert(events.length === 0, 'a wait answered on screen is not delivered later');

  // 14) clicking a toast opens the conversation the alert belongs to
  const nb = bootBundle({ withNotification: true });
  const nhost = buildHost({ withUiSession: true });
  nhost.setUiPending(new Map());
  nb.doc.hidden = true; nb.doc.visibilityState = 'hidden';
  nb.mod.apply(nhost.ctx);
  nhost.setList({ ids: ['s2'], byId: { s2: { running: true, displayTitle: '后台任务', completed: false } }, current: 's1', phase: 'ready' });
  nhost.setUiPending(new Map([['s2', approval('approval:50', { sessionId: 's2' })]]));
  nhost.notifyUi();
  const toast = nb.lastNotification();
  assert(toast && toast.title === 'DSH · 审批请求', 'a toast was raised for the background wait');
  toast.onclick();
  assert(nhost.opened.length === 1 && nhost.opened[0] === 's2',
    'clicking the toast opens the alerted session, got ' + JSON.stringify(nhost.opened));

  // a session that already left the list must never be opened (open() fails loud)
  nhost.setList({ ids: [], byId: {}, current: 's1', phase: 'ready' });
  nhost.setUiPending(new Map([['s9', approval('approval:51', { sessionId: 's9' })]]));
  nhost.notifyUi();
  const goneToast = nb.lastNotification();
  assert(goneToast !== toast, 'a second toast was raised for the vanished session');
  goneToast.onclick();
  assert(nhost.opened.length === 1, 'a session missing from the list is never opened');
  for (const c of [...nhost.cleanups]) c();

  for (const c of [...host.cleanups]) c();
  assert(host.listeners.uiPending.length === 0, 'pendingInteractions unsubscribed after dispose');
}

async function modernHost() {
  console.log('\n— modern host (0.1.6+/0.2: uiSession.sessionStatus, no list.current/open) —');
  const b = bootBundle();
  const host = buildHost({ withSessionStatus: true, withWorkspace: true });
  const { mod, win, doc, events, getTitle } = b;
  // A 0.2.0-rc.2 list snapshot: no `current`, rows carry retainedBy instead.
  const cur = { running: true, displayTitle: '当前会话', retainedBy: { mainView: 1 } };
  const bg = (title) => ({ running: true, displayTitle: title, retainedBy: {} });

  mod.apply(host.ctx);
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  assert(host.listeners.status.length === 1,
    'sessionStatus subscribed (the 0.1.2-0.1.5 pendingInteractions store is gone on this host)');
  const bound = win.__dshNotifyMe.debug();
  assert(bound.uiSession === 'bound', 'watcher bound, got ' + JSON.stringify(bound));
  assert(bound.uiSessionSource === 'sessionStatus', 'debug reports the sessionStatus source, got ' + bound.uiSessionSource);

  // 1) the on-screen session comes from retainedBy.mainView when `current` is gone
  host.setList({ ids: ['s1'], byId: { s1: cur }, phase: 'ready' });
  host.notifyList();
  assert(win.__dshNotifyMe.debug().currentSession === 's1',
    'currentSession derived from retainedBy.mainView, got ' + win.__dshNotifyMe.debug().currentSession);
  host.setFace({ sessionId: 's1', running: true, nodes: [], partial: null });
  host.notifyFace();
  assert(host.listeners.face.length === 1, 'face watcher bound to the mainView session');

  // 2) an approval surfaces through sessionStatus.pendingInteraction
  doc.hidden = true; doc.visibilityState = 'hidden';
  host.setStatus(new Map([['s1', statusRow(approval('approval:101'))]]));
  host.notifyStatus();
  let att = events.filter((e) => e.kind === 'attention');
  assert(att.length === 1, 'attention fired for a new approval, got ' + att.length);
  assert(att[0].title === 'DSH · 审批请求', 'approval copy, got ' + att[0].title);
  assert(att[0].body.indexOf('pwsh') !== -1 && att[0].body.indexOf('needs elevated shell') !== -1,
    'approval body carries toolName + reason, got ' + att[0].body);
  assert(getTitle().indexOf('需要你') !== -1, 'title marker set on approval');

  // 3) the same status republished does not re-alert
  events.length = 0;
  host.notifyStatus();
  assert(events.length === 0, 'no duplicate alert for the same interaction key');

  // 4) the wait is answered (status keeps the session, drops the interaction)
  host.setStatus(new Map([['s1', statusRow(null)]]));
  host.notifyStatus();
  assert(getTitle().indexOf('需要你') === -1,
    'title marker released when pendingInteraction disappears from the status row');

  // 5) a background session's wait is labelled from its list row
  events.length = 0;
  host.setList({ ids: ['s2'], byId: { s2: bg('后台任务') }, phase: 'ready' });
  host.notifyList();
  host.setStatus(new Map([
    ['s1', statusRow(null)],
    ['s2', statusRow(question('question:12', { sessionId: 's2' }))],
  ]));
  host.notifyStatus();
  att = events.filter((e) => e.kind === 'attention');
  assert(att.length === 1, 'background wait alerted, got ' + att.length);
  assert(att[0].body.indexOf('后台任务') !== -1, 'background wait carries the session title, got ' + att[0].body);
  assert(att[0].title === 'DSH · 提问', 'question copy, got ' + att[0].title);

  // 6) a wait inside the on-screen conversation stays silent and is delivered
  //    on background, using the retainedBy-derived current session
  doc.hidden = false; doc.visibilityState = 'visible';
  events.length = 0;
  host.setList({ ids: ['s1'], byId: { s1: cur }, phase: 'ready' });
  host.notifyList();
  host.setStatus(new Map([['s1', statusRow(approval('approval:102'))]]));
  host.notifyStatus();
  assert(events.length === 0, 'an on-screen wait stays silent while the page is visible');
  assert(getTitle().indexOf('需要你') !== -1, 'the silent wait still marks the tab');
  assert(win.__dshNotifyMe.debug().quietedKeys.indexOf('approval:102') !== -1,
    'the on-screen wait is queued for the background');
  doc.hidden = true; doc.visibilityState = 'hidden';
  b.fireVisibility();
  const flushed = events.filter((e) => e.kind === 'attention');
  assert(flushed.length === 1 && flushed[0].title === 'DSH · 审批请求',
    'the queued wait is delivered once the page is backgrounded, got ' + JSON.stringify(flushed));

  // 7) a background wait still alerts while the page is visible
  doc.hidden = false; doc.visibilityState = 'visible';
  events.length = 0;
  host.setStatus(new Map([
    ['s1', statusRow(null)],
    ['s2', statusRow(approval('approval:103', { sessionId: 's2' }))],
  ]));
  host.notifyStatus();
  assert(events.filter((e) => e.kind === 'attention').length === 1,
    'a background session still alerts while the page is visible');

  // 8) the reply-finished channel on the face snapshot (0.2.0-rc.2 no longer
  //    carries nodes, so the toast body has no assistant snippet) — and it names
  //    the on-screen session from its list row instead of the old placeholder
  await sleep(400);
  doc.hidden = true; doc.visibilityState = 'hidden';
  events.length = 0;
  host.setStatus(new Map([['s1', statusRow(null)]]));
  host.notifyStatus();
  host.setList({ ids: ['s1'], byId: { s1: cur }, phase: 'ready' });
  host.notifyList();
  host.setFace({ sessionId: 's1', running: true, nodes: [] });
  host.notifyFace();
  events.length = 0;
  host.setFace({ sessionId: 's1', running: false, nodes: [] });
  host.notifyFace();
  const done = events.filter((e) => e.kind === 'done');
  assert(done.length === 1, 'reply-finished fires on the current host, got ' + JSON.stringify(done));
  assert(done[0].body === '当前会话', 'the reply-finished body carries the list title (issue #20), got ' + JSON.stringify(done[0].body));

  // 9) master switch off silences the interaction channel too
  win.__dshNotifyMe.setConfig({ enabled: false, language: 'zh' });
  events.length = 0;
  host.setStatus(new Map([['s1', statusRow(approval('approval:104'))]]));
  host.notifyStatus();
  assert(events.length === 0, 'no alert while master switch is off');
  win.__dshNotifyMe.setConfig({ enabled: true, sound: false });

  // 10) clicking a toast navigates through uiWorkspace.openSession (this host
  //     has no sessions.open at all), and a session that left the list is
  //     never opened
  const nb = bootBundle({ withNotification: true });
  const nhost = buildHost({ withSessionStatus: true, withWorkspace: true });
  nb.doc.hidden = true; nb.doc.visibilityState = 'hidden';
  nb.mod.apply(nhost.ctx);
  nhost.setList({ ids: ['s2'], byId: { s2: bg('后台任务') }, phase: 'ready' });
  nhost.notifyList();
  nhost.setStatus(new Map([['s2', statusRow(approval('approval:105', { sessionId: 's2' }))]]));
  nhost.notifyStatus();
  const toast = nb.lastNotification();
  assert(toast && toast.title === 'DSH · 审批请求', 'a toast was raised for the background wait');
  toast.onclick();
  assert(nhost.opened.length === 1 && nhost.opened[0] === 's2',
    'clicking the toast ran uiWorkspace.openSession for the alerted session, got ' + JSON.stringify(nhost.opened));
  nhost.setList({ ids: [], byId: {}, phase: 'ready' });
  nhost.notifyList();
  nhost.setStatus(new Map([['s9', statusRow(approval('approval:106', { sessionId: 's9' }))]]));
  nhost.notifyStatus();
  const goneToast = nb.lastNotification();
  assert(goneToast !== toast, 'a second toast was raised for the vanished session');
  goneToast.onclick();
  assert(nhost.opened.length === 1, 'a session missing from the list is never opened');
  for (const c of [...nhost.cleanups]) c();

  // 11) the plan-review copy and its question text survive the sessionStatus
  //     migration (same claim as the older generations, this store shape only)
  events.length = 0;
  host.setStatus(new Map([
    ['s1', statusRow(null)],
    ['s2', statusRow(planReview('plan-review:107', { sessionId: 's2' }))],
  ]));
  host.notifyStatus();
  const planAtt = events.filter((e) => e.kind === 'attention');
  assert(planAtt.length === 1 && planAtt[0].title === 'DSH · 方案待确认',
    'plan-review copy on the sessionStatus host, got ' + JSON.stringify(planAtt));
  assert(planAtt[0].body.indexOf('执行这个方案？') !== -1,
    'plan-review body carries the question text, got ' + planAtt[0].body);
  assert(getTitle().indexOf('需要你') !== -1, 'plan-review marks the tab');
  events.length = 0;
  host.setStatus(new Map([['s1', statusRow(null)], ['s2', statusRow(null)]]));
  host.notifyStatus();
  assert(getTitle().indexOf('需要你') === -1, 'plan-review mark released after the answer');

  // 12) a wait registered before the plugin attached still alerts once here
  //     (fresh boot: the status row exists before apply runs)
  const late = bootBundle();
  const lateHost = buildHost({ withSessionStatus: true, withWorkspace: true });
  lateHost.setStatus(new Map([['s1', statusRow(approval('approval:108'))]]));
  late.doc.hidden = true; late.doc.visibilityState = 'hidden';
  late.mod.apply(lateHost.ctx); // alerts synchronously for the pre-existing wait
  const seeded = late.events.filter((e) => e.kind === 'attention');
  assert(seeded.length === 1, 'pre-existing sessionStatus wait alerts once on bind, got ' + seeded.length);
  assert(late.getTitle().indexOf('需要你') !== -1, 'pre-existing wait marks the tab');
  late.events.length = 0;
  lateHost.setStatus(new Map([['s1', statusRow(null)]]));
  lateHost.notifyStatus();
  assert(late.getTitle().indexOf('需要你') === -1, 'pre-existing wait releases its mark');
  for (const c of [...lateHost.cleanups]) c();

  // 13) a replacement interaction in the same session swaps the mark instead of
  //     stacking a second one that nothing can release
  events.length = 0;
  host.setStatus(new Map([['s1', statusRow(approval('approval:109'))]]));
  host.notifyStatus();
  assert(events.filter((e) => e.kind === 'attention').length === 1, 'first wait alerted');
  events.length = 0;
  host.setStatus(new Map([['s1', statusRow(question('question:110'))]]));
  host.notifyStatus();
  assert(events.filter((e) => e.kind === 'attention').length === 1,
    'the replacement alerted under its new key');
  assert(getTitle().indexOf('需要你') !== -1, 'the replacement keeps the tab marked');
  host.setStatus(new Map([['s1', statusRow(null)]]));
  host.notifyStatus();
  assert(getTitle().indexOf('需要你') === -1,
    'answering the replacement clears the mark — the replaced key left nothing behind');

  for (const c of [...host.cleanups]) c();
  assert(host.listeners.status.length === 0, 'sessionStatus unsubscribed after dispose');
  assert(host.listeners.face.length === 0, 'face unsubscribed after dispose');
}

// ────────── the on-screen session's alert names the conversation (1.14.3) ──────────
// issue #20: a notification about the conversation already on screen started with
// the localized "当前对话 / Current conversation" placeholder while every other row
// carried its sidebar title. The face adapter now reads the title off the same
// list row the sidebar draws; the placeholder only stands in for a session the
// list cannot title yet.
async function currentSessionTitle() {
  console.log('\n— the on-screen session is labelled with its own title (issue #20) —');
  const title = '重构通知中心';
  const b = bootBundle();
  const host = buildHost({ withSessionStatus: true, withWorkspace: true });
  const { mod, win, doc, events } = b;
  mod.apply(host.ctx);
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  doc.hidden = true; doc.visibilityState = 'hidden';
  host.setList({ ids: ['s1'], byId: { s1: { running: true, displayTitle: title, retainedBy: { mainView: 1 } } }, phase: 'ready' });
  host.notifyList();
  host.setFace({ sessionId: 's1', running: true, nodes: [], pending: [] });
  host.notifyFace();

  // 1) a wait: the body leads with the conversation title, not the placeholder
  events.length = 0;
  host.setFace({ sessionId: 's1', running: true, nodes: [], pending: [{ key: 'question:201', kind: 'question', sessionId: 's1', payload: null }] });
  host.notifyFace();
  const att = events.filter((e) => e.kind === 'attention');
  assert(att.length === 1, 'the on-screen wait alerted, got ' + JSON.stringify(events));
  assert(att[0].body.indexOf(title) === 0, 'the body leads with the session title, got ' + JSON.stringify(att[0].body));
  assert(att[0].body.indexOf('当前对话') === -1, 'the placeholder is gone, got ' + JSON.stringify(att[0].body));

  // 2) "reply finished" carries the same label
  events.length = 0;
  await sleep(400); // outside the attention -> done same-tick guard
  host.setFace({ sessionId: 's1', running: false, nodes: [], pending: [] });
  host.notifyFace();
  const done = events.filter((e) => e.kind === 'done');
  assert(done.length === 1 && done[0].body === title,
    'the reply-finished body is the session title, got ' + JSON.stringify(done));
  for (const c of [...host.cleanups]) c();

  // 3) a session the list cannot title yet keeps the placeholder as the fallback
  const fb = bootBundle();
  const fhost = buildHost({ withSessionStatus: true, withWorkspace: true });
  fb.mod.apply(fhost.ctx);
  fb.win.__dshNotifyMe.onEvent = (kind, payload) => fb.events.push({ kind, ...payload });
  fb.doc.hidden = true; fb.doc.visibilityState = 'hidden';
  fhost.setList({ ids: ['s2'], byId: { s2: { running: true, retainedBy: { mainView: 1 } } }, phase: 'ready' });
  fhost.notifyList();
  fhost.setFace({ sessionId: 's2', running: true, nodes: [], pending: [] });
  fhost.notifyFace();
  fhost.setFace({ sessionId: 's2', running: false, nodes: [], pending: [] });
  fhost.notifyFace();
  const fbDone = fb.events.filter((e) => e.kind === 'done');
  assert(fbDone.length === 1 && fbDone[0].body === '当前对话',
    'an untitled session falls back to the placeholder, got ' + JSON.stringify(fbDone));
  for (const c of [...fhost.cleanups]) c();
}

// ────────── completion-unread level flag (0.1.6+, 1.5.0) ──────────
// sessionStatus rows carry {running, pendingInteraction, completionUnread}:
// the flag lights when a background session finishes and clears when the
// session is opened / re-runs / disappears. It owns the "✅ 回复完成" title
// marker and reports completions whose running edge this page never saw
// (coalesced snapshots, a remount mid-turn, a completion predating the bind);
// reportDone's short window collapses the double view when both arrive.
async function completionUnreadChannel() {
  console.log('\n— completionUnread: finished-but-unread channel + tab marker —');
  const b = bootBundle();
  const host = buildHost({ withSessionStatus: true, withWorkspace: true });
  const { mod, win, doc, events, getTitle } = b;
  const cur = { running: false, displayTitle: '当前会话', retainedBy: { mainView: 1 } };
  const bg = (title, extra) => Object.assign({ running: false, displayTitle: title, retainedBy: {} }, extra || {});

  mod.apply(host.ctx);
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  host.setList({ ids: ['s1', 's2'], byId: { s1: cur, s2: bg('后台任务') }, phase: 'ready' });
  host.notifyList();
  doc.hidden = true; doc.visibilityState = 'hidden';

  // 1) a completion whose running edge never reached this page: the level flag
  //    reports it once and marks the tab
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['s2', statusRow(null, { running: false, completionUnread: true })],
  ]));
  host.notifyStatus();
  let done = events.filter((e) => e.kind === 'done');
  assert(done.length === 1, 'completionUnread reports a completion the edge never saw, got ' + JSON.stringify(done));
  assert(done[0].body === '后台任务', 'the report carries the session title, got ' + JSON.stringify(done[0].body));
  assert(getTitle().indexOf('✅') !== -1, 'the unread completion marks the tab');
  assert(win.__dshNotifyMe.debug().doneUnreadMarked.indexOf('s2') !== -1, 'debug() reports the unread mark');

  // 2) the latch: the same unread never re-alerts; opening the session (the
  //    host clears the flag) releases the mark
  events.length = 0;
  host.notifyStatus();
  host.notifyStatus();
  assert(events.length === 0, 'a republished unread does not re-alert');
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['s2', statusRow(null, { running: false, completionUnread: false })],
  ]));
  host.notifyStatus();
  assert(getTitle().indexOf('✅') === -1, 'opening the session releases the unread mark');

  // 3) both views of one completion (running edge + level flag) in one tick
  //    collapse into a single alert
  await sleep(400);
  host.setList({ ids: ['s1', 's2'], byId: { s1: cur, s2: bg('后台任务', { running: true }) }, phase: 'ready' });
  host.notifyList();
  events.length = 0;
  host.setList({ ids: ['s1', 's2'], byId: { s1: cur, s2: bg('后台任务', { running: false }) }, phase: 'ready' });
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['s2', statusRow(null, { running: false, completionUnread: true })],
  ]));
  host.notifyList();
  host.notifyStatus();
  done = events.filter((e) => e.kind === 'done');
  assert(done.length === 1, 'the edge and the level flag of one completion alert once, got ' + JSON.stringify(done));

  // 4) a pre-existing unread at bind reports once (remount mid-completion)
  const late = bootBundle();
  const lateHost = buildHost({ withSessionStatus: true, withWorkspace: true });
  lateHost.setList({ ids: ['s1', 's2'], byId: { s1: cur, s2: bg('后台任务') }, phase: 'ready' });
  lateHost.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['s2', statusRow(null, { running: false, completionUnread: true })],
  ]));
  late.doc.hidden = true; late.doc.visibilityState = 'hidden';
  late.mod.apply(lateHost.ctx); // reports synchronously for the pre-existing unread
  const seeded = late.events.filter((e) => e.kind === 'done');
  assert(seeded.length === 1, 'a pre-existing unread alerts once on bind, got ' + seeded.length);
  assert(late.getTitle().indexOf('✅') !== -1, 'the pre-existing unread marks the tab');
  late.events.length = 0;
  lateHost.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['s2', statusRow(null, { running: false, completionUnread: false })],
  ]));
  lateHost.notifyStatus();
  assert(late.getTitle().indexOf('✅') === -1, 'the pre-existing unread releases its mark');
  for (const c of [...lateHost.cleanups]) c();

  // 5) a stop that awaits input is a wait, not a completion: no done, no mark,
  //    and answering the wait does not raise the toast after the fact (the
  //    attention alert owned the moment) — the mark still carries the host's
  //    unread fact until the session is opened
  events.length = 0;
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['s2', statusRow(question('question:410', { sessionId: 's2' }), { running: false, completionUnread: true })],
  ]));
  host.notifyStatus();
  assert(events.filter((e) => e.kind === 'done').length === 0,
    'a stop awaiting input raises no "reply finished"');
  assert(events.filter((e) => e.kind === 'attention').length === 1, 'the wait itself alerts');
  assert(getTitle().indexOf('✅') === -1, 'no unread mark while the wait is pending');
  events.length = 0;
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['s2', statusRow(null, { running: false, completionUnread: true })],
  ]));
  host.notifyStatus();
  await sleep(350); // outside the attention->done same-tick guard
  host.notifyStatus();
  assert(events.filter((e) => e.kind === 'done').length === 0,
    'answering the wait raises no late "reply finished", got ' + JSON.stringify(events));
  assert(getTitle().indexOf('✅') !== -1, 'the host’s unread fact still marks the tab');

  // 6) both marker kinds can be up together ("needs you" leads), and a host
  //    title change underneath survives the rebase
  events.length = 0;
  host.setList({ ids: ['s1', 's2', 's3'], byId: { s1: cur, s2: bg('后台任务'), s3: bg('第三个会话') }, phase: 'ready' });
  host.notifyList();
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['s2', statusRow(null, { running: false, completionUnread: true })],
    ['s3', statusRow(question('question:411', { sessionId: 's3' }), { running: true })],
  ]));
  host.notifyStatus();
  assert(getTitle().indexOf('需要你') !== -1 && getTitle().indexOf('✅') !== -1,
    'attention and unread marks stack, got ' + getTitle());
  assert(getTitle().indexOf('需要你') < getTitle().indexOf('✅'), 'the needs-you mark leads');
  b.doc.title = '会话 B — DeepSeek Harness'; // the host retitlees under the marks
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['s2', statusRow(null, { running: false, completionUnread: false })],
    ['s3', statusRow(null, { running: true })],
  ]));
  host.notifyStatus();
  assert(getTitle() === '会话 B — DeepSeek Harness',
    'markers released -> the host title is restored exactly, got ' + getTitle());
  await sleep(350); // outside the attention->done same-tick guard

  // 7) the on-screen session is never "unread" (its completion is the face
  //    edge's job), and a background subagent step stays muted until un-muted
  events.length = 0;
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false, completionUnread: true })], // s1 is current
  ]));
  host.notifyStatus();
  assert(events.length === 0 && getTitle().indexOf('✅') === -1,
    'the on-screen session raises nothing from the unread flag');
  host.setList({ ids: ['s1', 'sub1'], byId: { s1: cur, sub1: bg('子代理：探索', { origin: 'subagent', parentId: 's1' }) }, phase: 'ready' });
  host.notifyList();
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['sub1', statusRow(null, { running: false, completionUnread: true })],
  ]));
  host.notifyStatus();
  assert(events.length === 0 && getTitle().indexOf('✅') === -1,
    'a background subagent completion is muted like its waits');
  win.__dshNotifyMe.setConfig({ ignoreSubagent: false });
  host.notifyStatus();
  done = events.filter((e) => e.kind === 'done');
  assert(done.length === 1 && done[0].body === '子代理：探索',
    'un-muting reports the outstanding completion once, got ' + JSON.stringify(done));
  assert(getTitle().indexOf('✅') !== -1, 'the un-muted completion marks the tab');
  win.__dshNotifyMe.setConfig({ ignoreSubagent: true });
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['sub1', statusRow(null, { running: false, completionUnread: false })],
  ]));
  host.notifyStatus();
  assert(getTitle().indexOf('✅') === -1, 're-muting clears the mark');

  // 8) doneHiddenOnly suppresses the toast while the page is visible but the
  //    mark still carries the unread fact (the "come back and see" case)
  events.length = 0;
  doc.hidden = false; doc.visibilityState = 'visible';
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['s2', statusRow(null, { running: false, completionUnread: true })],
  ]));
  host.notifyStatus();
  assert(events.length === 0, 'the toast waits for the page to hide (doneHiddenOnly default)');
  assert(getTitle().indexOf('✅') !== -1, 'the mark is up while the page is open');
  doc.hidden = true; doc.visibilityState = 'hidden';
  b.fireVisibility();
  assert(events.filter((e) => e.kind === 'done').length === 0,
    '"done" has no deferred copy — the mark is the reminder');
  host.setStatus(new Map([
    ['s1', statusRow(null, { running: false })],
    ['s2', statusRow(null, { running: false, completionUnread: false })],
  ]));
  host.notifyStatus();
  assert(getTitle().indexOf('✅') === -1, 'reading the session clears the mark');

  for (const c of [...host.cleanups]) c();
  assert(host.listeners.status.length === 0, 'sessionStatus unsubscribed after dispose');
}

// ─────────────── approval quick-decision bridge (1.3.0) ───────────────
// Action buttons only exist on persistent notifications, so the bundle is
// dual-context: the exact same bytes also register as a Service Worker whose
// notificationclick relays the chosen button back to the page. This section
// runs BOTH halves — the worker half in its own worker-shaped vm context, the
// page half in the regular one — joined by a shared BroadcastChannel hub, so a
// toast button press is driven end to end down to the interaction's answer().
function makeChannelHub() {
  const instances = [];
  return class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      instances.push(this);
    }
    postMessage(data) {
      for (const ch of [...instances]) {
        if (ch === this || ch.closed || ch.name !== this.name) continue;
        queueMicrotask(() => { if (!ch.closed && typeof ch.onmessage === 'function') ch.onmessage({ data }); });
      }
    }
    close() { this.closed = true; }
  };
}

// The Service Worker half: same bundle, worker-shaped environment. Returns the
// captured notificationclick handler and the module-load counter (which must
// stay zero — the worker half must never touch the page module table).
// `windowClients` are the window clients clients.matchAll() should report, so
// click-routing (which window a body click raises and steers) can be driven.
function bootWorker(HubCtor, windowClients) {
  const handlers = {};
  let loadCalls = 0;
  const selfStub = {
    registration: { scope: '/plugins/' },
    addEventListener(type, fn) { handlers[type] = fn; },
    clients: { matchAll: () => Promise.resolve(windowClients || []) },
    BroadcastChannel: HubCtor,
  };
  const sandbox = {
    self: selfStub,
    BroadcastChannel: HubCtor,
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Promise, Symbol, Object, JSON, Date, Math, Array, String, Number,
    __ModuleLoader__: { load() { loadCalls += 1; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'client.js (worker half)' });
  return {
    handlers,
    loadCalls: () => loadCalls,
    click(action, data) {
      const waits = [];
      let closed = false;
      handlers.notificationclick({
        action: action || '',
        notification: { data, close: () => { closed = true; } },
        waitUntil: (p) => waits.push(p),
      });
      return { closed: () => closed, waits };
    },
  };
}

// An approval interaction shaped like the shipped PendingApproval: its
// answer() is the exact verb a notification action button calls.
function answerableApproval(key, extra, answers) {
  return Object.assign({
    key,
    kind: 'approval',
    sessionId: 's1',
    toolName: 'pwsh',
    reason: 'needs elevated shell',
    answer(outcome) { answers.push(outcome); return Promise.resolve(); },
  }, extra || {});
}

async function quickActionsHost() {
  console.log('\n— quick-decision bridge (approval toasts carry 同意/拒绝 buttons) —');
  const HubCtor = makeChannelHub();
  const registered = [];
  const shown = [];
  const liveNotes = [];
  const swHandlers = {};
  const serviceWorkerStub = {
    register(url) {
      registered.push(url);
      return Promise.resolve({
        active: {},
        showNotification(title, opts) {
          const n = { title, opts, closed: false, close() { this.closed = true; } };
          shown.push(n);
          liveNotes.push(n);
        },
        getNotifications(filter) {
          return liveNotes.filter((n) => !n.closed && (!filter || !filter.tag || n.opts.tag === filter.tag));
        },
      });
    },
    addEventListener(type, fn) { (swHandlers[type] ||= []).push(fn); },
  };
  const b = bootBundle({
    withNotification: true,
    extend(sandbox, windowStub) {
      sandbox.BroadcastChannel = HubCtor;
      sandbox.navigator = { serviceWorker: serviceWorkerStub };
      sandbox.queueMicrotask = queueMicrotask;
      windowStub.__DSH_BOOT__ = {
        entries: [
          { id: '@deepseek-ai/dsh-client-ui-session', url: '/plugins/??@deepseek-ai/dsh-client-ui-session/client.js&rev=aaa' },
          { id: 'dsh-notify-me', url: '/plugins/??dsh-notify-me/client.js&rev=bbb' },
        ],
      };
    },
  });
  // Window clients for click routing: a client's postMessage feeds the page's
  // service-worker message listeners exactly like a real one would, and
  // focus() counts the window raises.
  const mkWindowClient = (visibilityState) => ({
    visibilityState,
    focused: 0,
    messages: [],
    postMessage(m) {
      this.messages.push(m);
      for (const fn of swHandlers.message || []) fn({ data: m });
    },
    focus() { this.focused += 1; return Promise.resolve(); },
  });
  const clientHidden = mkWindowClient('hidden');
  const clientVisible = mkWindowClient('visible');
  const w = bootWorker(HubCtor, [clientHidden, clientVisible]);
  assert(w.loadCalls() === 0, 'the worker half must not touch the page module table');

  const host = buildHost({ withSessionStatus: true, withWorkspace: true });
  const { mod, win, events, getTitle } = b;
  const answers = [];
  mod.apply(host.ctx);
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  await sleep(20); // register() resolves on a promise tick

  // 1) the bridge registers against THIS bundle's single-record combo URL
  assert(registered.length === 1, 'service worker registered exactly once, got ' + registered.length);
  assert(registered[0] === '/plugins/??dsh-notify-me/client.js&rev=bbb',
    'registered the single-record bundle URL (a multi-plugin combo would break installation), got ' + registered[0]);
  assert(win.__dshNotifyMe.debug().bridge === 'active', 'bridge reports active, got ' + win.__dshNotifyMe.debug().bridge);

  // 2) an approval toast carries the buttons, a question toast never does
  const shownFor = (key) => shown.filter((n) => n.opts.data && n.opts.data.key === key).pop();
  b.doc.hidden = true; b.doc.visibilityState = 'hidden';
  host.setStatus(new Map([['s1', statusRow(answerableApproval('approval:200', null, answers))]]));
  host.notifyStatus();
  assert(shown.length === 1, 'approval raised through the persistent channel, got ' + shown.length);
  let note = shown[0];
  assert(note.title === 'DSH · 审批请求', 'approval toast title, got ' + note.title);
  const acts = note.opts.actions;
  assert(Array.isArray(acts) && acts.length === 2, 'toast carries two actions, got ' + JSON.stringify(acts));
  assert(acts[0].action === 'approve' && acts[1].action === 'reject', 'action ids are approve/reject');
  assert(acts[0].title === '同意' && acts[1].title === '拒绝', 'zh button labels, got ' + JSON.stringify(acts));
  assert(note.opts.data && note.opts.data.key === 'approval:200', 'toast data carries the interaction key');
  assert(note.opts.data.sessionId === 's1', 'toast data carries the session id');
  assert(b.lastNotification() === null, 'no plain constructor toast on the button path');

  // 3) clicking 同意 settles the request exactly like the conversation's 允许一次
  events.length = 0;
  let click = w.click('approve', note.opts.data);
  await sleep(20);
  assert(click.closed(), 'the worker closes the toast it handled');
  assert(answers.length === 1 && answers[0] === 'allowed-once',
    'approve button ran answer("allowed-once"), got ' + JSON.stringify(answers));
  const dec = events.filter((e) => e.kind === 'decision');
  assert(dec.length === 1 && dec[0].outcome === 'allowed-once' && dec[0].key === 'approval:200',
    'decision event exposed to onEvent, got ' + JSON.stringify(dec));
  assert(getTitle().indexOf('需要你') === -1, 'the settled wait releases the tab marker');

  // 4) a stale toast decides nothing: the record is one-shot per key
  click = w.click('approve', note.opts.data);
  await sleep(20);
  assert(answers.length === 1, 'a second click on a settled wait answers nothing');
  click = w.click('reject', { key: 'approval:never-existed', sessionId: 's1' });
  await sleep(20);
  assert(answers.length === 1, 'a click for an unknown key answers nothing');

  // 5) 拒绝 -> answer("rejected"), and the lingering toast is closed with it
  events.length = 0;
  const answers2 = [];
  host.setStatus(new Map([['s1', statusRow(answerableApproval('approval:201', null, answers2))]]));
  host.notifyStatus();
  note = shownFor('approval:201');
  assert(note && note.opts.tag === 'dsh-notify-me-attention-approval:201', 'each wait owns its own toast tag, got ' + (note && note.opts.tag));
  w.click('reject', note.opts.data);
  await sleep(20);
  assert(answers2.length === 1 && answers2[0] === 'rejected', 'reject button ran answer("rejected"), got ' + JSON.stringify(answers2));
  host.setStatus(new Map([['s1', statusRow(null)]]));
  host.notifyStatus();

  // 6) the second relay half works too: a decision arriving through
  //    navigator.serviceWorker's message event (client.postMessage) settles the
  //    request the same way, and api.decide() is its programmatic twin
  const answers3 = [];
  host.setStatus(new Map([['s1', statusRow(answerableApproval('approval:202', null, answers3))]]));
  host.notifyStatus();
  note = shownFor('approval:202');
  assert(note, 'the relay-path wait raised an actionable toast');
  const relayed = { source: 'dsh-notify-me', type: 'notification', action: 'approve', key: 'approval:202', sessionId: 's1' };
  for (const fn of swHandlers.message || []) fn({ data: relayed });
  await sleep(20);
  assert(answers3.length === 1 && answers3[0] === 'allowed-once',
    'the service-worker message relay settles the request, got ' + JSON.stringify(answers3));
  const answers3b = [];
  host.setStatus(new Map([['s1', statusRow(answerableApproval('approval:202b', null, answers3b))]]));
  host.notifyStatus();
  win.__dshNotifyMe.decide('approval:202b', 'allowed-once');
  assert(answers3b.length === 1 && answers3b[0] === 'allowed-once',
    'api.decide settles a pending approval programmatically');
  host.setStatus(new Map([['s1', statusRow(null)]]));
  host.notifyStatus();

  // 7) answered in-page first -> the toast click must decide nothing
  const answers4 = [];
  host.setStatus(new Map([['s1', statusRow(answerableApproval('approval:203', null, answers4))]]));
  host.notifyStatus();
  note = shownFor('approval:203');
  assert(note && note.opts.data.key === 'approval:203', 'the fourth wait raised its own actionable toast');
  host.setStatus(new Map([['s1', statusRow(null)]])); // answered through the page card
  host.notifyStatus();
  w.click('approve', note.opts.data);
  await sleep(20);
  assert(answers4.length === 0, 'a toast outliving its request decides nothing');
  assert(win.__dshNotifyMe.debug().actionKeys.length === 0, 'no dangling quick-decision records');

  // 8) quickActions off -> plain toast, no worker registration, no buttons
  const offHost = buildHost({ withSessionStatus: true, withWorkspace: true });
  const offReg = [];
  const off = bootBundle({
    withNotification: true,
    extend(sandbox, windowStub) {
      sandbox.BroadcastChannel = HubCtor;
      sandbox.navigator = { serviceWorker: {
        register(url) { offReg.push(url); return Promise.reject(new Error('must not register')); },
        addEventListener() {},
      } };
      windowStub.__DSH_BOOT__ = { entries: [{ id: 'dsh-notify-me', url: '/plugins/??dsh-notify-me/client.js&rev=ccc' }] };
    },
  });
  off.win.__dshNotifyMe.setConfig({ quickActions: false });
  off.mod.apply(offHost.ctx);
  await sleep(20);
  assert(offReg.length === 0, 'quickActions off registers no worker');
  off.doc.hidden = true; off.doc.visibilityState = 'hidden';
  offHost.setStatus(new Map([['s1', statusRow(answerableApproval('approval:210', null, []))]]));
  offHost.notifyStatus();
  const plain = off.lastNotification();
  assert(plain && plain.title === 'DSH · 审批请求', 'quickActions off falls back to the plain toast');
  assert(!plain.config.actions, 'the plain toast carries no actions (the constructor would throw on them)');
  offHost.setStatus(new Map([['s1', statusRow(null)]]));
  offHost.notifyStatus();
  for (const c of [...offHost.cleanups]) c();

  // 9) a bridge that cannot install (no service worker at all) degrades the
  //    same way instead of silencing the alert
  const noHost = buildHost({ withSessionStatus: true, withWorkspace: true });
  const no = bootBundle({ withNotification: true });
  no.mod.apply(noHost.ctx);
  await sleep(20);
  assert(no.win.__dshNotifyMe.debug().bridge.indexOf('unsupported') === 0,
    'bridge reports why it is unavailable, got ' + no.win.__dshNotifyMe.debug().bridge);
  no.doc.hidden = true; no.doc.visibilityState = 'hidden';
  noHost.setStatus(new Map([['s1', statusRow(answerableApproval('approval:211', null, []))]]));
  noHost.notifyStatus();
  assert(no.lastNotification() && no.lastNotification().title === 'DSH · 审批请求',
    'approval still alerts without a bridge');
  noHost.setStatus(new Map([['s1', statusRow(null)]]));
  noHost.notifyStatus();
  for (const c of [...noHost.cleanups]) c();

  // 10) the settings test toast drives the whole worker chain end to end
  events.length = 0;
  win.__dshNotifyMe.test('approval');
  note = shown[shown.length - 1];
  assert(note && note.opts.data && note.opts.data.test === true, 'test approval toast is flagged as a test');
  assert(note.opts.actions && note.opts.actions.length === 2, 'test toast carries the buttons too');
  w.click('approve', note.opts.data);
  await sleep(20);
  const testDec = events.filter((e) => e.kind === 'decision');
  assert(testDec.length === 1 && testDec[0].test === true && testDec[0].outcome === 'allowed-once',
    'test button click reports a simulated decision, got ' + JSON.stringify(testDec));
  assert(events.filter((e) => e.kind === 'done').length === 1, 'test decision answers with a feedback toast');

  // 11) a body click means "take me there": the worker raises exactly one DSH
  //     window (visible first) and routes the conversation switch to it alone,
  //     so several open tabs cannot fight over focus or all switch at once
  b.doc.hidden = true; b.doc.visibilityState = 'hidden';
  host.setList({ ids: ['s2'], byId: { s2: { displayTitle: '后台任务', retainedBy: {} } }, phase: 'ready' });
  host.notifyList();
  const answers5 = [];
  host.setStatus(new Map([['s2', statusRow(answerableApproval('approval:220', { sessionId: 's2' }, answers5))]]));
  host.notifyStatus();
  note = shownFor('approval:220');
  assert(note && note.opts.data && note.opts.data.focus === true,
    'the toast records the autoFocus setting for the worker, got ' + JSON.stringify(note.opts.data));
  host.opened.length = 0;
  w.click('', note.opts.data);
  await sleep(20);
  assert(clientVisible.focused === 1 && clientHidden.focused === 0,
    'a body click raises exactly the visible window, got ' + JSON.stringify([clientHidden.focused, clientVisible.focused]));
  assert(clientVisible.messages.filter((m) => m.navigate === true).length === 1,
    'only the chosen window is told to navigate, got ' + JSON.stringify(clientVisible.messages));
  assert(clientHidden.messages.every((m) => m.navigate !== true),
    'the other window stays put, got ' + JSON.stringify(clientHidden.messages));
  assert(host.opened.length === 1 && host.opened[0] === 's2',
    'the click switches that window to the alerted conversation, got ' + JSON.stringify(host.opened));
  assert(answers5.length === 0, 'a body click decides nothing');

  // 12) a button press stays hands-off — deciding must not drag a window up or
  //     switch any conversation — and autoFocus off keeps the "clicking a toast
  //     does nothing" promise on the persistent channel too
  host.opened.length = 0;
  w.click('approve', note.opts.data);
  await sleep(20);
  assert(answers5.length === 1 && answers5[0] === 'allowed-once', 'the button still settles the request');
  assert(clientVisible.focused === 1 && clientHidden.focused === 0,
    'deciding raises no window (both clients only got the relay), got ' + JSON.stringify([clientHidden.focused, clientVisible.focused]));
  assert(host.opened.length === 0, 'a button press never switches conversations');
  win.__dshNotifyMe.setConfig({ autoFocus: false });
  const answers6 = [];
  host.setStatus(new Map([['s2', statusRow(answerableApproval('approval:221', { sessionId: 's2' }, answers6))]]));
  host.notifyStatus();
  note = shownFor('approval:221');
  assert(note && note.opts.data.focus === false, 'autoFocus off is recorded on the toast itself');
  const focusedBefore = clientHidden.focused + clientVisible.focused;
  host.opened.length = 0;
  w.click('', note.opts.data);
  await sleep(20);
  assert(clientHidden.focused + clientVisible.focused === focusedBefore, 'no window is raised while autoFocus is off');
  assert(host.opened.length === 0, 'no conversation switch while autoFocus is off');
  win.__dshNotifyMe.setConfig({ autoFocus: true });
  host.setStatus(new Map([['s2', statusRow(null)]]));
  host.notifyStatus();

  for (const c of [...host.cleanups]) c();
  console.log('quick-decision bridge OK:', JSON.stringify({
    registered: registered[0],
    decisions: answers.concat(answers2, answers3),
  }));
}

// ────────── background subagent sessions stay quiet (1.4.0) ──────────
// DSH lists every subagent's child session as an ordinary row (origin:
// 'subagent', parentId: <parent>), so a watcher that walks the whole list
// alerts for a step of a conversation the user never started. The mute keys on
// that origin field plus "not the session on screen": the subagent session the
// user has open is just another conversation and alerts by the normal rules,
// while a forked session (parentId set, no origin) is the user's own
// conversation throughout and keeps alerting.
async function subagentSessions() {
  console.log('\n— background subagent sessions (origin: "subagent") are muted, the open one alerts —');
  const b = bootBundle();
  const host = buildHost({ withSessionStatus: true, withWorkspace: true });
  const { mod, win, doc, events, getTitle } = b;
  const cur = { running: false, displayTitle: '当前会话', retainedBy: { mainView: 1 } };
  const curRun = { running: true, displayTitle: '当前会话', retainedBy: { mainView: 1 } };
  const bg = (title, extra) => Object.assign({ running: true, displayTitle: title, retainedBy: {} }, extra || {});
  const child = (title, extra) => bg(title, Object.assign({ origin: 'subagent', parentId: 's1' }, extra || {}));
  const fork = (title) => bg(title, { parentId: 's1' });

  mod.apply(host.ctx);
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  assert(win.__dshNotifyMe.config.ignoreSubagent === true, 'ignoreSubagent defaults to true');
  assert(win.__dshNotifyMe.debug().ignoreSubagent === true, 'debug() reports ignoreSubagent');

  // 1) a background subagent finishing raises nothing; a normal background
  //    session still does
  doc.hidden = true; doc.visibilityState = 'hidden';
  host.setList({ ids: ['s1', 'sub1', 's2'], byId: { s1: cur, sub1: child('子代理：探索'), s2: bg('后台任务') }, phase: 'ready' });
  host.notifyList();
  events.length = 0;
  host.setList({ ids: ['s1', 'sub1', 's2'], byId: { s1: cur, sub1: child('子代理：探索', { running: false }), s2: bg('后台任务', { running: false }) }, phase: 'ready' });
  host.notifyList();
  const done = events.filter((e) => e.kind === 'done');
  assert(done.length === 1, 'only the normal session reports "reply finished", got ' + JSON.stringify(done));
  assert(done[0].body === '后台任务', 'the surviving alert is the normal session, got ' + JSON.stringify(done[0].body));

  // 2) a background subagent's wait never alerts and never marks the tab
  events.length = 0;
  host.setList({ ids: ['s1', 'sub1'], byId: { s1: cur, sub1: child('子代理：探索') }, phase: 'ready' });
  host.notifyList();
  host.setStatus(new Map([['sub1', statusRow(question('question:301', { sessionId: 'sub1' }))]]));
  host.notifyStatus();
  assert(events.filter((e) => e.kind === 'attention').length === 0,
    'a subagent wait is muted, got ' + JSON.stringify(events));
  assert(getTitle().indexOf('需要你') === -1, 'a muted subagent wait leaves no title marker');

  // 3) a forked session (parentId, no origin) is still the user's own conversation
  events.length = 0;
  host.setStatus(new Map([['sub1', statusRow(null)]])); // the subagent wait is answered
  host.notifyStatus();
  host.setList({ ids: ['s1', 'fork1'], byId: { s1: cur, fork1: fork('分支会话') }, phase: 'ready' });
  host.notifyList();
  host.setStatus(new Map([['fork1', statusRow(question('question:302', { sessionId: 'fork1' }))]]));
  host.notifyStatus();
  const forkAtt = events.filter((e) => e.kind === 'attention');
  assert(forkAtt.length === 1, 'a forked session still alerts, got ' + JSON.stringify(forkAtt));
  assert(forkAtt[0].body.indexOf('分支会话') !== -1, 'the fork alert carries its own title, got ' + forkAtt[0].body);

  // 4) turning the switch off restores subagent alerts, live
  win.__dshNotifyMe.setConfig({ ignoreSubagent: false });
  events.length = 0;
  host.setStatus(new Map([['sub1', statusRow(question('question:303', { sessionId: 'sub1' }))]]));
  host.notifyStatus();
  assert(events.filter((e) => e.kind === 'attention').length === 1,
    'un-muting re-enables subagent waits, got ' + JSON.stringify(events));
  // the done edge is deliberately ignored within 300ms of an attention alert
  // (the same-tick answering rule), so let that window pass first
  await sleep(350);
  events.length = 0;
  host.setList({ ids: ['s1', 'sub1'], byId: { s1: cur, sub1: child('子代理：探索') }, phase: 'ready' });
  host.notifyList();
  host.setList({ ids: ['s1', 'sub1'], byId: { s1: cur, sub1: child('子代理：探索', { running: false }) }, phase: 'ready' });
  host.notifyList();
  const unmuted = events.filter((e) => e.kind === 'done');
  assert(unmuted.length === 1 && unmuted[0].body === '子代理：探索',
    'un-muting restores the subagent "reply finished" alert, got ' + JSON.stringify(unmuted));

  // 5) the subagent session the user has open is not background at all: it
  //    alerts like any other conversation (wait + "reply finished")
  win.__dshNotifyMe.setConfig({ ignoreSubagent: true });
  host.setStatus(new Map([['sub1', statusRow(null)]]));
  host.notifyStatus();
  await sleep(350);
  events.length = 0;
  host.setList({
    ids: ['s1', 'sub1'],
    byId: { s1: bg('后台任务'), sub1: child('子代理：正在看', { retainedBy: { mainView: 1 } }) },
    phase: 'ready',
  });
  host.notifyList();
  assert(win.__dshNotifyMe.debug().currentSession === 'sub1',
    'the open subagent session is the current one, got ' + win.__dshNotifyMe.debug().currentSession);
  host.setStatus(new Map([['sub1', statusRow(question('question:304', { sessionId: 'sub1' }))]]));
  host.notifyStatus();
  const openAtt = events.filter((e) => e.kind === 'attention');
  assert(openAtt.length === 1, 'the open subagent session alerts, got ' + JSON.stringify(openAtt));
  assert(openAtt[0].body.indexOf('子代理：正在看') !== -1,
    'the alert carries the open session title, got ' + openAtt[0].body);
  assert(getTitle().indexOf('需要你') !== -1, 'the open subagent wait marks the tab');
  // ...and so does its "reply finished" edge (same-tick answering rule aside)
  await sleep(350);
  events.length = 0;
  host.setStatus(new Map([['sub1', statusRow(null)]]));
  host.notifyStatus();
  host.setFace({ sessionId: 'sub1', running: true, nodes: [], pending: [] });
  host.notifyFace();
  host.setFace({ sessionId: 'sub1', running: false, nodes: [], pending: [] });
  host.notifyFace();
  const openDone = events.filter((e) => e.kind === 'done');
  assert(openDone.length === 1 && openDone[0].sessionId === 'sub1',
    'the open subagent session reports "reply finished", got ' + JSON.stringify(openDone));

  // 6) a wait raised while the subagent session sat in the background is
  //    delivered once the user opens it — under the normal current-conversation
  //    rules (queued while the page is visible, delivered on background)
  await sleep(350);
  doc.hidden = false; doc.visibilityState = 'visible';
  events.length = 0;
  host.setFace({ sessionId: 's1', running: true, nodes: [], pending: [] });
  host.setList({ ids: ['s1', 'sub1'], byId: { s1: curRun, sub1: child('子代理：探索') }, phase: 'ready' });
  host.notifyList();
  host.setStatus(new Map([['sub1', statusRow(question('question:305', { sessionId: 'sub1' }))]]));
  host.notifyStatus();
  assert(events.length === 0, 'a background subagent wait stays muted, got ' + JSON.stringify(events));
  assert(getTitle().indexOf('需要你') === -1, 'a muted wait leaves no title mark');
  host.setFace({ sessionId: 'sub1', running: true, nodes: [], pending: [] });
  host.setList({
    ids: ['s1', 'sub1'],
    byId: { s1: bg('后台任务'), sub1: child('子代理：探索', { retainedBy: { mainView: 1 } }) },
    phase: 'ready',
  });
  host.notifyList();
  assert(events.filter((e) => e.kind === 'attention').length === 0,
    'opening it stays quiet while the page is visible, got ' + JSON.stringify(events));
  assert(getTitle().indexOf('需要你') !== -1, 'opening the session marks the tab');
  assert(win.__dshNotifyMe.debug().quietedKeys.indexOf('question:305') !== -1,
    'the outstanding wait is queued like any current-conversation wait');
  doc.hidden = true; doc.visibilityState = 'hidden';
  b.fireVisibility();
  const opened = events.filter((e) => e.kind === 'attention');
  assert(opened.length === 1 && opened[0].body.indexOf('子代理：探索') !== -1,
    'the queued wait is delivered on background, got ' + JSON.stringify(opened));

  // 7) leaving the subagent session puts its wait back in the muted bucket:
  //    the title mark goes and the queued copy dies with it
  doc.hidden = false; doc.visibilityState = 'visible';
  events.length = 0;
  host.setFace({ sessionId: 'sub1', running: true, nodes: [], pending: [] });
  host.setList({
    ids: ['s1', 'sub1'],
    byId: { s1: bg('后台任务'), sub1: child('子代理：探索', { retainedBy: { mainView: 1 } }) },
    phase: 'ready',
  });
  host.notifyList();
  host.setStatus(new Map([['sub1', statusRow(question('question:306', { sessionId: 'sub1' }))]]));
  host.notifyStatus();
  assert(win.__dshNotifyMe.debug().quietedKeys.indexOf('question:306') !== -1,
    'the open session’s wait queues while the page is visible');
  host.setFace({ sessionId: 's1', running: true, nodes: [], pending: [] });
  host.setList({ ids: ['s1', 'sub1'], byId: { s1: curRun, sub1: child('子代理：探索') }, phase: 'ready' });
  host.notifyList();
  assert(events.length === 0, 'switching away raises nothing, got ' + JSON.stringify(events));
  assert(getTitle().indexOf('需要你') === -1, 'the muted wait leaves no title mark');
  assert(win.__dshNotifyMe.debug().quietedKeys.length === 0,
    'its queued copy dies with the mute');
  doc.hidden = true; doc.visibilityState = 'hidden';
  b.fireVisibility();
  assert(events.length === 0, 'the dead queued copy is never delivered');

  for (const c of [...host.cleanups]) c();
}

// ────────── desktop shell window raise (1.14.0, non-Windows since 1.14.4) ──────────
// The packaged desktop page (dsh-app://app) cannot raise its own window: DOM
// window.focus() never touches the native window, Chromium only activates a
// window the OS already treats as foreground, and the shell exposes no focus
// IPC. Two channels exist, chosen by platform:
//
//   Windows  — the host half registers a focus route on the host web server;
//              the click POSTs to it and that process does the Win32
//              activation. A relative URL works because the shell forwards
//              every non-static dsh-app://app path to the host with the host
//              cookie attached, so this is a plain same-origin fetch.
//   others   — the hidden-frame navigation to dsh://open (the 1.5.2..1.13.0
//              path) reaches the system protocol registration, whose
//              single-instance owner restores and focuses the window.
//
// The deep link was removed in 1.14.0 because on Windows it launched a second
// instance that exited in ~130 ms without touching IsIconic. That failure is
// Windows-specific; the cases below pin both branches with an explicit UA.
const FOCUS_ROUTE = '/__dsh-notify-me/focus-window';
// The page-bridge route this page probes at boot and heartbeats while the host
// says it has a host-side fallback for closed pages (design §4.1).
const HOST_BRIDGE_ROUTE = '/__dsh-notify-me/host-bridge';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) dsh-desktop/0.2.1 Chrome/152.0.7977.130 Electron/44.7.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) dsh-desktop/0.2.1 Chrome/152.0.7977.130 Electron/44.7.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) dsh-desktop/0.2.1 Chrome/152.0.7977.130 Electron/44.7.0 Safari/537.36';

// Records every fetch and answers with a stand-in response. `behavior` returns
// the response for a call (or throws) so a case can refuse or kill the route.
// Only POSTs are recorded: the page also GETs its own host-bridge probe at
// boot, which is a different route and would inflate the raise counts.
function focusFetchSpy(behavior) {
  const calls = [];
  const fn = (url, opts) => {
    if (!opts || opts.method !== 'GET') calls.push({ url: String(url), opts: opts || {} });
    const answer = behavior || (() => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, focused: true, platform: 'win32' }),
    }));
    try { return Promise.resolve(answer(url, opts)); } catch (e) { return Promise.reject(e); }
  };
  return { calls, fn };
}

// One raise case end to end: boot the bundle on the given origin, deliver an
// attention toast, click it, and hand back what the click did. `beforeClick`
// stops right after the boot instead, for what debug() reports before any
// toast has been clicked.
async function raiseCase({ location, fetchSpy, config, userAgent, beforeClick }) {
  const iframes = [];
  const focusHits = { n: 0 };
  const b = bootBundle({
    withNotification: true,
    extend(sandbox) {
      sandbox.location = location;
      sandbox.navigator = { ...(sandbox.navigator || {}), userAgent: userAgent || WINDOWS_UA };
      sandbox.document.body = {
        appendChild(node) { iframes.push(node); return node; },
        removeChild() {},
      };
      sandbox.document.createElement = () => ({ style: {}, setAttribute() {}, parentNode: sandbox.document.body });
      sandbox.window.focus = () => { focusHits.n += 1; };
      if (fetchSpy) sandbox.fetch = fetchSpy.fn;
    },
  });
  const host = buildHost({ withSessionStatus: true, withWorkspace: true });
  b.mod.apply(host.ctx);
  await sleep(20);
  if (config) b.win.__dshNotifyMe.setConfig(config);
  if (beforeClick) {
    const debug = b.win.__dshNotifyMe.debug();
    for (const c of [...host.cleanups]) c();
    return { debug, iframes, focusHits: focusHits.n, opened: host.opened.slice() };
  }
  b.doc.hidden = true;
  b.doc.visibilityState = 'hidden';
  host.setList({
    ids: ['s1', 's2'],
    byId: { s1: { displayTitle: '当前会话', retainedBy: { mainView: 1 } }, s2: { displayTitle: '后台任务', retainedBy: {} } },
    phase: 'ready',
  });
  host.notifyList();
  host.setStatus(new Map([['s2', statusRow(question('question:501', { sessionId: 's2' }))]]));
  host.notifyStatus();
  const note = b.lastNotification();
  assert(note && typeof note.onclick === 'function', 'the toast body click is wired');
  note.onclick();
  await sleep(20);
  const outcome = {
    debug: b.win.__dshNotifyMe.debug(),
    iframes,
    focusHits: focusHits.n,
    opened: host.opened.slice(),
  };
  for (const c of [...host.cleanups]) c();
  return outcome;
}

async function desktopRaiseChannel() {
  console.log('\n— desktop shell (dsh-app://) window raise —');
  const desktopOrigin = { origin: 'dsh-app://app', protocol: 'dsh-app:' };
  const webOrigin = { origin: 'http://127.0.0.1:3080', protocol: 'http:' };

  // debug() names the channel from the platform, before any toast has been
  // clicked: the settings page is usually read right after installing, and a
  // click-driven field would answer "window-focus" on a desktop there.
  const winPre = await raiseCase({ location: desktopOrigin, userAgent: WINDOWS_UA, beforeClick: true });
  assert(winPre.debug.raiseChannel === 'host-route',
    'a Windows desktop reports the host route before the first click, got ' + winPre.debug.raiseChannel);
  const macPre = await raiseCase({ location: desktopOrigin, userAgent: MAC_UA, beforeClick: true });
  assert(macPre.debug.raiseChannel === 'dsh-deeplink',
    'a macOS desktop reports the deep link before the first click, got ' + macPre.debug.raiseChannel);
  const webPre = await raiseCase({ location: webOrigin, userAgent: WINDOWS_UA, beforeClick: true });
  assert(webPre.debug.raiseChannel === 'window-focus',
    'a browser tab keeps reporting window.focus(), got ' + webPre.debug.raiseChannel);

  // Windows desktop: the click reaches the host route, which owns the activation.
  const desktopSpy = focusFetchSpy();
  const desk = await raiseCase({ location: desktopOrigin, fetchSpy: desktopSpy, userAgent: WINDOWS_UA });
  assert(desk.debug.desktop === true, 'debug() reports the desktop shell');
  assert(desk.debug.raiseChannel === 'host-route',
    'debug() reports the host-route raise channel, got ' + desk.debug.raiseChannel);
  assert(desk.focusHits === 1, 'window.focus() is still called first, got ' + desk.focusHits);
  assert(desk.iframes.length === 0,
    'no dsh://open deep link fires on Windows, got ' + JSON.stringify(desk.iframes.map((f) => f.src)));
  assert(desktopSpy.calls.length === 1, 'the click posts to the focus route exactly once, got ' + desktopSpy.calls.length);
  assert(desktopSpy.calls[0].url === FOCUS_ROUTE, 'the raise posts to ' + FOCUS_ROUTE + ', got ' + desktopSpy.calls[0].url);
  assert(desktopSpy.calls[0].opts.method === 'POST', 'the raise is a POST, got ' + desktopSpy.calls[0].opts.method);
  assert(desktopSpy.calls[0].opts.headers && desktopSpy.calls[0].opts.headers['x-dsh-notify-me-focus'] === 'focus',
    'the raise carries the CSRF header, got ' + JSON.stringify(desktopSpy.calls[0].opts.headers));
  assert(desk.debug.raiseLast === 'focused', 'debug() records the focused verdict, got ' + desk.debug.raiseLast);
  assert(desk.opened.length === 1 && desk.opened[0] === 's2',
    'the click still switches the alerted conversation, got ' + JSON.stringify(desk.opened));

  // Linux/macOS desktop: the Windows host route is not available, so the shell's
  // own dsh://open handler is the only channel that restores the window.
  const linuxSpy = focusFetchSpy(() => ({
    ok: false,
    status: 501,
    json: () => Promise.resolve({ ok: false, reason: 'unsupported-host' }),
  }));
  const linux = await raiseCase({ location: desktopOrigin, fetchSpy: linuxSpy, userAgent: LINUX_UA });
  assert(linux.debug.desktop === true, 'a Linux desktop page is still the desktop shell');
  assert(linux.debug.raiseChannel === 'dsh-deeplink',
    'Linux uses the deep-link raise channel, got ' + linux.debug.raiseChannel);
  assert(linux.iframes.length === 1, 'the Linux raise inserts exactly one frame, got ' + linux.iframes.length);
  assert(linux.iframes[0].src === 'dsh://open',
    'the Linux frame navigates to dsh://open, got ' + linux.iframes[0].src);
  assert(linux.focusHits === 1, 'window.focus() is still called first on Linux, got ' + linux.focusHits);
  assert(linuxSpy.calls.length === 0,
    'the Linux deep link never posts to the Windows host route, got ' + linuxSpy.calls.length);
  assert(linux.debug.raiseLast === 'deeplink', 'debug() records the deep-link verdict, got ' + linux.debug.raiseLast);
  assert(linux.opened.length === 1 && linux.opened[0] === 's2',
    'the Linux click still switches the alerted conversation, got ' + JSON.stringify(linux.opened));

  // macOS rides the same deep link — its shell handles open-url instead of a
  // second instance, and no Windows host route exists there either. The branch
  // is pinned here; a real Mac has not been tested yet.
  const macSpy = focusFetchSpy();
  const mac = await raiseCase({ location: desktopOrigin, fetchSpy: macSpy, userAgent: MAC_UA });
  assert(mac.debug.raiseChannel === 'dsh-deeplink',
    'macOS uses the deep-link raise channel, got ' + mac.debug.raiseChannel);
  assert(mac.iframes.length === 1 && mac.iframes[0].src === 'dsh://open',
    'the macOS raise navigates one frame to dsh://open, got ' + JSON.stringify(mac.iframes.map((f) => f.src)));
  assert(macSpy.calls.length === 0, 'macOS never posts to the Windows host route, got ' + macSpy.calls.length);
  assert(mac.debug.raiseLast === 'deeplink', 'debug() records the macOS deep-link verdict, got ' + mac.debug.raiseLast);

  // Browser tab: no host route, window.focus() is all that exists.
  const webSpy = focusFetchSpy();
  const web = await raiseCase({ location: webOrigin, fetchSpy: webSpy });
  assert(web.debug.desktop === false, 'a plain origin is not the desktop shell');
  assert(web.debug.raiseChannel === 'window-focus', 'browsers keep the window-focus channel');
  assert(webSpy.calls.length === 0, 'a browser never reaches for the host route, got ' + webSpy.calls.length);
  assert(web.debug.raiseLast === 'browser', 'a browser raise records the browser verdict, got ' + web.debug.raiseLast);
  assert(web.iframes.length === 0, 'no deep link fires in a browser');
  assert(web.opened.length === 1 && web.opened[0] === 's2', 'the browser click switches the conversation');

  // The hostEnv setting overrides detection in both directions.
  const forcedWebSpy = focusFetchSpy();
  const forcedWeb = await raiseCase({ location: desktopOrigin, fetchSpy: forcedWebSpy, config: { hostEnv: 'web' } });
  assert(forcedWeb.debug.desktop === false, 'forcing web overrides desktop detection');
  assert(forcedWeb.debug.raiseChannel === 'window-focus', 'forced web keeps the window-focus channel');
  assert(forcedWeb.debug.hostEnvDetected === 'desktop', 'debug() still reports what detection saw');
  assert(forcedWebSpy.calls.length === 0, 'forced web never posts to the focus route');

  const forcedDeskSpy = focusFetchSpy();
  const forcedDesk = await raiseCase({ location: webOrigin, fetchSpy: forcedDeskSpy, config: { hostEnv: 'desktop' }, userAgent: WINDOWS_UA });
  assert(forcedDesk.debug.desktop === true, 'forcing desktop overrides web detection');
  assert(forcedDesk.debug.raiseChannel === 'host-route', 'forced desktop uses the host route');
  assert(forcedDeskSpy.calls.length === 1 && forcedDeskSpy.calls[0].url === FOCUS_ROUTE,
    'forced desktop posts to the focus route on a web origin');

  // A host that refuses (web profile, non-Windows shell) must not break the
  // click: the toast still has to land on the right conversation.
  const refusedSpy = focusFetchSpy(() => ({
    ok: false,
    status: 501,
    json: () => Promise.resolve({ ok: false, reason: 'unsupported-host' }),
  }));
  const refused = await raiseCase({ location: desktopOrigin, fetchSpy: refusedSpy, userAgent: WINDOWS_UA });
  assert(refused.debug.raiseLast === 'http-501', 'a refusing host is recorded as http-501, got ' + refused.debug.raiseLast);
  assert(refused.opened.length === 1 && refused.opened[0] === 's2', 'a refused raise still switches the conversation');

  // A dead route (host half not mounted, shell offline) must not break it either.
  const deadSpy = focusFetchSpy(() => { throw new TypeError('Failed to fetch'); });
  const dead = await raiseCase({ location: desktopOrigin, fetchSpy: deadSpy, userAgent: WINDOWS_UA });
  assert(dead.debug.raiseLast === 'error', 'an unreachable route is recorded as error, got ' + dead.debug.raiseLast);
  assert(dead.opened.length === 1 && dead.opened[0] === 's2', 'an unreachable route still switches the conversation');

  console.log('desktop raise channel OK: Windows POSTs ' + FOCUS_ROUTE
    + ', other desktops navigate dsh://open, a browser only calls window.focus(), '
    + 'hostEnv overrides both ways, and refusals or dead routes are non-fatal');
}

// ── alert sound source: built-in cue / picked file / system sound ──────────
// The cue is the one alert surface with no coverage at all: the harness leaves
// AudioContext undefined, so every other case silently takes the "no audio
// available" path. These helpers install a capturing AudioContext and an
// <audio> stand-in, and the cases drive the cues through api.test(), which
// bypasses the visibility gates on purpose.
function makeAudioCapture() {
  const tones = [];
  class FakeGain {
    constructor() {
      this.gain = {
        steps: [],
        setValueAtTime(v) { this.steps.push(v); },
        exponentialRampToValueAtTime(v) { this.steps.push(v); },
      };
    }
    connect(dest) { return dest; }
  }
  class FakeOsc {
    constructor() { this.type = null; this.frequency = { value: 0 }; this.vol = null; }
    connect(gain) { if (gain && gain.gain) this.vol = gain.gain.steps[1]; return gain; }
    start() {}
    stop() {}
  }
  class FakeAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createOscillator() { const o = new FakeOsc(); tones.push(o); return o; }
    createGain() { return new FakeGain(); }
  }
  return { FakeAudioContext, tones, freqs: () => tones.map((o) => o.frequency.value) };
}
// The bundle plays a picked file through a bare `Audio`, i.e. the sandbox
// global rather than window.Audio.
function makeAudioElementCapture() {
  const cap = {
    played: [],
    // When flipped, play() rejects the way a decode failure or the browser's
    // autoplay refusal does — asynchronously, not by throwing.
    failPlay: false,
    FakeAudio: class {
      constructor(src) { this.src = src; this.volume = 1; }
      play() {
        cap.played.push(this);
        return cap.failPlay ? Promise.reject(new Error('decode refused')) : Promise.resolve();
      }
    },
  };
  return cap;
}

const PICKED_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=';

async function soundSources() {
  console.log('\n— alert sound source: built-in cue / picked file / system sound —');
  const audio = makeAudioCapture();
  const el = makeAudioElementCapture();
  let store = null;
  const b = bootBundle({
    withNotification: true,
    extend(sandbox, windowStub) {
      windowStub.AudioContext = audio.FakeAudioContext;
      sandbox.Audio = el.FakeAudio;
      store = sandbox.localStorage;
      store.setItem('dshNotifyMe.sound.done', JSON.stringify({ name: 'Windows Notify System Generic.wav', size: 193940, data: PICKED_WAV }));
    },
  });
  const host = buildHost({ withSessionStatus: true, withWorkspace: true });
  const { mod, win, lastNotification } = b;
  mod.apply(host.ctx);
  const api = win.__dshNotifyMe;

  // 1) default: the built-in cue, and the toast stays silenced so the platform
  //    does not stack its own chime on top of the beep.
  assert(api.config.soundDone === 'synth', 'soundDone defaults to synth');
  assert(api.config.soundAttention === 'synth', 'soundAttention defaults to synth');
  const dbg = api.debug();
  assert(dbg.soundDone === 'synth' && dbg.soundAttention === 'synth', 'debug() reports both cue modes');
  assert(dbg.customSoundDone === true && dbg.customSoundAttention === false, 'debug() reports which kinds have a picked file');
  api.test('done');
  assert(audio.freqs().join(',') === '659,988', 'default "done" cue is the built-in pair, got ' + audio.freqs().join(','));
  assert(lastNotification().config.silent === true, 'default toast is silent (the plugin owns the audio)');

  audio.tones.length = 0;
  api.test('attention');
  assert(audio.freqs().join(',') === '880,1174,1568', 'default "attention" cue is the built-in triad, got ' + audio.freqs().join(','));

  // 2) 'system': no plugin cue at all, and the toast is raised un-silenced so
  //    the operating system plays its own notification sound.
  audio.tones.length = 0;
  api.setConfig({ soundDone: 'system' });
  api.test('done');
  assert(audio.tones.length === 0, "'system' plays no built-in tone");
  assert(el.played.length === 0, "'system' plays no picked file");
  assert(lastNotification().config.silent === false, "'system' un-silences the toast so the OS chimes");
  assert(api.debug().soundDone === 'system', 'debug() follows the cue mode');

  // The master Sound switch still mutes the system cue: the OS must not chime
  // for an alert the user turned sound off for.
  api.setConfig({ sound: false });
  api.test('done');
  assert(lastNotification().config.silent === true, 'Sound off re-silences the toast even in system mode');
  api.setConfig({ sound: true });

  // 3) 'custom': the picked file plays instead of the built-in cue.
  audio.tones.length = 0;
  el.played.length = 0;
  api.setConfig({ soundDone: 'custom' });
  api.test('done');
  assert(el.played.length === 1, "custom plays the picked file, got " + el.played.length);
  assert(el.played[0].src === PICKED_WAV, 'the picked file is the stored data URL');
  assert(el.played[0].volume === api.config.volume, 'the picked file answers the volume slider');
  assert(audio.tones.length === 0, 'custom does not also play the built-in tone');
  assert(lastNotification().config.silent === true, 'custom keeps the toast silent');

  // The two kinds are independent: "attention" is still on its built-in cue.
  audio.tones.length = 0;
  api.test('attention');
  assert(audio.freqs().join(',') === '880,1174,1568', 'the other kind keeps its own source');

  // 4) 'custom' with nothing stored must not go silent — it falls back.
  store.removeItem('dshNotifyMe.sound.done');
  audio.tones.length = 0;
  el.played.length = 0;
  api.test('done');
  assert(el.played.length === 0, 'no file left to play');
  assert(audio.freqs().join(',') === '659,988', 'a missing file falls back to the built-in cue, got ' + audio.freqs().join(','));

  // 4b) A stored file the browser refuses to play must not go silent either:
  //     the refusal rejects play()'s promise asynchronously, and the built-in
  //     cue takes over when it does.
  store.setItem('dshNotifyMe.sound.done', JSON.stringify({ name: 'x.wav', size: 3, data: PICKED_WAV }));
  audio.tones.length = 0;
  el.played.length = 0;
  el.failPlay = true;
  api.test('done');
  assert(el.played.length === 1, 'the picked file was attempted');
  await new Promise((r) => setTimeout(r, 0));
  assert(audio.freqs().join(',') === '659,988', 'a refused play() falls back to the built-in cue, got ' + audio.freqs().join(','));
  el.failPlay = false;

  // 5) reset drops the picked audio too: the records live outside the config,
  //    so clearing the config alone would orphan them in the origin quota.
  store.setItem('dshNotifyMe.sound.attention', JSON.stringify({ name: 'x.wav', size: 3, data: PICKED_WAV }));
  assert(api.debug().customSoundAttention === true, 'attention file stored');
  api.resetConfig();
  assert(store.getItem('dshNotifyMe.sound.done') === null, 'reset clears the done record');
  assert(store.getItem('dshNotifyMe.sound.attention') === null, 'reset clears the attention record');
  assert(api.debug().customSoundAttention === false, 'reset drops the stored-file flags');

  for (const c of [...host.cleanups]) c();
  console.log('alert sound source OK: synth/system/custom dispatch, fallback, and reset all behave');
}

// ── issue #15: repeated toasts must not share a tag ────────────────────────
// Electron ignores renotify:true, so a fixed per-kind tag made the second toast
// of a kind silently replace the first instead of re-alerting. A counter plus a
// timestamp gives every plain toast its own tag, while approvals keep the
// stable attention-<key> tag that closeNotificationTag() looks up.
function uniqueToastTags() {
  console.log('\n— repeated toasts of one kind carry unique tags (issue #15) —');
  const raised = [];
  class CaptureNotification {
    constructor(title, config) { this.title = title; this.config = config; raised.push(this); }
    close() {}
  }
  CaptureNotification.permission = 'granted';
  CaptureNotification.requestPermission = () => Promise.resolve('granted');
  const b = bootBundle({
    extend(sandbox, windowStub) {
      // bootBundle only wires its own stub for withNotification, and that one
      // keeps the last toast alone; this case needs every toast.
      sandbox.Notification = CaptureNotification;
      windowStub.Notification = CaptureNotification;
    },
  });
  b.mod.apply({ effect(fn) { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {}; } });
  const api = b.win.__dshNotifyMe;
  api.test('done');
  api.test('done');
  api.test('done');
  api.test('approval');

  const doneTags = raised.slice(0, 3).map((n) => n.config.tag);
  assert(doneTags.length === 3, 'three plain toasts were raised, got ' + raised.length);
  assert(new Set(doneTags).size === 3, 'same-kind toasts get distinct tags, got ' + doneTags.join(', '));
  assert(doneTags.every((tag) => /^dsh-notify-me-done-\d+-\d+$/.test(tag)),
    'each tag keeps kind + counter + timestamp, got ' + doneTags.join(', '));
  const approvalTag = raised[3] && raised[3].config.tag;
  assert(typeof approvalTag === 'string' && approvalTag.indexOf('dsh-notify-me-attention-') === 0,
    'approval toast keeps the stable attention tag that closeNotificationTag() looks up');
  console.log('toast tags OK: done=' + doneTags.join(' | ') + ' approval=' + approvalTag);
}

// ── issue #18: toast tags must fit the platform's 64-character limit ───────
// Windows refuses a toast whose final tag — Chromium spells it
// "n#<origin>#<tag>" — is longer than 64 characters. The desktop page's
// dsh-app://app origin takes 16 of them and the approval test's tag was 51, so
// 67 in total: the constructor threw, showToast() swallowed it, and the settings
// page had already printed "sent". Every tag now goes through toastTag(), which
// spends whatever the origin leaves.
function toastTagLimits() {
  console.log('\n— toast tags fit the platform tag limit (issue #18) —');
  const raised = [];
  class CaptureNotification {
    constructor(title, config) { this.title = title; this.config = config; raised.push(this); }
    close() {}
  }
  CaptureNotification.permission = 'granted';
  CaptureNotification.requestPermission = () => Promise.resolve('granted');
  // The origin is part of the platform's tag, so the budget is per origin: boot
  // the desktop one first, which is what the report was about.
  const bootAt = (origin) => bootBundle({
    withNotification: true,
    extend(sandbox, windowStub) {
      sandbox.location = { origin };
      sandbox.Notification = CaptureNotification;
      windowStub.Notification = CaptureNotification;
    },
  });

  const DESKTOP_ORIGIN = 'dsh-app://app';
  const desktopBudget = 64 - 3 - DESKTOP_ORIGIN.length;
  const desktop = bootAt(DESKTOP_ORIGIN);
  const host = buildHost({ withSessionStatus: true });
  desktop.doc.hidden = true; desktop.doc.visibilityState = 'hidden';
  desktop.mod.apply(host.ctx);
  const api = desktop.win.__dshNotifyMe;
  assert(api.debug().notifyTagBudget === desktopBudget,
    'the desktop origin leaves ' + desktopBudget + ' tag characters, got ' + api.debug().notifyTagBudget);

  // 1) the reported case: the approval test button
  raised.length = 0;
  api.test('approval');
  const testTag = raised[0] && raised[0].config.tag;
  assert(testTag && testTag.length <= desktopBudget,
    'the approval test tag fits the desktop budget, got ' + testTag);
  assert(/^dsh-notify-me-attention-t[0-9a-z]+$/.test(testTag),
    'the approval test keeps the attention prefix and a short key, got ' + testTag);
  assert(testTag.indexOf('test:approval:') === -1, 'the 51-character test key is gone');

  // 2) a real interaction key far longer than the budget is cut, not refused
  const longKey = 'approval:' + 'k'.repeat(90);
  const answerable = () => {};
  host.setStatus(new Map([['s1', statusRow(approval(longKey, { answer: answerable }))]]));
  host.notifyStatus();
  const longTag = raised[raised.length - 1].config.tag;
  assert(longTag.length <= desktopBudget,
    'a long interaction key is cut to the budget, got ' + longTag.length + ' chars');
  assert(longTag.indexOf('dsh-notify-me-attention-') === 0,
    'the readable prefix survives the cut, got ' + longTag);
  assert(longTag !== 'dsh-notify-me-attention-' + longKey, 'the raw key is never used as the tag');
  assert(/^dsh-notify-me-attention-.+-[0-9a-z]{1,7}$/.test(longTag),
    'a cut tag ends with the FNV-1a base36 tail, got ' + longTag);

  // 3) truncation must not merge two different waits into one tag
  host.setStatus(new Map([['s1', statusRow(null)]]));
  host.notifyStatus();
  host.setStatus(new Map([['s1', statusRow(approval('approval:' + 'j'.repeat(90), { answer: answerable }))]]));
  host.notifyStatus();
  const otherTag = raised[raised.length - 1].config.tag;
  assert(otherTag !== longTag, 'two long keys keep distinct tags, got ' + otherTag);
  host.setStatus(new Map([['s1', statusRow(null)]]));
  host.notifyStatus();
  for (const c of [...host.cleanups]) c();

  // 4) a longer web origin shrinks the budget and the tag with it
  const WEB_ORIGIN = 'http://192.168.100.200:13555';
  const webBudget = 64 - 3 - WEB_ORIGIN.length;
  const web = bootAt(WEB_ORIGIN);
  const webHost = buildHost({ withSessionStatus: true });
  web.doc.hidden = true; web.doc.visibilityState = 'hidden';
  web.mod.apply(webHost.ctx);
  const webApi = web.win.__dshNotifyMe;
  assert(webApi.debug().notifyTagBudget === webBudget,
    'a ' + WEB_ORIGIN.length + '-character web origin leaves ' + webBudget + ', got ' + webApi.debug().notifyTagBudget);
  raised.length = 0;
  webHost.setStatus(new Map([['s1', statusRow(approval('approval:101', { answer: answerable }))]]));
  webHost.notifyStatus();
  const webTag = raised[0] && raised[0].config.tag;
  assert(webTag && webTag.length <= webBudget,
    'the same approval tag shrinks to the web budget, got ' + webTag);
  assert(webTag.length < 'dsh-notify-me-attention-approval:101'.length,
    'the web case really did have to cut it, got ' + webTag);
  for (const c of [...webHost.cleanups]) c();

  // 5) a platform refusal is recorded instead of vanishing
  const REFUSAL = 'The size of the notification tag is too large';
  function RefusingNotification() { throw new Error(REFUSAL); }
  RefusingNotification.permission = 'granted';
  RefusingNotification.requestPermission = () => Promise.resolve('granted');
  const refusing = bootBundle({
    withNotification: true,
    extend(sandbox, windowStub) {
      sandbox.Notification = RefusingNotification;
      windowStub.Notification = RefusingNotification;
    },
  });
  const rhost = buildHost({ withUiSession: false });
  refusing.mod.apply(rhost.ctx);
  const said = refusing.win.__dshNotifyMe.test('approval');
  const rejected = refusing.win.__dshNotifyMe.debug().lastToastReject;
  assert(rejected && rejected.message === REFUSAL,
    'debug() keeps the last platform refusal, got ' + JSON.stringify(rejected));
  assert(rejected.length <= desktopBudget,
    'the refusal records the tag length it tried, got ' + rejected.length);
  assert(said.indexOf('refused=' + REFUSAL) !== -1,
    'api.test() reports the refusal instead of claiming delivery, got ' + said);
  for (const c of [...rhost.cleanups]) c();

  // 6) the settings page reports the refusal instead of "sent"
  const settings = settingsBoot(null, null, {
    withNotification: true,
    seed(sandbox) {
      sandbox.Notification = RefusingNotification;
      sandbox.window.Notification = RefusingNotification;
    },
  });
  const testButton = settings.find((n) => n.props && typeof n.props.onClick === 'function'
    && Array.isArray(n.children) && n.children[0] === '测试「审批按钮」');
  assert(testButton, 'the approval test button renders');
  testButton.props.onClick();
  const feedback = settings.renderNow();
  assert(feedback.indexOf('系统拒收了这条通知：' + REFUSAL) !== -1,
    'the settings page reports the refusal, got ' + feedback);
  assert(feedback.indexOf('已发送测试提醒') === -1, 'no "sent" feedback survives a refusal');
  settings.cleanup();

  console.log('toast tag limits OK: desktop budget=' + desktopBudget + ' test=' + testTag
    + ' long=' + longTag + ' web=' + webTag + ' refused=' + rejected.message);
}

// ── settings page: the new rows actually render ───────────────────────────
// Hook state is kept per index and survives re-renders, the way React keeps it,
// so a case can press a control and then read the copy the press produced.
function makeFakeReact() {
  const hooks = [];
  let cursor = 0;
  return {
    createElement(type, props) {
      const children = [];
      for (let i = 2; i < arguments.length; i++) children.push(arguments[i]);
      return { type, props: props || {}, children };
    },
    useState(init) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof init === 'function' ? init() : init;
      return [hooks[i], (n) => { hooks[i] = (typeof n === 'function') ? n(hooks[i]) : n; }];
    },
    useSyncExternalStore() { return { active: 'zh' }; },
    // test-only: rewind the hook cursor for the next render pass
    __beforeRender() { cursor = 0; },
  };
}
function collectText(node, out) {
  out = out || [];
  if (node == null || node === false || node === true) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) collectText(n, out); return out; }
  if (node.children) for (const c of node.children) collectText(c, out);
  return out;
}

// Renders the Settings page once and returns the flattened text of the tree
// plus the tree itself, so a case can assert both copy and node shape. `opts`
// adds the toast/audio/fetch stands-ins a button-driving case needs.
function settingsBoot(seedConfig, seedSound, opts) {
  const registered = [];
  const injected = [];
  const fakeReact = makeFakeReact();
  let dict = null;
  const audio = makeAudioCapture();
  const b = bootBundle({
    withNotification: !!(opts && opts.withNotification),
    require: (name) => (name === 'react' ? fakeReact : {}),
    extend(sandbox, windowStub) {
      if (opts && opts.withAudio) {
        windowStub.AudioContext = audio.FakeAudioContext;
        sandbox.Audio = makeAudioElementCapture().FakeAudio;
      }
      if (opts && opts.fetch) sandbox.fetch = opts.fetch;
      if (opts && opts.seed) opts.seed(sandbox);
      if (seedConfig) sandbox.localStorage.setItem('dshNotifyMe.config', JSON.stringify(seedConfig));
      if (seedSound) sandbox.localStorage.setItem('dshNotifyMe.sound.done', JSON.stringify(seedSound));
    },
  });
  const host = buildHost({ withSessionStatus: true, withWorkspace: true });
  host.ctx.locale = {
    register(ns, d) { dict = d; return () => {}; },
    bind: () => (k) => (dict && dict.zh[k]) || k,
    subscribe: () => () => {},
    getSnapshot: () => ({ active: 'zh' }),
    getLocale: () => ({ active: 'zh' }),
  };
  host.ctx.slots = {
    inject(slot, fn) { injected.push(slot); fn(); },
    register(spec, comp) { const r = { spec, comp }; registered.push(r); return r; },
  };
  b.mod.apply(host.ctx);

  assert(injected.indexOf('settings.section') !== -1, 'settings.section was injected');
  const reg = registered.find((r) => r.spec && r.spec.id === 'dsh-notify-me');
  assert(reg, 'the settings section registered');
  let tree = null;
  const render = () => {
    fakeReact.__beforeRender();
    const el = reg.comp({});
    tree = el.type(el.props);
    return tree;
  };
  tree = render();
  const walk = (node, fn) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, fn); return; }
    fn(node);
    if (node.children) for (const c of node.children) walk(c, fn);
  };
  const pressAria = (aria) => {
    let hit = null;
    walk(tree, (n) => { if (!hit && n.props && n.props['aria-label'] === aria) hit = n; });
    assert(hit, 'no rendered control labelled ' + aria);
    hit.props.onClick();
    render();
  };
  // The page collapses its rarely-touched half (sound sources, external
  // forwarding, runtime) behind one toggle; tests that assert on those rows
  // have to open it the way a user would.
  if (opts && opts.advanced) pressAria((dict && dict.zh.advanced) || '高级设置');
  return {
    text: collectText(tree).join(' | '),
    get tree() { return tree; },
    audio,
    lastNotification: b.lastNotification,
    textNow: () => collectText(tree).join(' | '),
    // Re-render on demand — some feedback (a test button's send verdict) lands
    // asynchronously, after the press() that triggered it.
    renderNow: () => { render(); return collectText(tree).join(' | '); },
    walk,
    // current-tree node lookup (a getter-based tree keeps this honest across
    // re-renders)
    find: (pred) => { let hit = null; walk(tree, (n) => { if (!hit && pred(n)) hit = n; }); return hit; },
    findAll: (pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n); }); return out; },
    // The dictionaries the page registered, so a case can assert both languages
    // define the copy it renders (CONTRIBUTING: never ship one side only).
    dictNow: () => dict,
    configNow: () => b.win.__dshNotifyMe.config,
    debugNow: () => b.win.__dshNotifyMe.debug(),
    apiNow: () => b.win.__dshNotifyMe,
    // Press the exact control the user presses, then re-render the way React
    // would, so the feedback the press produced is readable.
    press: pressAria,
    cleanup: () => { for (const c of [...host.cleanups]) c(); },
  };
}

function settingsSoundRows() {
  console.log('\n— settings page: alert sound source rows —');

  const boot = settingsBoot;

  // 1) defaults: both kinds expose the source selector, no file picker yet.
  const base = boot(null, null, { advanced: true });
  assert(base.text.indexOf('音效来源') !== -1, 'the sound-source header renders');
  assert(base.text.indexOf('「回复完成」的声音') !== -1, 'the done-kind row renders');
  assert(base.text.indexOf('「需要你」的声音') !== -1, 'the attention-kind row renders');
  assert(base.text.indexOf('内置合成音（默认）') !== -1, 'the built-in option renders');
  assert(base.text.indexOf('自定义音频文件') !== -1, 'the custom option renders');
  assert(base.text.indexOf('系统通知音（系统播放）') !== -1, 'the system option renders');
  assert(base.text.indexOf('选择音频文件') === -1, 'no file picker while the source is the built-in cue');
  assert(base.text.indexOf('插件版本：dsh-notify-me v' + PKG_VERSION) !== -1, 'the version line still renders');
  assert(base.tree.type === 'div' && base.tree.props.className === 'dnm-wrap', 'root node shape unchanged');
  base.cleanup();

  // 2) custom with a file stored: the picker row appears and names the file, so
  //    "which file is this actually playing" is answerable from the page.
  const custom = boot({ soundDone: 'custom' }, { name: 'Windows Notify System Generic.wav', size: 193940, data: PICKED_WAV }, { advanced: true });
  assert(custom.text.indexOf('选择音频文件') !== -1, 'the file picker appears for the custom source');
  assert(custom.text.indexOf('Windows Notify System Generic.wav') !== -1, 'the stored file is named on the page');
  assert(custom.text.indexOf(Math.round(193940 / 1024) + ' KB') !== -1, 'the stored file size is shown');
  custom.cleanup();

  // 3) custom with nothing stored still renders (and says so) rather than
  //    collapsing the row.
  const empty = boot({ soundAttention: 'custom' }, null, { advanced: true });
  assert(empty.text.indexOf('选择音频文件') !== -1, 'the picker renders before any file is picked');
  assert(empty.text.indexOf('尚未选择文件') !== -1, 'the empty state is spelled out');
  empty.cleanup();

  // 4) pressing the "system" row's preview must not be a silent no-op: there is
  //    no plugin cue to play in that mode, so the button has to raise a real,
  //    un-silenced test alert instead (otherwise it reads as broken).
  const sys = boot({ soundDone: 'system' }, null, { withNotification: true, withAudio: true, advanced: true });
  sys.press('试听「回复完成」音效');
  assert(sys.audio.tones.length === 0, 'the system preview plays no built-in tone');
  assert(sys.lastNotification(), 'the system preview raised a toast');
  assert(sys.lastNotification().config.silent === false, 'the system preview toast is un-silenced so the OS chimes');
  assert(sys.textNow().indexOf('已发一条测试提醒') !== -1, 'the system preview says a test alert was sent');
  sys.cleanup();

  console.log('settings sound rows OK: both kinds expose the source selector, picker only for custom, system preview fires a toast');
}

// ── 一次列表变化里「当前会话」只推导一次 ────────────────────────────
// 每一行的判定都要知道「哪个会话在屏幕上」,而 currentSessionId() 在 0.1.6+ 的
// 宿主上要遍历整份 byId(没有 `current` 了)。行内的判定各自再推导一次,一次
// 列表变化就是 O(行数 × 会话数):实测 0.2.0-rc.2、482 个会话、页面空闲时,
// 这个函数占 CPU profile 自身耗时的 5.9%~6.5%,是该页面最热的 JS 函数。
// 断言不靠计时:数 byId 被 for-in 枚举了几次(推导一次 = 枚举一次)。
function listChangeEnumerations(rows) {
  const b = bootBundle();
  const host = buildHost({ withSessionStatus: true });
  b.mod.apply(host.ctx);
  const byId = {};
  for (let i = 1; i < rows; i += 1) byId['s' + i] = { displayTitle: '后台 ' + i, retainedBy: {} };
  // 主视图那一行放最后:兜底推导循环要走满全表才找得到它(最坏位置)
  byId['cur'] = { displayTitle: '当前会话', retainedBy: { mainView: 1 } };
  let enumerations = 0;
  const counted = new Proxy(byId, {
    ownKeys(target) { enumerations += 1; return Reflect.ownKeys(target); },
  });
  // 0.2.0-rc.2 形状:快照没有 `current`,当前会话由 retainedBy.mainView 推导
  host.setList({ ids: Object.keys(byId), byId: counted, phase: 'ready' });
  enumerations = 0;
  host.notifyList();
  for (const c of [...host.cleanups]) c();
  return enumerations;
}

async function listChangeDerivation() {
  console.log('\n— list-change work does not grow with the row count —');
  const small = listChangeEnumerations(4);
  const large = listChangeEnumerations(40);
  assert(small === large,
    'one list change must cost the same for 4 and 40 rows, got ' + small + ' vs ' + large + ' byId enumerations');
  console.log('list-change derivation OK: byId enumerated ' + small + ' time(s) for 4 rows and ' + large + ' for 40 (constant)');
}

// ── 外部通知转发（webhook） ─────────────────────────────────────────
// 转发链路的承诺只有几条：默认全关、不填端点就什么都不发；测试按钮发的是测试
// 消息而不是假提醒；每类提醒的转发开关只拦真实提醒；每种服务用它自己的报文
// 形状（含两种加签）；CORS 被拒时降级 no-cors 送出并如实标「不可确认」；
// 可重试的错误按退避重试、彻底失败进死信记录，不可重试的错误立即停。
async function externalWebhooks() {
  console.log('\n— external webhook forwarding —');
  const flush = () => new Promise((r) => setImmediate(r));

  // A fetch stand-in recording every call; `behavior` answers (or throws).
  // The page GETs its host-bridge probe route at boot; that belongs to the
  // hostBridgeLease case, so the assertions below count everything else (Bark's
  // delivery fallback is a GET too, and stays in).
  const isProbe = (c) => c.opts.method === 'GET' && c.url === HOST_BRIDGE_ROUTE;
  // A live probe-blind view. The cases reset the log with `.length = 0`, so the
  // view stays array-shaped: records are re-filtered from the underlying spy on
  // every read, and a reset skips everything recorded so far (the log only
  // grows).
  function hookCalls(list) {
    var out = [];
    var dropped = 0;
    var rebuild = function () {
      out.length = 0;
      for (var i = dropped; i < list.length; i++) if (!isProbe(list[i])) out.push(list[i]);
    };
    return new Proxy(out, {
      get: function (t, key) {
        if (key === 'length') { rebuild(); return out.length; }
        if (typeof key === 'string' && /^\d+$/.test(key)) { rebuild(); return out[Number(key)]; }
        return t[key];
      },
      set: function (t, key, value) {
        if (key === 'length') { dropped = list.length; out.length = 0; return true; }
        t[key] = value;
        return true;
      }
    });
  }
  function fetchSpy(behavior) {
    const calls = [];
    const fn = (url, opts) => {
      const rec = { url: String(url), opts: opts || {}, body: String((opts && opts.body) || '') };
      calls.push(rec);
      try {
        return Promise.resolve(behavior(rec));
      } catch (e) {
        return Promise.reject(e);
      }
    };
    return { calls, fn };
  }
  function bootWeb(behavior, seed) {
    const spy = fetchSpy(behavior || (() => ({ ok: true, status: 204 })));
    const b = bootBundle({
      extend(sandbox) {
        sandbox.fetch = spy.fn;
        if (seed) sandbox.localStorage.setItem('dshNotifyMe.config', JSON.stringify(seed));
      },
    });
    const host = buildHost({ withSessionStatus: true });
    b.mod.apply(host.ctx);
    // `allCalls` is the raw log (a case needs to see the probe itself);
    // `calls` is the probe-blind view the webhook assertions count.
    return { b, host, allCalls: spy.calls, calls: hookCalls(spy.calls), win: b.win };
  }

  // 1) defaults: off, no targets, and the debug block tells the same story.
  const base = bootWeb();
  const d0 = base.win.__dshNotifyMe.debug().external;
  assert(d0.enabled === false && d0.targets === 0 && d0.activeTargets === 0,
    'external forwarding defaults off with no targets, got ' + JSON.stringify(d0));
  assert(d0.sent === 0 && d0.unverified === 0 && d0.failed === 0, 'the counters start at zero');
  const r0 = await base.win.__dshNotifyMe.testExternal();
  assert(r0.sent === 0 && r0.statuses.length === 0, 'testExternal with no targets resolves empty');
  assert(base.calls.length === 0, 'nothing is sent without targets');

  // 2) the toast test path never pings: test alerts deliver locally and must
  //    not leak to webhooks even with everything armed.
  const armed = bootWeb(null, {
    externalEnabled: true,
    externalTargets: [
      { id: 't1', type: 'custom', url: 'https://hook.example/x' },
      { id: 't2', type: 'discord', url: 'https://discord.com/api/webhooks/1/y' },
    ],
  });
  armed.win.__dshNotifyMe.test('done');
  assert(armed.calls.length === 0, 'a toast test sends no webhook');

  // 3) testExternal hits every target with that service's payload shape.
  const r1 = await armed.win.__dshNotifyMe.testExternal();
  assert(r1.sent === 2 && r1.failed === 0, 'both targets report sent, got ' + JSON.stringify(r1));
  assert(armed.calls.length === 2, 'one POST per target');
  const customCall = armed.calls.find((c) => c.url === 'https://hook.example/x');
  const custom = JSON.parse(customCall.body);
  assert(custom.source === 'dsh-notify-me' && custom.event === 'attention' && custom.title === '外部通知测试',
    'custom payload shape, got ' + JSON.stringify(custom));
  assert(custom.sessionId !== undefined && !!custom.time, 'custom payload carries sessionId + time');
  const discord = JSON.parse(armed.calls.find((c) => c.url.indexOf('discord.com') !== -1).body);
  assert(discord.username === 'DSH' && discord.content.indexOf('外部通知测试') === 0,
    'discord payload shape, got ' + JSON.stringify(discord));
  assert(armed.calls.every((c) => c.opts.mode === 'cors' && String(c.opts.headers['Content-Type']) === 'application/json'),
    'first attempts are CORS JSON POSTs');
  const d1 = armed.win.__dshNotifyMe.debug().external;
  assert(d1.sent === 2 && d1.targets === 2 && d1.activeTargets === 2, 'debug tallies the sends');

  // 3b) a custom target naming the relay's own upstream gateway is folded onto
  //     the same-origin relay route. Straight at that gateway the browser has
  //     no reachable verdict at all (Basic auth -> a preflight the gateway
  //     answers without Access-Control-Allow-*; the opaque fallback -> a
  //     cross-site POST the gateway refuses), which is how a lost alert used to
  //     read as "sent, unconfirmed" while the phone stayed silent.
  const GATEWAY = 'https://gateway.example';
  const RELAY = '/__notify-relay/testtoken';
  const relayProbe = (rec) => rec.opts.method === 'GET' && rec.url === HOST_BRIDGE_ROUTE;
  const bridgeAnswer = (relay) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true, hostFallback: { enabled: false, leaseMs: 60000 }, relay: relay }),
  });
  const RELAY_ON = { enabled: true, path: RELAY, upstreamHost: 'gateway.example' };
  const RELAY_OFF = { enabled: false, path: null, upstreamHost: null };
  const folded = bootWeb((rec) => {
    if (relayProbe(rec)) return bridgeAnswer(RELAY_ON);
    return { ok: true, status: 200, text: () => Promise.resolve('{"ok":true,"upstreamStatus":200}') };
  }, { externalEnabled: true, externalTargets: [{ id: 't1', type: 'custom', url: GATEWAY + '/notify/KEY' }] });
  await flush();
  folded.calls.length = 0;
  const rFold = await folded.win.__dshNotifyMe.testExternal();
  assert(rFold.sent === 1 && rFold.unverified === 0 && rFold.failed === 0,
    'a folded gateway target reports a real sent, got ' + JSON.stringify(rFold));
  assert(folded.calls.length === 1, 'one POST for the folded target, got ' + folded.calls.length);
  assert(folded.calls[0].url === RELAY,
    'the folded target is posted to the same-origin relay path, got ' + folded.calls[0].url);
  assert(folded.calls[0].opts.mode !== 'no-cors', 'the folded request is not an opaque one');
  const foldBody = JSON.parse(folded.calls[0].body);
  assert(foldBody.source === 'dsh-notify-me' && foldBody.title === '外部通知测试' && typeof foldBody.body === 'string',
    'the folded payload keeps the custom shape and the copy, got ' + JSON.stringify(foldBody));
  const foldHealth = folded.win.__dshNotifyMe.debug().external.health.t1;
  assert(foldHealth && foldHealth.status === 'sent',
    'the folded delivery is recorded as sent, got ' + JSON.stringify(foldHealth));

  // 3c) a target on another host is never folded: the relay forwards to its own
  //     gateway and nowhere else, so folding would deliver to the wrong place.
  const elsewhere = bootWeb((rec) => {
    if (relayProbe(rec)) return bridgeAnswer(RELAY_ON);
    return { ok: true, status: 204 };
  }, { externalEnabled: true, externalTargets: [{ id: 't1', type: 'custom', url: 'https://other.example/x' }] });
  await flush();
  elsewhere.calls.length = 0;
  await elsewhere.win.__dshNotifyMe.testExternal();
  assert(elsewhere.calls.length === 1 && elsewhere.calls[0].url === 'https://other.example/x',
    'a target on another host keeps its own address, got ' + JSON.stringify(elsewhere.calls.map((c) => c.url)));

  // 3d) without an enabled relay there is nothing to fold onto: the target is
  //     posted as configured, and the opaque fallback is reported as unverified
  //     *with its reason* — the settings row has to say which of the two it was.
  const opaque = bootWeb((rec) => {
    if (relayProbe(rec)) return bridgeAnswer(RELAY_OFF);
    if (rec.opts.mode === 'no-cors') return { ok: false, status: 0 };
    throw new TypeError('Failed to fetch');
  }, { externalEnabled: true, externalTargets: [{ id: 't1', type: 'custom', url: 'https://cross.example/x' }] });
  await flush();
  opaque.calls.length = 0;
  const rOpaque = await opaque.win.__dshNotifyMe.testExternal();
  assert(rOpaque.unverified === 1 && rOpaque.sent === 0,
    'a refused CORS exchange lands on unverified, got ' + JSON.stringify(rOpaque));
  assert(opaque.calls[opaque.calls.length - 1].url === 'https://cross.example/x',
    'an unfolded target is posted to its own address, got ' + opaque.calls[opaque.calls.length - 1].url);
  const opaqueHealth = opaque.win.__dshNotifyMe.debug().external.health.t1;
  assert(opaqueHealth && opaqueHealth.status === 'unverified' && opaqueHealth.reason === 'opaque',
    'the unverified verdict carries its reason, got ' + JSON.stringify(opaqueHealth));

  // 4) real alerts mirror through fire(); the per-kind toggles gate only them.
  armed.calls.length = 0;
  const host = armed.host;
  const doc = armed.b.doc;
  doc.hidden = true; doc.visibilityState = 'hidden';
  host.setList({ ids: ['s2'], byId: { s2: { running: true, displayTitle: '后台任务', retainedBy: {} } }, phase: 'ready' });
  host.notifyList();
  host.setStatus(new Map([['s2', statusRow(question('question:901', { sessionId: 's2' }))]]));
  host.notifyStatus();
  await flush();
  assert(armed.calls.length === 2, 'a delivered attention alert mirrors to both targets, got ' + armed.calls.length);
  const mirrored = JSON.parse(armed.calls[0].body);
  assert(mirrored.event === 'attention' && mirrored.title === 'DSH · 提问',
    'the mirror carries the real alert copy, got ' + JSON.stringify(mirrored));

  armed.win.__dshNotifyMe.setConfig({ externalAttention: false });
  armed.calls.length = 0;
  host.setStatus(new Map([['s2', statusRow(question('question:902', { sessionId: 's2' }))]]));
  host.notifyStatus();
  await flush();
  assert(armed.calls.length === 0, 'externalAttention:false silences the mirror');
  assert(armed.b.events.some((e) => e.kind === 'attention'), 'the local alert still fired');

  // done alerts de-dupe within 250ms; pace the two done cases past the window.
  await new Promise((r) => setTimeout(r, 300));
  armed.win.__dshNotifyMe.setConfig({ externalAttention: true, externalDone: false });
  armed.calls.length = 0;
  host.setStatus(new Map([['s2', statusRow(null, { running: false, completionUnread: true })]]));
  host.notifyStatus();
  await flush();
  assert(armed.calls.length === 0, 'externalDone:false silences the done mirror');

  await new Promise((r) => setTimeout(r, 300));
  armed.win.__dshNotifyMe.setConfig({ externalDone: true });
  armed.calls.length = 0;
  host.setStatus(new Map([['s2', statusRow(null, { running: false, completionUnread: false })]]));
  host.notifyStatus();
  host.setStatus(new Map([['s2', statusRow(null, { running: false, completionUnread: true })]]));
  host.notifyStatus();
  await flush();
  assert(armed.calls.length === 2, 'a done alert mirrors to both targets, got ' + armed.calls.length);
  const doneMirror = JSON.parse(armed.calls[0].body);
  assert(doneMirror.event === 'done', 'the done mirror is labelled as such, got ' + JSON.stringify(doneMirror));

  // master switch: even a delivered alert sends nothing while it is off.
  await new Promise((r) => setTimeout(r, 300));
  armed.win.__dshNotifyMe.setConfig({ externalEnabled: false });
  armed.calls.length = 0;
  host.setStatus(new Map([['s2', statusRow(question('question:903', { sessionId: 's2' }))]]));
  host.notifyStatus();
  await flush();
  assert(armed.calls.length === 0, 'the master switch stops all forwarding');

  // 5) a rejecting CORS call falls back to a no-cors POST: still delivered,
  //    reported honestly as unverifiable.
  const cors = bootWeb((rec) => {
    if (rec.opts.mode === 'cors') throw new TypeError('Failed to fetch');
    return { ok: true, status: 204 };
  }, { externalEnabled: true, externalTargets: [{ id: 't1', type: 'custom', url: 'https://hook.example/x' }] });
  const r2 = await cors.win.__dshNotifyMe.testExternal();
  assert(r2.unverified === 1 && r2.sent === 0, 'the opaque fallback counts unverified, got ' + JSON.stringify(r2));
  assert(cors.calls.length === 2 && cors.calls[1].opts.mode === 'no-cors', 'the fallback is a no-cors POST');
  assert(String(cors.calls[1].opts.headers['Content-Type']).indexOf('text/plain') === 0,
    'the fallback switches to text/plain (a simple request)', );

  // 6) a 5xx answer is worth retrying: two more attempts, then the delivery is
  //    recorded as a dead letter instead of vanishing. Delays are seeded to 0
  //    so the test doesn't sit out the production backoff.
  const http = bootWeb(() => ({ ok: false, status: 500 }), {
    externalEnabled: true,
    externalRetryDelays: [0, 0],
    externalTargets: [{ id: 't1', type: 'custom', url: 'https://hook.example/x' }],
  });
  const r3 = await http.win.__dshNotifyMe.testExternal();
  assert(r3.failed === 1 && r3.statuses[0] === 'failed (HTTP 500)', 'HTTP errors are reported, got ' + JSON.stringify(r3));
  assert(http.calls.length === 3, 'a 500 is retried twice, got ' + http.calls.length + ' attempts');
  const d3 = http.win.__dshNotifyMe.debug().external;
  assert(d3.retried === 1, 'the retry is counted, got ' + d3.retried);
  assert(d3.deadLetters === 1, 'the final failure becomes a dead letter, got ' + d3.deadLetters);
  const dead = d3.deadLettersLog[0];
  assert(dead && dead.status === 'failed (HTTP 500)' && dead.attempts === 3, 'the dead letter records why and how often, got ' + JSON.stringify(dead));
  assert(dead.host === 'hook.example', 'the dead letter keeps the host, not the secret path, got ' + dead.host);
  assert(d3.health.t1 && d3.health.t1.status === 'failed (HTTP 500)', 'the target health remembers the verdict');
  http.win.__dshNotifyMe.resetConfig();
  assert(http.win.__dshNotifyMe.debug().external.deadLetters === 0, 'resetConfig empties the dead-letter log');

  // 6b) a 4xx is the service saying no: retrying would only spam it.
  const denied = bootWeb(() => ({ ok: false, status: 403 }), {
    externalEnabled: true,
    externalRetryDelays: [0, 0],
    externalTargets: [{ id: 't1', type: 'custom', url: 'https://hook.example/x' }],
  });
  const r3b = await denied.win.__dshNotifyMe.testExternal();
  assert(r3b.failed === 1 && denied.calls.length === 1, 'a 4xx is final, got ' + denied.calls.length + ' attempts');

  // 6c) a network blip is retried and the retry can win.
  let flaky = 0;
  const retryOk = bootWeb((rec) => {
    // The boot probe is answered without touching the counter, so the first
    // webhook attempt is the one that fails.
    if (rec.url === HOST_BRIDGE_ROUTE) return { ok: true, status: 200, json: () => Promise.resolve({}) };
    flaky++;
    // Both modes of the first attempt fail; the second attempt is readable.
    if (flaky <= 2) throw new TypeError('Failed to fetch');
    return { ok: true, status: 204 };
  }, {
    externalEnabled: true,
    externalRetryDelays: [0, 0],
    externalTargets: [{ id: 't1', type: 'custom', url: 'https://hook.example/x' }],
  });
  const r3c = await retryOk.win.__dshNotifyMe.testExternal();
  assert(r3c.sent === 1, 'the retried delivery succeeds, got ' + JSON.stringify(r3c));
  assert(retryOk.calls.length === 3, 'a dropped connection is retried, got ' + retryOk.calls.length + ' calls');

  // 6d) switching forwarding off stops a retry that is already on a timer.
  const cancel = bootWeb(() => ({ ok: false, status: 500 }), {
    externalEnabled: true,
    externalRetryDelays: [30, 30],
    externalTargets: [{ id: 't1', type: 'custom', url: 'https://hook.example/x' }],
  });
  cancel.b.doc.hidden = true;
  cancel.b.doc.visibilityState = 'hidden';
  cancel.host.setList({ ids: ['s9'], byId: { s9: { running: true, displayTitle: '后台任务', retainedBy: {} } }, phase: 'ready' });
  cancel.host.notifyList();
  cancel.host.setStatus(new Map([['s9', statusRow(question('question:904', { sessionId: 's9' }))]]));
  cancel.host.notifyStatus();
  await flush();
  assert(cancel.calls.length === 1, 'the first attempt went out, got ' + cancel.calls.length);
  cancel.win.__dshNotifyMe.setConfig({ externalEnabled: false });
  await new Promise((r) => setTimeout(r, 200));
  assert(cancel.calls.length === 1, 'no retry after forwarding is switched off, got ' + cancel.calls.length);
  const dc = cancel.win.__dshNotifyMe.debug().external;
  assert(dc.failed === 0 && dc.deadLetters === 0,
    'a cancelled delivery is not recorded as a failure, got failed=' + dc.failed + ' dead=' + dc.deadLetters);

  // 6e) a 2xx whose body is not the service JSON cannot confirm delivery.
  const html = bootWeb(() => ({
    ok: true,
    status: 200,
    text: () => Promise.resolve('<html>proxy interstitial</html>'),
  }), {
    externalEnabled: true,
    externalTargets: [{ id: 't1', type: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/KEY' }],
  });
  const rHtml = await html.win.__dshNotifyMe.testExternal();
  assert(rHtml.unverified === 1 && rHtml.sent === 0,
    'a 2xx without the service JSON is unverified, got ' + JSON.stringify(rHtml));

  // 7) bark gets its third chance in the classic GET shape.
  const bark = bootWeb((rec) => {
    if (rec.opts.method === 'GET') {
      if (rec.opts.mode !== 'no-cors') throw new TypeError('Failed to fetch');
      return { ok: true, status: 204 };
    }
    throw new TypeError('Failed to fetch');
  }, { externalEnabled: true, externalTargets: [{ id: 't1', type: 'bark', url: 'https://api.day.app/KEY' }] });
  const r4 = await bark.win.__dshNotifyMe.testExternal();
  assert(r4.unverified === 1, 'bark falls back to the GET shape, got ' + JSON.stringify(r4));
  const barkGet = bark.allCalls.filter((c) => c.opts.method === 'GET' && c.url.indexOf(HOST_BRIDGE_ROUTE) !== 0).pop();
  assert(barkGet && barkGet.url.indexOf('https://api.day.app/KEY/') === 0 && barkGet.url.split('/').length > 4,
    'the GET carries title/body in the path, got ' + (barkGet && barkGet.url));

  // 8) stale entries are pruned, not fatal: bad URLs never leave the browser.
  const bad = bootWeb(null, {
    externalEnabled: true,
    externalTargets: [
      { id: 't1', type: 'custom', url: 'javascript:alert(1)' },
      { id: 't2', type: 'weird-type', url: 'https://hook.example/ok' },
    ],
  });
  const d2 = bad.win.__dshNotifyMe.debug().external;
  assert(d2.targets === 2 && d2.activeTargets === 1, 'invalid URLs are pruned, unknown types coerce to custom');
  const r5 = await bad.win.__dshNotifyMe.testExternal();
  assert(r5.statuses.length === 1 && bad.calls.length === 1, 'only the valid target is contacted');
  assert(JSON.parse(bad.calls[0].body).source === 'dsh-notify-me', 'the coerced target gets the custom payload');

  // 9) each service gets its own ABI — and both signing schemes can be
  //    re-computed from the outgoing bytes, which is exactly what the
  //    receiving side will do.
  const crypto = require('crypto');
  const SECRET = 'SIGN-SECRET';
  // WxPusher answers code 1000 on success, the others code 0; the verdict now
  // actually reads these (postOnce used to lose the target type), so the stub
  // has to answer like the services do.
  const multi = bootWeb((rec) => ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(rec.url.indexOf('wxpusher') !== -1 ? '{"code":1000}' : '{"code":0}'),
  }), {
    externalEnabled: true,
    externalTargets: [
      { id: 'f', type: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/X', secret: SECRET },
      { id: 's', type: 'serverchan', url: 'https://sctapi.ftqq.com/KEY.send' },
      { id: 'w', type: 'wxpusher', token: 'AT_x', uid: 'UID_a,UID_b' },
      { id: 'c', type: 'custom', url: 'https://hook.example/x', secret: SECRET, template: '{{event}}: {{title}}' },
    ],
  });
  const r6 = await multi.win.__dshNotifyMe.testExternal();
  assert(r6.sent === 4 && r6.failed === 0, 'every target type reports sent, got ' + JSON.stringify(r6));

  const feishuCall = multi.calls.find((c) => c.url.indexOf('open.feishu.cn') !== -1);
  const feishu = JSON.parse(feishuCall.body);
  assert(feishu.msg_type === 'text' && feishu.content.text.indexOf('外部通知测试') === 0, 'feishu gets a text message, got ' + feishuCall.body);
  const feishuSign = crypto.createHmac('sha256', feishu.timestamp + '\n' + SECRET).update('').digest('base64');
  assert(feishu.sign === feishuSign, 'the feishu body signature verifies');
  assert(feishu.timestamp.length === 10, 'feishu timestamps are seconds, got ' + feishu.timestamp);

  const scCall = multi.calls.find((c) => c.url.indexOf('ftqq.com') !== -1);
  assert(String(scCall.opts.headers['Content-Type']).indexOf('application/x-www-form-urlencoded') === 0, 'serverchan posts a form');
  const scForm = decodeURIComponent(scCall.opts.body);
  assert(scCall.opts.body.indexOf('title=') === 0 && scForm.indexOf('desp=') !== -1, 'serverchan carries title and desp, got ' + scForm);

  const wpCall = multi.calls.find((c) => c.url.indexOf('wxpusher') !== -1);
  const wp = JSON.parse(wpCall.body);
  assert(wp.appToken === 'AT_x' && wp.contentType === 1, 'wxpusher carries the app token');
  assert(Array.isArray(wp.uids) && wp.uids.length === 2 && wp.uids[1] === 'UID_b', 'wxpusher splits the receiver UIDs, got ' + JSON.stringify(wp.uids));

  // 9b) a 200 carrying the service's own failure code is a failure, not a send:
  //     this is what a wrong Feishu token looks like from the page.
  const badToken = bootWeb(() => ({ ok: true, status: 200, text: () => Promise.resolve('{"code":19001,"msg":"param invalid"}') }), {
    externalEnabled: true,
    externalTargets: [{ id: 'f', type: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/X' }],
  });
  const rBad = await badToken.win.__dshNotifyMe.testExternal();
  assert(rBad.failed === 1 && rBad.statuses[0].indexOf('param invalid') !== -1,
    'a service-level error code is reported as failed, got ' + JSON.stringify(rBad));

  const cuCall = multi.calls.find((c) => c.url === 'https://hook.example/x');
  const cuBody = JSON.parse(cuCall.body);
  assert(cuBody.text === 'attention: 外部通知测试', 'the custom template renders {{event}}/{{title}}, got ' + cuBody.text);
  const expectSig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(cuCall.opts.body).digest('hex');
  assert(cuCall.opts.headers['X-DSH-Notify-Signature'] === expectSig, 'the custom signature covers the exact body sent');

  // 10) targets switch off one at a time, and a half-filled WxPusher target is
  //     inert rather than posting a request the service will reject.
  const offTarget = bootWeb(null, {
    externalEnabled: true,
    externalTargets: [
      { id: 'a', type: 'custom', url: 'https://hook.example/a', enabled: false },
      { id: 'b', type: 'custom', url: 'https://hook.example/b' },
      { id: 'c', type: 'wxpusher', token: 'AT_x' },
    ],
  });
  const d4 = offTarget.win.__dshNotifyMe.debug().external;
  assert(d4.targets === 3 && d4.activeTargets === 1, 'disabled and half-configured targets stay inactive, got ' + JSON.stringify(d4));

  console.log('external webhooks OK: gated mirroring, 7 payload shapes, signatures, retry/backoff, dead letters');
}

// ── 宿主侧兜底：页面租约（探针 / 心跳 / 释放） ──────────────────────
// 关了页面还能不能收到推送，靠的是一条租约：页面启动先 GET 探测宿主有没有
// 宿主侧兜底，只有回包说「有」才起心跳；宿主用租约新鲜度判断「页面还在」，
// 于是两边不会为同一条提醒各推一次。pagehide 立刻释放（keepalive 让请求在
// 卸载中也能发出去），页面重新可见时补探一次。这一组把时间轴换成可推进的假
// 时钟，心跳和复探的间隔才可断言。
function makeTestClock(sandbox) {
  const state = { now: 0, seq: 0, timers: [] };
  // Each timer carries an absolute next-fire time, so advancing 19.999 s and
  // then 1 ms more fires the 20 s interval exactly once — the timers have to
  // survive an advance that does not reach them.
  const arm = (fn, ms, once) => {
    const id = ++state.seq;
    state.timers.push({ id, fn, ms, once, at: state.now + ms });
    return id;
  };
  sandbox.setInterval = (fn, ms) => arm(fn, ms, false);
  sandbox.setTimeout = (fn, ms) => arm(fn, ms, true);
  sandbox.clearInterval = (id) => { state.timers = state.timers.filter((t) => t.id !== id); };
  sandbox.clearTimeout = sandbox.clearInterval;
  // Fire everything due within `ms`, advancing the clock by `ms`. One repeat
  // per timer per advance: the plugin's intervals are far apart.
  state.advance = (ms) => {
    const to = state.now + ms;
    const due = state.timers.filter((t) => t.at <= to);
    state.timers = state.timers.filter((t) => t.at > to);
    for (const t of due) {
      if (!t.once) state.timers.push({ ...t, at: t.at + t.ms });
      t.fn();
    }
    state.now = to;
    return due.length;
  };
  return state;
}

async function hostBridgeLease() {
  console.log('\n— host-side fallback: page lease (probe / heartbeat / release) —');
  const flush = () => new Promise((r) => setImmediate(r));
  // The probe body the host half answers with (design §4.1): only
  // hostFallback.enabled === true asks this page to hold a lease.
  const hostYes = () => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      ok: true,
      version: PKG_VERSION,
      features: ['page-bridge'],
      hostFallback: { enabled: true, leaseMs: 60000 },
      relay: { enabled: true, path: '/__dsh-notify-me/relay/abc123' },
      language: 'zh',
    }),
  });
  function bootBridge(behavior, opts) {
    const calls = [];
    let clock = null;
    const b = bootBundle({
      extend(sandbox) {
        sandbox.fetch = (url, req) => {
          calls.push({ url: String(url), opts: req || {}, body: String((req && req.body) || '') });
          try { return Promise.resolve(behavior(calls[calls.length - 1])); } catch (e) { return Promise.reject(e); }
        };
        clock = makeTestClock(sandbox);
        if (opts && opts.seed) opts.seed(sandbox);
      },
    });
    const host = buildHost({ withSessionStatus: true });
    b.mod.apply(host.ctx);
    return { b, host, calls, clock, win: b.win, api: b.win.__dshNotifyMe };
  }
  const probes = (calls) => calls.filter((c) => c.opts.method === 'GET');
  const beats = (calls) => calls.filter((c) => c.opts.method === 'POST');
  // A beat that claims the page is alive; the release is the same POST with
  // alive:false, so the two never get confused by a bare method filter.
  const aliveBeats = (calls) => beats(calls).filter((c) => JSON.parse(c.body).alive !== false);

  // 1) the host has a fallback: one probe at boot, one heartbeat, and the beat
  //    carries this page's language and external-forward state.
  const yes = bootBridge(hostYes);
  await flush();
  const p0 = probes(yes.calls);
  assert(p0.length === 1 && p0[0].url === HOST_BRIDGE_ROUTE,
    'boot probes the host bridge route exactly once, got ' + JSON.stringify(p0.map((c) => c.url)));
  const b0 = aliveBeats(yes.calls);
  assert(b0.length === 1, 'an enabled host starts the heartbeat at once, got ' + b0.length + ' beat(s)');
  assert(b0[0].url === HOST_BRIDGE_ROUTE, 'the beat posts to the bridge route, got ' + b0[0].url);
  assert(b0[0].opts.headers['x-dsh-notify-me-page'] === 'bridge',
    'the beat carries the page intent header, got ' + JSON.stringify(b0[0].opts.headers));
  assert(b0[0].opts.keepalive !== true, 'a running page beats without keepalive');
  const hb0 = JSON.parse(b0[0].body);
  const lang0 = yes.api.debug().language;
  assert(hb0.alive === true, 'the beat says alive, got ' + b0[0].body);
  assert(hb0.language === lang0, 'the beat language follows effectiveLang(), got ' + hb0.language + ' vs ' + lang0);
  // Exactly two fields, pinned by key: the host's fallback pushes only while
  // this page is away, so the page's own forward switches must not ride along
  // (a field the host does not read still reads like it applies to the host).
  assert(Object.keys(hb0).sort().join(',') === 'alive,language',
    'the beat body is exactly {alive, language}, got ' + Object.keys(hb0).sort().join(','));
  const d0 = yes.api.debug();
  assert(d0.hostBridge.state === 'active', 'debug() reports an active lease, got ' + d0.hostBridge.state);
  assert(d0.hostBridge.leaseMs === 60000, 'debug() reports the lease the host granted, got ' + d0.hostBridge.leaseMs);
  assert(d0.hostBridge.relayEnabled === true && d0.hostBridge.relayPath === '/__dsh-notify-me/relay/abc123',
    'debug() reports the relay route, got ' + JSON.stringify(d0.hostBridge));
  assert(typeof d0.hostBridge.lastProbeAt === 'string' && typeof d0.hostBridge.lastBeaconAt === 'string',
    'debug() timestamps the probe and the last beat, got ' + JSON.stringify(d0.hostBridge));

  // 2) the interval is leaseMs/3 (a 60 s lease means a beat every 20 s), and
  //    the language / forward toggles reach the host on the very next beat.
  yes.clock.advance(19999);
  await flush();
  assert(aliveBeats(yes.calls).length === 1, 'a beat at leaseMs/2 would be too late; got a beat early');
  yes.clock.advance(1);
  await flush();
  assert(aliveBeats(yes.calls).length === 2, 'a 60 s lease beats every 20 s, got ' + aliveBeats(yes.calls).length);
  yes.api.setConfig({ language: 'en', externalEnabled: true, externalAttention: false });
  yes.clock.advance(20000);
  await flush();
  const hb1 = JSON.parse(aliveBeats(yes.calls)[aliveBeats(yes.calls).length - 1].body);
  assert(aliveBeats(yes.calls).length === 3, 'the beat keeps its pace after the first, got ' + aliveBeats(yes.calls).length);
  assert(hb1.language === 'en', 'a pinned language reaches the host on the next beat, got ' + hb1.language);
  // Flipping every external-forward setting must not add or remove a field.
  assert(Object.keys(hb1).sort().join(',') === 'alive,language',
    'the beat body stays {alive, language} after the forward toggles change, got ' + Object.keys(hb1).sort().join(','));

  // 3) a bare 404 is the stock install, not a fault: the host-bridge route only
  //    exists while hostFallback or relay is on, so the webserver answers 404
  //    with an empty body. Reading res.json() on that used to look like a
  //    broken host and alarmed every default install.
  const nope = bootBridge(() => ({ ok: false, status: 404 }));
  await flush();
  nope.clock.advance(60000);
  await flush();
  // Two probes: the one at boot and the one the 60 s re-probe interval fires.
  assert(probes(nope.calls).length === 2, 'the re-probe interval still runs without a lease, got ' + probes(nope.calls).length);
  assert(beats(nope.calls).length === 0, 'a host without a fallback never gets a beat, got ' + beats(nope.calls).length);
  assert(nope.api.debug().hostBridge.state === 'unavailable',
    'an absent route (404) is unavailable, not an error, got ' + nope.api.debug().hostBridge.state);

  // 3a) 501 and an empty 204 say the same thing: the host has no bridge.
  for (const status of [501, 204]) {
    const stub = bootBridge(() => ({ ok: status === 204, status }));
    await flush();
    stub.clock.advance(20000);
    await flush();
    assert(beats(stub.calls).length === 0, 'status ' + status + ' never gets a beat');
    assert(stub.api.debug().hostBridge.state === 'unavailable',
      'status ' + status + ' reads as unavailable, got ' + stub.api.debug().hostBridge.state);
    for (const c of [...stub.host.cleanups]) c();
  }

  // 3b) a real fault still is one: a 5xx or an unreadable body keeps its
  //     "something is wrong" reading, so the alarm is not lost with the 404.
  const broken = bootBridge(() => ({ ok: false, status: 500 }));
  await flush();
  assert(broken.api.debug().hostBridge.state === 'error',
    'a 5xx probe is an error, got ' + broken.api.debug().hostBridge.state);
  const garbage = bootBridge(() => ({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected token <')) }));
  await flush();
  assert(garbage.api.debug().hostBridge.state === 'error',
    'a non-JSON bridge body is an error, got ' + garbage.api.debug().hostBridge.state);

  // 3e) the everyday deployment fault: the gate turns the page away. It must
  //     read as a fault with the gate's own reason, never as "not enabled" —
  //     that is the difference between the user fixing allowedOrigins and the
  //     user never hearing about it while the host pushes duplicates.
  const denied = bootBridge(() => ({
    ok: false,
    status: 403,
    json: () => Promise.resolve({ ok: false, reason: 'bad-host' }),
  }));
  await flush();
  const deniedDbg = denied.api.debug().hostBridge;
  assert(deniedDbg.state === 'error', 'a 403 is an error, not a silent "off", got ' + deniedDbg.state);
  assert(deniedDbg.lastReason === 'bad-host', 'the gate reason is kept, got ' + deniedDbg.lastReason);
  assert(beats(denied.calls).length === 0, 'a refused page does not hold a lease');
  denied.clock.advance(60000);
  await flush();
  // Re-read: debug() hands out a fresh object, and the 60 s re-probe refuses
  // again, so the reason has to survive the retry rather than be cleared by it.
  assert(denied.api.debug().hostBridge.lastReason === 'bad-host',
    'a later refusal keeps naming its reason, got ' + denied.api.debug().hostBridge.lastReason);

  // 3f) a refusal with an unreadable body still reports the status.
  const deniedBare = bootBridge(() => ({ ok: false, status: 403, json: () => Promise.reject(new SyntaxError('empty body')) }));
  await flush();
  assert(deniedBare.api.debug().hostBridge.state === 'error', 'a bare 403 is an error');
  assert(deniedBare.api.debug().hostBridge.lastReason === 'http-403',
    'a 403 without a readable reason falls back to the status, got ' + deniedBare.api.debug().hostBridge.lastReason);

  // 3c) a host that answers "no fallback" (relay and fallback both off) reads
  //     as unavailable rather than broken, and also never gets a beat.
  const off = bootBridge(() => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true, hostFallback: { enabled: false }, relay: { enabled: false } }),
  }));
  await flush();
  off.clock.advance(20000);
  await flush();
  assert(beats(off.calls).length === 0, 'a disabled host fallback never gets a beat');
  assert(off.api.debug().hostBridge.state === 'unavailable',
    'a host with no fallback reads as unavailable, got ' + off.api.debug().hostBridge.state);
  assert(off.api.debug().hostBridge.relayEnabled === false, 'no relay path without an enabled relay');

  // 3d) the relay is its own feature: hostFallback off + relay on is a legal
  //     configuration (the user wants the same-origin relay only), so the
  //     relay path must survive the "no fallback" branch.
  const relayOnly = bootBridge(() => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      ok: true,
      hostFallback: { enabled: false, leaseMs: 60000 },
      relay: { enabled: true, path: '/__dsh-notify-me/relay/def456', upstreamHost: 'gateway.example' },
    }),
  }));
  await flush();
  relayOnly.clock.advance(20000);
  await flush();
  assert(beats(relayOnly.calls).length === 0, 'relay-only never holds a page lease (nothing to coordinate)');
  const relayDbg = relayOnly.api.debug().hostBridge;
  assert(relayDbg.state === 'unavailable', 'relay-only has no lease to hold, got ' + relayDbg.state);
  assert(relayDbg.relayEnabled === true && relayDbg.relayPath === '/__dsh-notify-me/relay/def456',
    'the relay path survives an disabled hostFallback, got ' + JSON.stringify(relayDbg));
  assert(relayDbg.leaseMs === null, 'no lease is reported without a fallback, got ' + relayDbg.leaseMs);
  // The relay's upstream gateway host travels with the path: the page needs it
  // to recognise a target that names that same gateway.
  assert(relayDbg.relayUpstreamHost === 'gateway.example',
    'the probe publishes the relay upstream host, got ' + JSON.stringify(relayDbg.relayUpstreamHost));

  // 4) pagehide: one keepalive release, then silence — the host must take over
  //    at once instead of waiting out the lease.
  const bye = bootBridge(hostYes);
  await flush();
  bye.clock.advance(20000);
  await flush();
  const beatsBeforeHide = aliveBeats(bye.calls).length;
  assert(beatsBeforeHide === 2, 'the page was beating before the unload, got ' + beatsBeforeHide);
  for (const fn of bye.b.pagehideListeners()) fn();
  await flush();
  const releases = beats(bye.calls).filter((c) => JSON.parse(c.body).alive === false);
  assert(releases.length === 1, 'pagehide releases the lease exactly once, got ' + releases.length);
  assert(releases[0].opts.keepalive === true, 'the release is a keepalive POST so it survives the unload');
  assert(releases[0].opts.headers['x-dsh-notify-me-page'] === 'bridge', 'the release carries the intent header too');
  const rel = JSON.parse(releases[0].body);
  assert(rel.language === bye.api.debug().language, 'the release carries the page language, got ' + JSON.stringify(rel));
  assert(Object.keys(rel).sort().join(',') === 'alive,language',
    'the release body is exactly {alive, language}, got ' + Object.keys(rel).sort().join(','));
  assert(typeof bye.api.debug().hostBridge.lastBeaconAt === 'string', 'debug() timestamps the release');
  // A visibilitychange into "hidden" is not an unload: only pagehide releases.
  bye.b.doc.hidden = true;
  bye.b.doc.visibilityState = 'hidden';
  bye.b.fireVisibility();
  bye.clock.advance(60000);
  await flush();
  assert(aliveBeats(bye.calls).length === beatsBeforeHide,
    'no further beat once the page released the lease, got ' + (aliveBeats(bye.calls).length - beatsBeforeHide));
  assert(beats(bye.calls).filter((c) => JSON.parse(c.body).alive === false).length === 1,
    'going hidden does not release the lease a second time');

  // 4b) a back/forward-cache restore fires no load event, so pageshow has to
  //     re-probe: the lease was released on pagehide, and without this the host
  //     would keep pushing to a page that is right there (duplicate alerts)
  //     until the next 60 s tick.
  const restore = bootBridge(hostYes);
  await flush();
  for (const fn of restore.b.pagehideListeners()) fn();
  await flush();
  assert(beats(restore.calls).some((c) => JSON.parse(c.body).alive === false), 'the unload released the lease');
  const restoreProbesBefore = probes(restore.calls).length;
  restore.b.firePageShow(true);
  await flush();
  assert(probes(restore.calls).length === restoreProbesBefore + 1,
    'a bfcache restore re-probes at once, got ' + (probes(restore.calls).length - restoreProbesBefore));
  assert(restore.api.debug().hostBridge.state === 'active',
    'the restored page holds the lease again, got ' + restore.api.debug().hostBridge.state);
  assert(aliveBeats(restore.calls).length === 2, 'a beat resumes after the restore, got ' + aliveBeats(restore.calls).length);
  // An ordinary pageshow always follows a real load, whose boot probe just ran,
  // so it must not add a second one.
  const afterRestore = probes(restore.calls).length;
  restore.b.firePageShow(false);
  await flush();
  assert(probes(restore.calls).length === afterRestore,
    'an ordinary pageshow adds no probe, got ' + (probes(restore.calls).length - afterRestore));
  for (const c of [...restore.host.cleanups]) c();

  // 5) the probe is invisible while hidden and comes back once on return.
  const vis = bootBridge(hostYes);
  await flush();
  const probesBefore = probes(vis.calls).length;
  vis.b.doc.hidden = true;
  vis.b.doc.visibilityState = 'hidden';
  vis.clock.advance(60000);   // the interval tick defers while hidden
  await flush();
  assert(probes(vis.calls).length === probesBefore, 'a hidden page does not probe, got ' + probes(vis.calls).length);
  vis.b.doc.hidden = false;
  vis.b.doc.visibilityState = 'visible';
  vis.b.fireVisibility();
  await flush();
  assert(probes(vis.calls).length === probesBefore + 1,
    'becoming visible probes once right away, got ' + (probes(vis.calls).length - probesBefore));

  // 6) the debug block keeps its shape in every state.
  const SHAPE = 'lastBeaconAt,lastProbeAt,lastReason,leaseMs,relayEnabled,relayPath,relayUpstreamHost,state';
  for (const shape of [yes.api.debug().hostBridge, nope.api.debug().hostBridge, off.api.debug().hostBridge, relayOnly.api.debug().hostBridge, denied.api.debug().hostBridge]) {
    assert(Object.keys(shape).sort().join(',') === SHAPE,
      'hostBridge debug keys are stable, got ' + Object.keys(shape).sort().join(','));
  }
  for (const c of [...yes.host.cleanups]) c();
  for (const c of [...nope.host.cleanups]) c();
  for (const c of [...off.host.cleanups]) c();
  for (const c of [...bye.host.cleanups]) c();
  for (const c of [...vis.host.cleanups]) c();
  for (const c of [...broken.host.cleanups]) c();
  for (const c of [...garbage.host.cleanups]) c();
  for (const c of [...relayOnly.host.cleanups]) c();
  for (const c of [...denied.host.cleanups]) c();
  for (const c of [...deniedBare.host.cleanups]) c();
  console.log('host bridge lease OK: probe-gated heartbeat, leaseMs/3 pace, {alive,language}-only body, keepalive release, hidden-page deferral, 404/501/204 = unavailable vs 5xx/403/non-JSON = error with a named reason, relay survives a disabled fallback, bfcache restore re-probes');
}

// ── 设置页：宿主侧兜底 / 同源中继状态行 ─────────────────────────────
// 「高级设置 → 外部推送」里那两行是只读的：它们报告宿主探测的结果，不是用户
// 能拨的开关（要不要心跳由宿主回包决定）。三种状态各自要有一条可读的行，中
// 英文案都要在，别名与中继地址也要拼对——用户就是照那行字去填自定义目标的。
async function settingsHostBridgeRows() {
  console.log('\n— settings page: host-side fallback / relay status rows —');
  const flush = () => new Promise((r) => setImmediate(r));
  const answer = (body) => () => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
  function bootWith(responder, opts) {
    return settingsBoot(null, null, {
      advanced: true,
      fetch: (url, req) => {
        if (String(url) === HOST_BRIDGE_ROUTE) return Promise.resolve(responder());
        return Promise.resolve({ ok: true, status: 204 });
      },
      seed: (opts && opts.seed) || undefined,
    });
  }

  // 1) the host has both features: the row says the fallback keeps pushing
  //    after the page closes, and the relay row hands out the paste-able URL.
  const on = bootWith(answer({
    ok: true,
    hostFallback: { enabled: true, leaseMs: 60000 },
    relay: { enabled: true, path: '/__dsh-notify-me/relay/abc123' },
  }));
  await flush();
  const onText = on.renderNow();
  assert(onText.indexOf('宿主侧兜底') !== -1, 'the host-fallback row renders, got ' + onText.slice(0, 200));
  assert(onText.indexOf('已启用 · 页面关闭后仍会推送') !== -1,
    'an enabled fallback says it still pushes after the page closes, got ' + onText);
  assert(onText.indexOf('同源中继') !== -1, 'the relay row renders');
  assert(onText.indexOf('已启用 · 地址：http://127.0.0.1:3080/__dsh-notify-me/relay/abc123') !== -1,
    'the relay row spells out origin + path, got ' + onText);
  assert(onText.indexOf('宿主未响应') === -1, 'a healthy host shows no error note');
  on.cleanup();

  // 2) the host answered "no fallback": both rows read disabled, no address.
  const off = bootWith(answer({ ok: true, hostFallback: { enabled: false }, relay: { enabled: false } }));
  await flush();
  const offText = off.renderNow();
  assert(offText.indexOf('宿主侧兜底') !== -1 && offText.indexOf('未启用') !== -1,
    'a disabled fallback reads as off, got ' + offText.slice(3800, 4600));
  assert(offText.indexOf('/__dsh-notify-me/relay/') === -1, 'no relay address without an enabled relay');
  assert(offText.indexOf('宿主未响应') === -1, 'a reachable host is not reported as unresponsive');
  off.cleanup();

  // 2b) relay without the fallback is a legal configuration: the relay row
  //     still hands out the address while the fallback row reads disabled.
  const relayOnly = bootWith(answer({
    ok: true,
    hostFallback: { enabled: false, leaseMs: 60000 },
    relay: { enabled: true, path: '/__dsh-notify-me/relay/def456' },
  }));
  await flush();
  const relayOnlyText = relayOnly.renderNow();
  assert(relayOnlyText.indexOf('已启用 · 地址：http://127.0.0.1:3080/__dsh-notify-me/relay/def456') !== -1,
    'a relay-only host still shows the relay address, got ' + relayOnlyText.slice(3800, 4700));
  assert(relayOnlyText.indexOf('宿主未响应') === -1, 'relay-only is not an error state');
  relayOnly.cleanup();

  // 2c) the gate refused the page (403) — the tunnel/allowlist fault. The row
  //     must not read "not enabled", and the note has to name allowedOrigins.
  const barred = bootWith(() => ({
    ok: false,
    status: 403,
    json: () => Promise.resolve({ ok: false, reason: 'bad-host' }),
  }));
  await flush();
  const barredText = barred.renderNow();
  assert(barredText.indexOf('宿主侧兜底 | 宿主未响应') !== -1,
    'a refused page is reported, not shown as disabled, got ' + barredText.slice(3800, 4700));
  assert(barredText.indexOf('宿主侧兜底 | 未启用') === -1,
    'the fallback row must not read "未启用" while the host is refusing the page');
  assert(barredText.indexOf('allowedOrigins') !== -1,
    'the refusal note names the key to fix, got ' + barredText.slice(3800, 4700));
  assert(barredText.indexOf('插件与宿主版本不一致') === -1,
    'a gate refusal does not use the build-mismatch note');
  barred.cleanup();

  // 2d) the same refusal without a readable reason: still a fault, but the
  //     generic note, because nothing named a key.
  const barredBare = bootWith(() => ({ ok: false, status: 403 }));
  await flush();
  const barredBareText = barredBare.renderNow();
  assert(barredBareText.indexOf('宿主侧兜底 | 宿主未响应') !== -1, 'a bare 403 is still a fault');
  assert(barredBareText.indexOf('allowedOrigins') === -1,
    'without a named reason there is no allowlist hint to give');
  assert(barredBareText.indexOf('插件与宿主版本不一致') !== -1,
    'a bare refusal falls back to the generic note, got ' + barredBareText.slice(3800, 4700));
  assert(barredBare.apiNow().debug().hostBridge.lastReason === 'http-403',
    'debug() still records the status as the reason');
  barredBare.cleanup();

  // 3) the host is broken rather than absent: fetch refused, a 5xx, or a body
  //    that is not the bridge JSON. Only then does the page say so.
  const dead = bootWith(() => ({ ok: false, status: 500 }));
  await flush();
  const deadText = dead.renderNow();
  assert(deadText.indexOf('宿主未响应') !== -1, 'an unreachable host is reported, got ' + deadText.slice(3800, 4600));
  assert(deadText.indexOf('宿主侧通道没有回应') !== -1, 'the error state explains itself, got ' + deadText.slice(3800, 4600));
  assert(deadText.indexOf('/__dsh-notify-me/relay/') === -1, 'no relay address while the host is unreachable');
  dead.cleanup();

  // 4) English parity: every new key exists in both dictionaries, so an
  //    English page never falls back to Chinese (or to a blank label).
  const s = settingsBoot(null, null, { advanced: true });
  const dict = s.dictNow();
  const KEYS = [
    'externalHostBridgeLabel', 'externalHostBridgeHint',
    'externalHostFallbackOn', 'externalHostFallbackOff', 'externalHostFallbackError',
    'externalHostBridgeErrorNote', 'externalHostBridgeDeniedNote',
    'externalRelayLabel', 'externalRelayHint',
    'externalRelayOn', 'externalRelayOff', 'externalRelayAddress',
  ];
  for (const key of KEYS) {
    assert(dict && dict.zh && dict.zh[key], 'UI_zh defines ' + key);
    assert(dict.en && dict.en[key], 'UI_en defines ' + key);
    assert(dict.en[key] !== dict.zh[key], 'UI_en translates ' + key + ' rather than reusing the Chinese copy');
  }
  s.cleanup();
  console.log('settings host-bridge rows OK: enabled / disabled / relay-only / host-broken copy, relay address, no alarm on a default install, zh+en parity');
}

// ── 设置页：外部通知卡片 ────────────────────────────────────────────

async function settingsExternalRows() {
  console.log('\n— settings page: external notification rows —');
  const flush = () => new Promise((r) => setImmediate(r));

  // 1) defaults: the card renders, nothing is on, the empty state is spelled out.
  const base = settingsBoot(null, null, { advanced: true });
  assert(base.text.indexOf('外部通知') !== -1, 'the external card header renders');
  assert(base.text.indexOf('转发外部通知') !== -1, 'the master switch row renders');
  assert(base.text.indexOf('转发「需要你」') !== -1 && base.text.indexOf('转发「回复完成」') !== -1,
    'both per-kind rows render');
  assert(base.text.indexOf('还没有推送目标') !== -1, 'the empty state is spelled out');
  const master = base.find((n) => n.props && n.props['aria-label'] === '转发外部通知');
  assert(master && master.props['aria-checked'] === 'false', 'the master switch starts off');
  base.cleanup();

  // 2) a seeded target renders its URL in the input and the privacy note.
  const seeded = settingsBoot({ externalEnabled: true, externalTargets: [{ id: 't1', type: 'bark', url: 'https://api.day.app/KEY' }] }, null, { advanced: true });
  const urlInput = seeded.find((n) => n.props && n.props['aria-label'] === '推送地址');
  assert(urlInput && urlInput.props.value === 'https://api.day.app/KEY', 'the seeded URL lands in the input');
  assert(seeded.text.indexOf('只填你自己信任的端点') !== -1, 'the privacy note renders once a target exists');
  const master2 = seeded.find((n) => n.props && n.props['aria-label'] === '转发外部通知');
  assert(master2 && master2.props['aria-checked'] === 'true', 'the seeded master switch reads on');

  // 3) the switch toggles and persists through setConfig.
  seeded.press('转发外部通知');
  assert(seeded.configNow().externalEnabled === false, 'toggling the master switch persists');
  seeded.press('转发外部通知');

  // 4) add / edit / delete targets.
  seeded.press('添加目标');
  assert(seeded.configNow().externalTargets.length === 2, 'add appends a target');
  let inputs = seeded.findAll((n) => n.props && n.props['aria-label'] === '推送地址');
  assert(inputs.length === 2, 'two URL inputs render');
  assert(inputs[1].props.value === '', 'the fresh target starts empty');
  inputs[1].props.onChange({ currentTarget: { value: 'https://discord.com/api/webhooks/1/y' } });
  assert(seeded.configNow().externalTargets[1].url === 'https://discord.com/api/webhooks/1/y',
    'url edits land in config');
  // re-render the way React would: the next handler must close over the fresh
  // cfg, otherwise it rebuilds the list from the stale one and drops this edit.
  seeded.renderNow();
  const typeSelect = seeded.findAll((n) => n.props && n.props['aria-label'] === '推送类型').pop();
  typeSelect.props.onChange({ currentTarget: { value: 'discord' } });
  assert(seeded.configNow().externalTargets[1].type === 'discord', 'type edits land in config');
  assert(seeded.configNow().externalTargets[1].url === 'https://discord.com/api/webhooks/1/y',
    'the type edit does not drop the url edit');
  seeded.renderNow();
  seeded.press('删除这个目标');
  assert(seeded.configNow().externalTargets.length === 1, 'delete removes a target');
  assert(seeded.configNow().externalTargets[0].url === 'https://discord.com/api/webhooks/1/y',
    'the pressed row is the one removed'); // press() hits the first row, t1 goes
  seeded.cleanup();

  // 5) the test button posts and reports the verdict.
  const calls = [];
  const test = settingsBoot(
    { enabled: true, externalEnabled: true, externalTargets: [{ id: 't1', type: 'custom', url: 'https://hook.example/x' }] },
    null,
    { advanced: true, fetch: (url, opts) => { if (String(url) !== HOST_BRIDGE_ROUTE) calls.push({ url, opts: opts || {} }); return Promise.resolve({ ok: true, status: 204 }); } }
  );
  test.press('测一测外部通知');
  assert(test.textNow().indexOf('发送中') !== -1, 'the test button reports progress in flight');
  await flush();
  const after = test.renderNow();
  assert(after.indexOf('测试通知：成功 1') !== -1, 'the verdict counts render, got ' + after);
  assert(calls.length === 1 && calls[0].url === 'https://hook.example/x', 'the test pinged the target');
  assert(String(calls[0].opts.body).indexOf('外部通知测试') !== -1, 'the test payload carries the test copy');
  test.cleanup();

  // 6) the "why did nothing send" cases get hints instead of a dead control.
  const offCalls = [];
  const off = settingsBoot(
    { enabled: true, externalEnabled: false, externalTargets: [{ id: 't1', type: 'custom', url: 'https://hook.example/x' }] },
    null,
    { advanced: true, fetch: (url) => { if (String(url) !== HOST_BRIDGE_ROUTE) offCalls.push(String(url)); return Promise.resolve({ ok: true, status: 204 }); } }
  );
  off.press('测一测外部通知');
  assert(off.textNow().indexOf('先打开「转发外部通知」') !== -1, 'master-off gets a hint');
  assert(offCalls.length === 0, 'master-off sends nothing');
  off.cleanup();

  const none = settingsBoot({ enabled: true, externalEnabled: true }, null,
    { advanced: true, fetch: () => Promise.resolve({ ok: true, status: 204 }) });
  none.press('测一测外部通知');
  assert(none.textNow().indexOf('先添加至少一个推送目标') !== -1, 'no-target gets a hint');
  none.cleanup();

  // 7) the newer target types surface the fields their service needs, and only
  //    those fields: a feishu bot has a signing secret + template, WxPusher
  //    needs an appToken + receiver UID instead of a webhook URL.
  const typed = settingsBoot({
    externalEnabled: true,
    externalTargets: [
      { id: 'f', type: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/X' },
      { id: 'w', type: 'wxpusher', token: 'AT_x', uid: 'UID_a' }
    ]
  }, null, { advanced: true });
  assert(typed.find((n) => n.props && n.props['aria-label'] === '签名密钥'), 'feishu exposes the signing-secret field');
  assert(typed.find((n) => n.props && n.props['aria-label'] === '消息模板'), 'chat targets expose the template field');
  assert(typed.find((n) => n.props && n.props['aria-label'] === 'appToken'), 'wxpusher exposes the appToken');
  assert(typed.find((n) => n.props && n.props['aria-label'] === '接收者 UID'), 'wxpusher exposes the receiver UID');
  assert(typed.findAll((n) => n.props && n.props['aria-label'] === '推送地址').length === 1,
    'only the webhook target has a URL field (WxPusher endpoint is fixed)');
  const toggles = typed.findAll((n) => n.props && n.props['aria-label'] === '启用或停用这个目标');
  assert(toggles.length === 2 && toggles[0].props['aria-checked'] === 'true', 'each target gets its own switch, got ' + toggles.length);
  toggles[0].props.onClick();
  typed.renderNow();
  assert(typed.configNow().externalTargets[0].enabled === false, 'the per-target switch persists');
  typed.cleanup();

  // 8) a target's last verdict and the dead-letter log are rendered from
  //    storage, and the log can be cleared from the page.
  const health = settingsBoot(
    { externalEnabled: true, externalTargets: [{ id: 't1', type: 'custom', url: 'https://hook.example/x' }] },
    null,
    {
      advanced: true,
      seed(sandbox) {
        sandbox.localStorage.setItem('dshNotifyMe.external.health', JSON.stringify({
          t1: { status: 'failed (HTTP 500)', at: '2026-10-23T06:00:00.000Z', attempts: 3, reason: 'HTTP 500' }
        }));
        sandbox.localStorage.setItem('dshNotifyMe.external.dead', JSON.stringify([
          { at: '2026-10-23T06:00:00.000Z', targetId: 't1', type: 'custom', host: 'hook.example', title: '需要你', body: 'y', status: 'failed (HTTP 500)', attempts: 3 }
        ]));
      }
    }
  );
  assert(health.text.indexOf('上次失败 · HTTP 500') !== -1, 'the per-target status reads failed, got ' + health.text);
  assert(health.text.indexOf('彻底失败 1 条') !== -1, 'the failure log counts the dead letter');
  assert(health.text.indexOf('hook.example') !== -1, 'the failure log shows the host, not the secret path');
  health.press('清空失败记录');
  assert(health.textNow().indexOf('没有投递失败的记录') !== -1, 'clearing the log updates the row');
  assert(health.configNow() !== null, 'clearing the failure log does not touch the config');
  health.cleanup();

  console.log('external settings rows OK: card renders, targets edit/persist, test button reports, hints for the silent cases');
}


function settingsAlertSetup() {
  console.log('\n— settings page: no channel choice, no approval card —');
  const base = settingsBoot();
  assert(base.text.indexOf('浮层提醒') === -1, 'the overlay channel option is gone');
  assert(base.text.indexOf('通知类型') === -1, 'the alert-type row is gone');
  assert(base.text.indexOf('两个只能选一个') === -1, 'the pick-one hint is gone');
  assert(base.findAll((n) => n.props && n.props.role === 'radio').length === 0,
    'no segmented channel control is left behind');
  // 1.12.0 removed the desktop approval card outright: approvals are system
  // notifications now, so there is no card corner to configure and no row for it.
  assert(base.text.indexOf('审批卡片位置') === -1, 'no approval-card corner row');
  // The explanation hangs off the label text only — hovering a switch or a
  // slider must not pop a box the user did not ask for.
  const tips = base.findAll((n) => n.props && String(n.props.className || '').indexOf('dnm-rowTip') !== -1);
  assert(tips.length > 0, 'explained rows mark something as the tooltip target');
  assert(tips.every((n) => String(n.props.className).indexOf('dnm-rowLabel') !== -1),
    'only the label text carries the tooltip');

  base.press('审批通知上直接裁决');
  assert(base.configNow().quickActions === false, 'the quick-decision switch persisted');
  base.cleanup();

  // A config written by 1.10.x still renders: the channel keys mean nothing now
  // and reading them back must not crash or silence anything.
  const legacy = settingsBoot({ channel: 'overlay', overlay: true, overlayCorner: 'top-left', toast: false });
  assert(legacy.text.length > 0, 'a legacy channel config still renders the page');
  assert(legacy.configNow().channel === undefined && legacy.configNow().overlay === undefined,
    'readConfig scrubs the dead channel keys, got ' + JSON.stringify(legacy.configNow().channel));
  assert(legacy.configNow().overlayCorner === undefined, 'the dead card-corner key is scrubbed too');
  legacy.cleanup();

  console.log('alert setup OK: channel picker gone, card corner gone, legacy configs load');
}

// A window that is merely covered is still "visible" to the browser: the
// desktop shell only flips document.hidden on minimise or full occlusion. Users
// mean "I am working elsewhere" when the window loses focus, so the reminders
// that wait for the background have to fire on blur as well (1.10.5).
async function awayWithoutHiding() {
  console.log('\n— background = unfocused window, not just a hidden tab —');
  const b = bootBundle({ withNotification: true });
  const host = buildHost({ withUiSession: false });
  host.setFace({ sessionId: 's1', running: false, pending: [], nodes: [], partial: null });
  const { mod, win, doc, events } = b;
  mod.apply(host.ctx);
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  win.__dshNotifyMe.setConfig({ sound: false, language: 'zh', enabled: true, doneHiddenOnly: true, attentionHiddenOnly: false });

  assert(b.hasFocusListener(), 'the core listens for window focus/blur');

  // Visible + focused: a background completion stays quiet (unchanged default).
  events.length = 0;
  host.setList({ ids: ['bg'], byId: { bg: { running: true, displayTitle: '后台任务', completed: false } }, current: 's1', phase: 'ready' });
  host.notifyList();
  await sleep(400);
  host.setList({ ids: ['bg'], byId: { bg: { running: false, displayTitle: '后台任务', completed: true } }, current: 's1', phase: 'ready' });
  host.notifyList();
  assert(events.filter((e) => e.kind === 'done').length === 0, 'a focused window stays quiet for a background finish');

  // Same page, window behind another app: the finish must reach the user.
  events.length = 0;
  b.setWindowFocus(false);
  host.setList({ ids: ['bg'], byId: { bg: { running: true, displayTitle: '后台任务', completed: false } }, current: 's1', phase: 'ready' });
  host.notifyList();
  await sleep(400);
  host.setList({ ids: ['bg'], byId: { bg: { running: false, displayTitle: '后台任务', completed: true } }, current: 's1', phase: 'ready' });
  host.notifyList();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'an unfocused window counts as background for a finish');

  // Back in front: quiet again.
  b.setWindowFocus(true);
  events.length = 0;
  host.setList({ ids: ['bg'], byId: { bg: { running: true, displayTitle: '后台任务', completed: false } }, current: 's1', phase: 'ready' });
  host.notifyList();
  await sleep(400);
  host.setList({ ids: ['bg'], byId: { bg: { running: false, displayTitle: '后台任务', completed: true } }, current: 's1', phase: 'ready' });
  host.notifyList();
  assert(events.filter((e) => e.kind === 'done').length === 0, 'refocusing the window silences finishes again');
  assert(doc.visibilityState === 'visible' && doc.hidden === false, 'the page never actually hid during this case');

  // A wait kept quiet because it was on screen is re-delivered on blur.
  win.__dshNotifyMe.setConfig({ sound: false, language: 'zh', enabled: true, currentHiddenOnly: true });
  events.length = 0;
  host.setFace({ ...host.faceSnap(), running: true, pending: [approval('a:away1')] });
  host.notifyFace();
  assert(events.length === 0, 'the on-screen approval stays quiet while the window has focus');
  b.setWindowFocus(false);
  assert(events.filter((e) => e.kind === 'attention').length === 1, 'blurring the window flushes the quieted approval');

  console.log('window-focus OK: blur counts as background, refocus silences again');
}

// Focus answers "is the window in front", not "is anyone there". A window left
// in front while its owner walks off keeps focus forever, so the idle half of
// the signal turns "no input for idleMinutes" into away as well.
async function awayWhileFocusedAndIdle() {
  console.log('\n— a focused window nobody has touched counts as away —');
  const b = bootBundle({ withNotification: true });
  const host = buildHost({ withUiSession: false });
  host.setFace({ sessionId: 's1', running: false, pending: [], nodes: [], partial: null });
  const { mod, win, events } = b;
  mod.apply(host.ctx);
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  win.__dshNotifyMe.setConfig({ sound: false, language: 'zh', enabled: true, donePolicy: 'background', idleMinutes: 0.0005 });
  host.setList({ ids: ['bg'], byId: { bg: { running: false, displayTitle: '后台任务', completed: false } }, current: 's1', phase: 'ready' });
  host.notifyList();

  // Focus stays on the whole time; only the input clock runs out.
  await sleep(200);
  assert(win.__dshNotifyMe.debug().away === true, 'a focused page idle past idleMinutes reads as away');

  events.length = 0;
  host.setList({ ids: ['bg'], byId: { bg: { running: true, displayTitle: '后台任务', completed: false } }, current: 's1', phase: 'ready' });
  host.notifyList();
  await sleep(400);
  host.setList({ ids: ['bg'], byId: { bg: { running: false, displayTitle: '后台任务', completed: true } }, current: 's1', phase: 'ready' });
  host.notifyList();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'a finish reaches a user who left a focused window');

  win.__dshNotifyMe.setConfig({ idleMinutes: 0 });
  assert(win.__dshNotifyMe.debug().away === false, 'idleMinutes 0 restores the focus/visibility-only rule');
  console.log('idle-away OK: a focused but untouched window counts as background');
}

// Going idle is the only "away" transition with no event behind it: the window
// keeps focus and never hides, so the flush a blur normally triggers must run on
// the idle clock instead. Otherwise a wait queued while the user was still at
// the desk stays silent after they walk off — the exact case the policy is for.
async function idleFlushesQuieted() {
  console.log('\n— reaching the idle limit flushes the quieted approval queue —');
  const b = bootBundle({ withNotification: true });
  const host = buildHost({ withUiSession: false });
  host.setFace({ sessionId: 's1', running: false, pending: [], nodes: [], partial: null });
  const { mod, win, events } = b;
  mod.apply(host.ctx);
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  win.__dshNotifyMe.setConfig({
    sound: false, language: 'zh', enabled: true,
    currentHiddenOnly: true, attentionHiddenOnly: false, idleMinutes: 0.0005,
  });
  events.length = 0;
  host.setFace({ ...host.faceSnap(), running: true, pending: [approval('a:idle1')] });
  host.notifyFace();
  assert(events.length === 0, 'the on-screen approval stays quiet while the user is present');

  await sleep(150);
  assert(win.__dshNotifyMe.debug().away === true, 'the idle clock has run out, got away=' + win.__dshNotifyMe.debug().away);
  assert(events.filter((e) => e.kind === 'attention').length === 1,
    'running out the idle clock re-delivers the quieted approval, got ' + JSON.stringify(events));
  assert(!!b.lastNotification(), 'the re-delivery is a real notification');

  // Drained, not repeated: the queue must not fire again on the next check.
  await sleep(150);
  assert(events.filter((e) => e.kind === 'attention').length === 1, 'the flush drains the queue instead of repeating it');
  console.log('idle-flush OK: an expiry with no event still re-delivers the wait');
}

// Which conversation finished decides the alert under "smart": the one on
// screen is already being read, the ones behind it are news.
async function donePolicyScopes() {
  console.log('\n— "who finished" decides, not just page visibility —');
  const b = bootBundle({ withNotification: true });
  const host = buildHost({ withUiSession: false });
  host.setFace({ sessionId: 's1', running: false, pending: [], nodes: [], partial: null });
  const { mod, win, events } = b;
  mod.apply(host.ctx);
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  win.__dshNotifyMe.setConfig({ sound: false, language: 'zh', enabled: true, idleMinutes: 0, donePolicy: 'smart' });
  host.setList({ ids: ['bg'], byId: { bg: { running: false, displayTitle: '后台任务', completed: false } }, current: 's1', phase: 'ready' });
  host.notifyList();
  host.notifyFace();

  const finishOther = async () => {
    host.setList({ ids: ['bg'], byId: { bg: { running: true, displayTitle: '后台任务', completed: false } }, current: 's1', phase: 'ready' });
    host.notifyList();
    await sleep(400);
    host.setList({ ids: ['bg'], byId: { bg: { running: false, displayTitle: '后台任务', completed: true } }, current: 's1', phase: 'ready' });
    host.notifyList();
  };
  const finishCurrent = async () => {
    host.setFace({ ...host.faceSnap(), running: true });
    host.notifyFace();
    await sleep(400);
    host.setFace({ ...host.faceSnap(), running: false });
    host.notifyFace();
  };

  events.length = 0;
  await finishOther();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'smart: another conversation finishing while visible still alerts');

  events.length = 0;
  await finishCurrent();
  assert(events.filter((e) => e.kind === 'done').length === 0, 'smart: the conversation on screen stays quiet');

  win.__dshNotifyMe.setConfig({ donePolicy: 'background' });
  events.length = 0;
  await finishOther();
  assert(events.filter((e) => e.kind === 'done').length === 0, 'background: a visible page stays quiet for any finish');

  win.__dshNotifyMe.setConfig({ donePolicy: 'always' });
  events.length = 0;
  await finishCurrent();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'always: even the conversation on screen alerts');
  console.log('done-policy OK: background / smart / always behave as advertised');
}

// Whether a toast clears itself, and whether that depends on being present.
async function autoDismissPolicy() {
  console.log('\n— a toast that clears itself must not erase an unseen alert —');
  const raised = async (cfg, hidden) => {
    const b = bootBundle({ withNotification: true });
    const host = buildHost({ withUiSession: false });
    host.setFace({ sessionId: 's1', running: false, pending: [], nodes: [], partial: null });
    const { mod, win, doc } = b;
    mod.apply(host.ctx);
    win.__dshNotifyMe.setConfig(Object.assign({ sound: false, language: 'zh', enabled: true }, cfg));
    doc.hidden = hidden;
    doc.visibilityState = hidden ? 'hidden' : 'visible';
    win.__dshNotifyMe.test('done');
    const n = b.lastNotification();
    assert(n, 'a toast was raised for the dismiss case');
    await sleep(5200);
    return n.closed;
  };

  assert(await raised({ autoDismiss: 'never' }, false) === false, 'never: the toast waits for the user to dismiss it');
  assert(await raised({ autoDismiss: 'always' }, true) === true, 'always: the toast clears even while away');
  assert(await raised({ autoDismiss: 'present' }, true) === false, 'present: a toast raised while away is kept');
  assert(await raised({ autoDismiss: 'present' }, false) === true, 'present: a toast in front still clears itself');
  console.log('auto-dismiss OK: kept while away, cleared while present, or fixed either way');
}

function corruptStoredConfig() {
  console.log('\n— a stored config that is valid JSON but not an object falls back —');
  // JSON.parse returns these happily; before the guard they made the default
  // fill throw inside the bundle and left the page with no plugin at all.
  for (const raw of ['null', '"x"', '7', '[]']) {
    const b = bootBundle({
      withNotification: true,
      extend(sandbox) { sandbox.localStorage.setItem('dshNotifyMe.config', raw); },
    });
    const debug = b.win.__dshNotifyMe.debug();
    assert(debug.enabled === true, JSON.stringify(raw) + ' falls back to the defaults, got ' + JSON.stringify(debug.enabled));
    assert(debug.external.targets === 0, JSON.stringify(raw) + ' starts with no external targets');
  }
  console.log('corrupt config OK: null / string / number / array all fall back to the defaults');
}

// A worker refusal arrives a tick after the click. The settings page used to
// read lastToastReject synchronously, so the button said "sent" for a toast the
// platform had already refused — the surviving half of issue #18 on the path
// that carries the Approve / Reject buttons.
async function swRefusalFeedback() {
  console.log('\n— a deferred worker refusal is not reported as sent —');
  const asked = [];
  const worker = {
    register() {
      return Promise.resolve({
        active: {},
        showNotification(title, opts) {
          asked.push(opts && opts.tag);
          return Promise.reject(new Error('The size of the notification tag is too large'));
        },
        getNotifications() { return []; },
      });
    },
    addEventListener() {},
  };
  const s = settingsBoot(null, null, {
    withNotification: true,
    seed(sandbox) {
      sandbox.navigator = { serviceWorker: worker };
      sandbox.window.__DSH_BOOT__ = {
        entries: [{ id: 'dsh-notify-me', url: '/plugins/??dsh-notify-me/client.js&rev=bbb' }],
      };
    },
  });
  await sleep(20); // register() and its statechange settle on a promise tick
  const button = s.find((n) => n.props && typeof n.props.onClick === 'function'
    && Array.isArray(n.children) && n.children[0] === '测试「审批按钮」');
  assert(button, 'the approval test button renders while a worker is active');
  button.props.onClick();
  await sleep(20);
  const text = s.renderNow();
  assert(asked.length === 1, 'the worker was asked to show the toast once, got ' + asked.length);
  assert(text.indexOf('系统拒收了这条通知：The size of the notification tag is too large') !== -1,
    'the deferred refusal reaches the feedback line, got ' + text);
  assert(text.indexOf('已发送测试提醒') === -1, 'no "sent" feedback survives the worker refusal');
  s.cleanup();
}

function deniedPermissionFeedback() {
  console.log('\n— a denied permission is reported, not "sent" —');
  // showToast() returns before it touches anything when permission is missing,
  // so no refusal is recorded and the old button claimed the toast went out.
  function DeniedNotification() {}
  DeniedNotification.permission = 'denied';
  DeniedNotification.requestPermission = () => Promise.resolve('denied');
  const s = settingsBoot(null, null, {
    withNotification: true,
    seed(sandbox) {
      sandbox.Notification = DeniedNotification;
      sandbox.window.Notification = DeniedNotification;
    },
  });
  const button = s.find((n) => n.props && typeof n.props.onClick === 'function'
    && Array.isArray(n.children) && n.children[0] === '测试「审批按钮」');
  assert(button, 'the approval test button renders with permission denied');
  button.props.onClick();
  const text = s.renderNow();
  assert(text.indexOf('通知权限还没给') !== -1, 'the row reports the missing permission, got ' + text);
  assert(text.indexOf('已发送测试提醒') === -1, 'no "sent" feedback without permission');
  s.cleanup();
}

async function vanishedBaselinesPruned() {
  console.log('\n— baselines for vanished rows are bounded —');
  const b = bootBundle({ withNotification: true });
  const host = buildHost({ withSessionStatus: true });
  b.mod.apply(host.ctx);
  b.win.__dshNotifyMe.onEvent = () => {};
  const base = b.win.__dshNotifyMe.debug().sessionBaselines;
  host.setList({ ids: ['gone'], byId: { gone: { running: false, displayTitle: '临时会话', retainedBy: {} } }, phase: 'ready' });
  host.notifyList();
  assert(b.win.__dshNotifyMe.debug().sessionBaselines === base + 1, 'the row seeds one baseline');
  // A short absence keeps the baseline: the row may come back.
  host.setList({ ids: [], byId: {}, phase: 'ready' });
  host.notifyList();
  assert(b.win.__dshNotifyMe.debug().sessionBaselines === base + 1,
    'a row missing from one update keeps its baseline');
  // Forty-plus updates without it and the baseline is dropped.
  for (let i = 0; i < 45; i++) {
    host.setList({ ids: [], byId: {}, phase: 'ready' });
    host.notifyList();
  }
  assert(b.win.__dshNotifyMe.debug().sessionBaselines === 0,
    'a row gone for 40+ updates drops its baseline, got ' + b.win.__dshNotifyMe.debug().sessionBaselines);
  for (const c of [...host.cleanups]) c();
}

function storageFailureFeedback() {
  console.log('\n— a refused config write is reported instead of looking saved —');
  const s = settingsBoot(null, null, {
    withNotification: true,
    seed(sandbox) {
      sandbox.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
      sandbox.localStorage.removeItem = () => { throw new Error('QuotaExceededError'); };
    },
  });
  const api = s.apiNow();
  api.setConfig({ language: 'en' });
  assert(api.debug().configStored === false, 'debug() reports the failed write');
  const text = s.renderNow();
  assert(text.indexOf('设置没能保存') !== -1, 'the page says the setting did not stick, got ' + text.slice(0, 200));
  // The live copy still works for this page, and the next patch builds on it
  // instead of on the stale storage copy.
  api.setConfig({ sound: false });
  assert(api.debug().language === 'en' && api.debug().sound === false,
    'in-memory settings survive a failed write, got ' + JSON.stringify({ lang: api.debug().language, sound: api.debug().sound }));
  // A refused reset is the same lie in the other direction: the page says the
  // defaults are back while storage still holds the old profile.
  api.resetConfig();
  assert(api.debug().configStored === false, 'a refused reset reports the failed write');
  assert(s.renderNow().indexOf('设置没能保存') !== -1, 'the warning survives a refused reset');
  s.cleanup();
}

function permissionReask() {
  console.log('\n— an explicit test click re-asks a permission prompt that was dismissed —');
  let asks = 0;
  function DefaultNotification() {}
  DefaultNotification.permission = 'default';
  DefaultNotification.requestPermission = () => { asks += 1; return Promise.resolve('denied'); };
  const s = settingsBoot(null, null, {
    withNotification: true,
    seed(sandbox) {
      sandbox.Notification = DefaultNotification;
      sandbox.window.Notification = DefaultNotification;
    },
  });
  const button = s.find((n) => n.props && typeof n.props.onClick === 'function'
    && Array.isArray(n.children) && n.children[0] === '测试「审批按钮」');
  assert(button, 'the approval test button renders while permission is default');
  button.props.onClick();
  button.props.onClick();
  assert(asks === 2, 'each explicit test click asks again, got ' + asks + ' request(s)');
  s.cleanup();
}

async function approvalTestToastSurvivesMark() {
  console.log('\n— the approval test toast keeps working buttons after the title mark goes —');
  const s = settingsBoot(null, null, { withNotification: true });
  const button = s.find((n) => n.props && typeof n.props.onClick === 'function'
    && Array.isArray(n.children) && n.children[0] === '测试「审批按钮」');
  assert(button, 'the approval test button renders');
  button.props.onClick();
  const api = s.apiNow();
  const keys = api.debug().actionKeys;
  assert(keys.length === 1, 'the test toast books its record, got ' + JSON.stringify(keys));
  await sleep(6500); // past TEST_MARK_RELEASE_MS (6 s), before the 12 s close
  assert(api.debug().actionKeys.length === 1,
    'the record survives the title-mark release, got ' + JSON.stringify(api.debug().actionKeys));
  assert(api.decide(keys[0], 'allowed-once') === true,
    'the buttons still settle the test toast after the mark is gone');
  s.cleanup();
}

(async () => {
  await legacyHost();
  await currentHost();
  await modernHost();
  await currentSessionTitle();
  await subagentSessions();
  await completionUnreadChannel();
  await quickActionsHost();
  await desktopRaiseChannel();
  await soundSources();
  uniqueToastTags();
  toastTagLimits();
  settingsSoundRows();
  await externalWebhooks();
  await hostBridgeLease();
  await settingsHostBridgeRows();
  await settingsExternalRows();
  settingsAlertSetup();
  corruptStoredConfig();
  deniedPermissionFeedback();
  await swRefusalFeedback();
  storageFailureFeedback();
  permissionReask();
  await approvalTestToastSurvivesMark();
  await vanishedBaselinesPruned();
  await listChangeDerivation();
  await awayWithoutHiding();
  await awayWhileFocusedAndIdle();
  await idleFlushesQuieted();
  await donePolicyScopes();
  await autoDismissPolicy();
  console.log('\nALL SMOKE TESTS PASSED ✔');
  // Exit explicitly: marker-release timers stay armed on purpose (they mirror
  // browser behaviour) and would otherwise hold the loop open.
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
