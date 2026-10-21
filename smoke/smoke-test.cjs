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
  //    carries nodes, so the toast body has no assistant snippet)
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
  assert(done[0].body === '当前对话', 'no assistant snippet without snapshot nodes, got ' + JSON.stringify(done[0].body));

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
// answer() is the exact verb the in-page card calls.
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

  // 3) clicking 同意 settles the request exactly like the in-page card
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

// ────────── desktop shell raise channel (1.5.2) ──────────
// On the packaged desktop (dsh-app://app inside Electron) DOM window.focus()
// never touches the native window and the shell's will-navigate / window-open
// handlers block every ordinary way to fire a dsh:// URL, so a toast click
// additionally rides the app's own dsh://open deep link through a hidden
// iframe — subframe navigation is the one path past those handlers. In a
// browser the deep link must never fire (it would raise a protocol prompt).
async function desktopRaiseChannel() {
  console.log('\n— desktop shell (dsh-app://) raise channel —');
  const iframes = [];
  const focusCount = { n: 0 };
  const b = bootBundle({
    withNotification: true,
    extend(sandbox) {
      sandbox.location = { origin: 'dsh-app://app', protocol: 'dsh-app:' };
      sandbox.document.body = {
        appendChild(node) { iframes.push(node); return node; },
        removeChild() {},
      };
      sandbox.document.createElement = () => ({
        style: {},
        setAttribute() {},
        parentNode: sandbox.document.body,
      });
      sandbox.window.focus = () => { focusCount.n += 1; };
    },
  });
  const host = buildHost({ withSessionStatus: true, withWorkspace: true });
  const { mod, win, doc } = b;
  mod.apply(host.ctx);
  await sleep(20);
  assert(win.__dshNotifyMe.debug().desktop === true, 'debug() reports the desktop shell');
  assert(win.__dshNotifyMe.debug().raiseChannel === 'dsh-deeplink', 'debug() reports the deep-link raise channel');
  doc.hidden = true; doc.visibilityState = 'hidden';
  host.setList({
    ids: ['s1', 's2'],
    byId: { s1: { displayTitle: '当前会话', retainedBy: { mainView: 1 } }, s2: { displayTitle: '后台任务', retainedBy: {} } },
    phase: 'ready',
  });
  host.notifyList();
  host.setStatus(new Map([['s2', statusRow(question('question:401', { sessionId: 's2' }))]]));
  host.notifyStatus();
  const note = b.lastNotification();
  assert(note && typeof note.onclick === 'function', 'the desktop toast body click is wired');
  note.onclick();
  await sleep(20);
  assert(focusCount.n === 1, 'window.focus() is still called, got ' + focusCount.n);
  assert(iframes.length === 1 && iframes[0].src === 'dsh://open',
    'the click fires the dsh://open deep link through a hidden iframe, got ' + JSON.stringify(iframes.map((f) => f.src)));
  assert(host.opened.length === 1 && host.opened[0] === 's2',
    'the click still switches the alerted conversation, got ' + JSON.stringify(host.opened));
  for (const c of [...host.cleanups]) c();

  // In a browser there is no dsh:// handler: the deep link must never fire.
  const webIframes = [];
  const wb = bootBundle({
    withNotification: true,
    extend(sandbox) {
      sandbox.document.body = {
        appendChild(node) { webIframes.push(node); return node; },
        removeChild() {},
      };
      sandbox.document.createElement = () => ({ style: {}, setAttribute() {}, parentNode: sandbox.document.body });
    },
  });
  const webHost = buildHost({ withSessionStatus: true, withWorkspace: true });
  wb.mod.apply(webHost.ctx);
  await sleep(20);
  assert(wb.win.__dshNotifyMe.debug().desktop === false, 'a plain origin is not the desktop shell');
  assert(wb.win.__dshNotifyMe.debug().raiseChannel === 'window-focus', 'browsers keep the window-focus channel');
  wb.doc.hidden = true; wb.doc.visibilityState = 'hidden';
  webHost.setList({
    ids: ['s1', 's2'],
    byId: { s1: { displayTitle: '当前会话', retainedBy: { mainView: 1 } }, s2: { displayTitle: '后台任务', retainedBy: {} } },
    phase: 'ready',
  });
  webHost.notifyList();
  webHost.setStatus(new Map([['s2', statusRow(question('question:402', { sessionId: 's2' }))]]));
  webHost.notifyStatus();
  const webNote = wb.lastNotification();
  assert(webNote && typeof webNote.onclick === 'function', 'the browser toast body click is wired');
  webNote.onclick();
  await sleep(20);
  assert(webIframes.length === 0,
    'no deep link fires in a browser, got ' + JSON.stringify(webIframes.map((f) => f.src)));
  assert(webHost.opened.length === 1 && webHost.opened[0] === 's2', 'the browser click switches the conversation');
  for (const c of [...webHost.cleanups]) c();

  // The hostEnv setting overrides detection in both directions.
  const forcedWeb = [];
  const fw = bootBundle({
    withNotification: true,
    extend(sandbox) {
      sandbox.location = { origin: 'dsh-app://app', protocol: 'dsh-app:' };
      sandbox.document.body = { appendChild(node) { forcedWeb.push(node); return node; }, removeChild() {} };
      sandbox.document.createElement = () => ({ style: {}, setAttribute() {}, parentNode: sandbox.document.body });
    },
  });
  const fwHost = buildHost({ withSessionStatus: true, withWorkspace: true });
  fw.mod.apply(fwHost.ctx);
  await sleep(20);
  fw.win.__dshNotifyMe.setConfig({ hostEnv: 'web' });
  assert(fw.win.__dshNotifyMe.debug().desktop === false, 'forcing web overrides desktop detection');
  assert(fw.win.__dshNotifyMe.debug().raiseChannel === 'window-focus', 'forced web keeps the window-focus channel');
  assert(fw.win.__dshNotifyMe.debug().hostEnvDetected === 'desktop', 'debug() still reports what detection saw');
  fw.doc.hidden = true; fw.doc.visibilityState = 'hidden';
  fwHost.setList({
    ids: ['s1', 's2'],
    byId: { s1: { displayTitle: '当前会话', retainedBy: { mainView: 1 } }, s2: { displayTitle: '后台任务', retainedBy: {} } },
    phase: 'ready',
  });
  fwHost.notifyList();
  fwHost.setStatus(new Map([['s2', statusRow(question('question:403', { sessionId: 's2' }))]]));
  fwHost.notifyStatus();
  const fwNote = fw.lastNotification();
  assert(fwNote && typeof fwNote.onclick === 'function', 'the forced-web toast body click is wired');
  fwNote.onclick();
  await sleep(20);
  assert(forcedWeb.length === 0, 'forced web fires no deep link on a desktop page');
  for (const c of [...fwHost.cleanups]) c();

  const forcedDesk = [];
  const fd = bootBundle({
    withNotification: true,
    extend(sandbox) {
      sandbox.location = { origin: 'http://127.0.0.1:3080', protocol: 'http:' };
      sandbox.document.body = { appendChild(node) { forcedDesk.push(node); return node; }, removeChild() {} };
      sandbox.document.createElement = () => ({ style: {}, setAttribute() {}, parentNode: sandbox.document.body });
    },
  });
  const fdHost = buildHost({ withSessionStatus: true, withWorkspace: true });
  fd.mod.apply(fdHost.ctx);
  await sleep(20);
  fd.win.__dshNotifyMe.setConfig({ hostEnv: 'desktop' });
  assert(fd.win.__dshNotifyMe.debug().desktop === true, 'forcing desktop overrides web detection');
  assert(fd.win.__dshNotifyMe.debug().raiseChannel === 'dsh-deeplink', 'forced desktop uses the deep-link channel');
  fd.doc.hidden = true; fd.doc.visibilityState = 'hidden';
  fdHost.setList({
    ids: ['s1', 's2'],
    byId: { s1: { displayTitle: '当前会话', retainedBy: { mainView: 1 } }, s2: { displayTitle: '后台任务', retainedBy: {} } },
    phase: 'ready',
  });
  fdHost.notifyList();
  fdHost.setStatus(new Map([['s2', statusRow(question('question:404', { sessionId: 's2' }))]]));
  fdHost.notifyStatus();
  const fdNote = fd.lastNotification();
  assert(fdNote && typeof fdNote.onclick === 'function', 'the forced-desktop toast body click is wired');
  fdNote.onclick();
  await sleep(20);
  assert(forcedDesk.length === 1 && forcedDesk[0].src === 'dsh://open',
    'forced desktop fires the deep link on a web origin, got ' + JSON.stringify(forcedDesk.map((f) => f.src)));
  for (const c of [...fdHost.cleanups]) c();
  console.log('desktop raise channel OK: dsh://open fired on desktop, none in the browser, hostEnv overrides both ways');
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
    configNow: () => b.win.__dshNotifyMe.config,
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
// 消息而不是假提醒；每类提醒的转发开关只拦真实提醒；CORS 被拒时降级 no-cors
// 送出并如实标「不可确认」，真正的 HTTP 错误不盲重试。
async function externalWebhooks() {
  console.log('\n— external webhook forwarding —');
  const flush = () => new Promise((r) => setImmediate(r));

  // A fetch stand-in recording every call; `behavior` answers (or throws).
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
    return { b, host, calls: spy.calls, win: b.win };
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

  // 6) a real HTTP error is reported, never blindly retried.
  const http = bootWeb(() => ({ ok: false, status: 500 }), { externalEnabled: true, externalTargets: [{ id: 't1', type: 'custom', url: 'https://hook.example/x' }] });
  const r3 = await http.win.__dshNotifyMe.testExternal();
  assert(r3.failed === 1 && r3.statuses[0] === 'failed (HTTP 500)', 'HTTP errors are reported, got ' + JSON.stringify(r3));
  assert(http.calls.length === 1, 'no retry after a real HTTP error');

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
  const barkGet = bark.calls.filter((c) => c.opts.method === 'GET').pop();
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

  console.log('external webhooks OK: gated mirroring, payload shapes, no-cors fallback, honest statuses');
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
    { advanced: true, fetch: (url, opts) => { calls.push({ url, opts: opts || {} }); return Promise.resolve({ ok: true, status: 204 }); } }
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
    { advanced: true, fetch: (url) => { offCalls.push(String(url)); return Promise.resolve({ ok: true, status: 204 }); } }
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

  console.log('external settings rows OK: card renders, targets edit/persist, test button reports, hints for the silent cases');
}

// ─────────────────── in-page overlay (alert channel) ──────────────────────
// The overlay draws into the page, so the test needs a DOM: just enough of
// createElement/appendChild/removeChild/getElementById for the fixed layer and
// its cards, with textContent kept as a plain string the assertions can read.
function makeFakeElement(tag) {
  return {
    tagName: String(tag || '').toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    id: '',
    textContent: '',
    dataset: {},
    attributes: {},
    onclick: null,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i !== -1) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
  };
}
function installFakeDom(sandbox) {
  const html = makeFakeElement('html');
  const head = makeFakeElement('head');
  const body = makeFakeElement('body');
  html.appendChild(head);
  html.appendChild(body);
  const walk = (node, fn) => {
    if (!node) return;
    fn(node);
    for (const c of node.children) walk(c, fn);
  };
  const byId = (id) => {
    let hit = null;
    walk(html, (n) => { if (!hit && n.id === id) hit = n; });
    return hit;
  };
  Object.assign(sandbox.document, {
    body,
    head,
    documentElement: html,
    createElement: (tag) => makeFakeElement(tag),
    getElementById: (id) => byId(id),
    // The bundle asks exactly one selector question (is the style tag already
    // there?), so answer that one honestly and nothing else.
    querySelector: (sel) => {
      if (String(sel).indexOf('data-plugin-css') === -1) return null;
      let found = null;
      walk(html, (n) => { if (!found && n.dataset && n.dataset.pluginCss) found = n; });
      return found;
    },
  });
  return { html, head, body, byId };
}
function domText(el, out) {
  out = out || [];
  if (el == null) return out;
  if (typeof el === 'string') { out.push(el); return out; }
  if (el.textContent) out.push(String(el.textContent));
  for (const c of el.children) domText(c, out);
  return out;
}
function findDom(root, pred) {
  let hit = null;
  const walk = (node) => {
    if (!node || hit) return;
    if (pred(node)) { hit = node; return; }
    for (const c of node.children) walk(c);
  };
  walk(root);
  return hit;
}

// 1.11.0 removed the in-page overlay as an alert channel: every alert is a
// system notification now. The card layer survives for one job — carrying
// Approve / Reject where the desktop shell's toast cannot (desktopFallbackCard
// owns that path) — so this suite pins what outlived the channel: ordinary
// alerts draw nothing, the corner setting still applies, diagnostics report a
// `card` block instead of a `channel`, and a config written by 1.10.x loads,
// ignores its dead channel keys and self-cleans on the next write.
async function cardLayer() {
  console.log('\n— in-page card layer: approvals only —');
  let dom = null;
  let store = null;
  const boot = (opts) => bootBundle({
    withNotification: !!(opts && opts.withNotification),
    extend(sandbox, windowStub) {
      dom = installFakeDom(sandbox);
      store = sandbox.localStorage;
      sandbox.location = { origin: 'dsh-app://app', protocol: 'dsh-app:' };
      // The bridge refuses to register without knowing this bundle's combo URL.
      windowStub.__DSH_BOOT__ = { entries: [{ id: 'dsh-notify-me', url: '/plugins/??dsh-notify-me/client.js&rev=abc' }] };
      sandbox.navigator = {
        serviceWorker: {
          register() { return Promise.reject(new Error('allowServiceWorkers is off')); },
          addEventListener() {},
        },
      };
      if (opts && opts.seed) store.setItem('dshNotifyMe.config', JSON.stringify(opts.seed));
      if (opts && opts.extend) opts.extend(sandbox);
    },
  });
  const layer = () => dom.byId('dsh-notify-me-overlay');
  const cards = () => (layer() ? layer().children.slice() : []);
  const cardText = (card) => domText(card).join(' ');

  // 1) An ordinary alert draws no card: the page is untouched and the system
  //    notification is the only surface. This is the point of removing it.
  const plain = boot({ withNotification: true });
  const papi = plain.win.__dshNotifyMe;
  papi.test('attention');
  papi.test('done');
  assert(!layer(), 'attention/done alerts draw no card, got ' + (layer() && layer().className));
  assert(!!plain.lastNotification(), 'the system notification still fires');

  // 2) An approval lands on the card — the desktop bridge is unusable here —
  //    in the configured corner and with its buttons.
  const b = boot({ withNotification: true });
  const api = b.win.__dshNotifyMe;
  // The bridge only registers once the plugin is mounted on a host context.
  b.mod.apply(buildHost({ withSessionStatus: true, withWorkspace: true }).ctx);
  await sleep(20); // the registration rejection lands on a promise tick
  assert(String(api.debug().bridge).indexOf('failed:') === 0,
    'the bridge really is unusable, got ' + api.debug().bridge);
  api.test('approval');
  assert(layer(), 'the approval card mounts');
  assert(layer().className === 'dnm-ov-layer dnm-ov-bottom-right',
    'the default corner is bottom-right, got ' + layer().className);
  assert(cards().length === 1, 'one card per approval, got ' + cards().length);
  assert(cardText(cards()[0]).indexOf('测试审批') !== -1, 'the card carries the approval copy');
  assert(findDom(cards()[0], (n) => n.className === 'dnm-ov-btn dnm-ov-approve'), 'the approve button is on the card');

  // 3) The corner setting still moves the layer; nonsense falls back.
  api.setConfig({ overlayCorner: 'top-left' });
  assert(layer().className === 'dnm-ov-layer dnm-ov-top-left', 'the layer follows the corner setting');
  api.setConfig({ overlayCorner: 'middle-of-nowhere' });
  assert(layer().className === 'dnm-ov-layer dnm-ov-bottom-right', 'an unknown corner falls back to bottom-right');

  // 4) Diagnostics report the card layer, not a channel.
  const d = api.debug();
  assert(!('channel' in d) && !('toast' in d) && !('overlay' in d),
    'debug carries no channel block, got ' + JSON.stringify(Object.keys(d)));
  assert(d.card && d.card.corner === 'bottom-right' && d.card.cards === 1,
    'debug reports the live card state, got ' + JSON.stringify(d.card));

  // 5) A config written by 1.10.x still loads: its channel keys are ignored (and
  //    dropped by the next write) and they do not resurrect the old overlay.
  const legacy = boot({ withNotification: true, seed: { channel: 'overlay', overlay: true, toast: false, enabled: true } });
  const lapi = legacy.win.__dshNotifyMe;
  assert(!('channel' in lapi.debug()), 'the legacy channel key is not read back');
  lapi.test('attention');
  assert(!!legacy.lastNotification(), 'the legacy config does not silence system notifications');
  assert(!layer(), 'and it does not turn the old overlay back on');
  lapi.setConfig({ volume: 0.5 });
  const stored = JSON.parse(store.getItem('dshNotifyMe.config'));
  assert(!('channel' in stored) && !('overlay' in stored) && !('toast' in stored),
    'the next write scrubs the dead keys, got ' + JSON.stringify(stored));

  // 6) An actionable card still fades on its own schedule instead of camping.
  const delays = [];
  const timed = boot({
    withNotification: true,
    extend(sandbox) {
      const real = sandbox.setTimeout;
      sandbox.setTimeout = (fn, ms) => { delays.push(ms); return real(fn, ms); };
    },
  });
  await sleep(20);
  timed.win.__dshNotifyMe.test('approval');
  assert(delays.indexOf(12000) !== -1, 'an actionable card arms a 12s fade, got ' + JSON.stringify(delays));

  console.log('card layer OK: alerts draw no cards, approvals do, corner + diagnostics + legacy config clean');
}

// ───────────── desktop shell: approvals decided on the in-page card ─────────
// The desktop shell (location.protocol 'dsh-app:') cannot register the Service
// Worker that OS action buttons need, so an approval toast there has nothing to
// press. The alert therefore also drops a card into the same in-page layer, in
// the same corner and with the same styling, whose buttons call decidePending()
// — the exact path a Web toast button takes. The Web path (worker active) must
// stay untouched, and the quick-decision switch still governs the buttons.
async function desktopFallbackCard() {
  console.log('\n— desktop shell: the approval card carries the buttons —');
  let dom = null;
  const useFakeDom = (sandbox, windowStub) => {
    dom = installFakeDom(sandbox);
    sandbox.location = { origin: 'dsh-app://app', protocol: 'dsh-app:' };
    // The bridge refuses to register without knowing this bundle's combo URL.
    windowStub.__DSH_BOOT__ = { entries: [{ id: 'dsh-notify-me', url: '/plugins/??dsh-notify-me/client.js&rev=abc' }] };
  };
  // The host has no allowServiceWorkers privilege: registration never resolves
  // to an active worker, exactly like the shipped Electron shell.
  const failingWorker = (sandbox) => {
    sandbox.navigator = {
      serviceWorker: {
        register() { return Promise.reject(new Error('allowServiceWorkers is off')); },
        addEventListener() {},
      },
    };
  };
  const boot = (opts) => bootBundle({
    withNotification: !!(opts && opts.withNotification),
    extend(sandbox, windowStub) {
      useFakeDom(sandbox, windowStub);
      failingWorker(sandbox);
      if (opts && opts.extend) opts.extend(sandbox, windowStub);
    },
  });
  const layer = () => dom.byId('dsh-notify-me-overlay');
  const cards = () => (layer() ? layer().children.slice() : []);
  const cardText = (card) => domText(card).join(' ');
  const button = (root, cls) => findDom(root, (n) => n.className === 'dnm-ov-btn ' + cls);
  const attach = (b) => {
    const host = buildHost({ withSessionStatus: true, withWorkspace: true });
    b.mod.apply(host.ctx);
    return host;
  };

  // 1) An approval while the page is away: the toast still fires (the channel
  //    did not change) and the card carries the two decisions in the corner.
  const b = boot({ withNotification: true });
  const host = attach(b);
  await sleep(20); // the registration rejection lands on a promise tick
  const api = b.win.__dshNotifyMe;
  assert(String(api.debug().bridge).indexOf('failed:') === 0,
    'the shell cannot register a worker, got ' + api.debug().bridge);
  b.doc.hidden = true; b.doc.visibilityState = 'hidden';
  const answers = [];
  host.setStatus(new Map([['s1', statusRow(answerableApproval('approval:300', null, answers))]]));
  host.notifyStatus();
  await sleep(20);

  const toast = b.lastNotification();
  assert(toast && toast.title.indexOf('审批') !== -1, 'the system toast still fires: the channel did not change');
  assert(layer(), 'the fallback card mounts in the window corner');
  assert(layer().className === 'dnm-ov-layer dnm-ov-bottom-right', 'it reuses the overlay layer corner, got ' + layer().className);
  assert(cards().length === 1, 'one card per waiting approval, got ' + cards().length);
  const card = cards()[0];
  assert(card.className.indexOf('dnm-ov-attention') !== -1, 'it reuses the overlay attention styling, got ' + card.className);
  assert(card.getAttribute('role') === 'alert', 'the card is announced as an alert');
  assert(cardText(card).indexOf('needs elevated shell') !== -1, 'the card carries the approval details');
  const approve = button(card, 'dnm-ov-approve');
  const reject = button(card, 'dnm-ov-reject');
  assert(approve && approve.textContent === '同意', 'the card carries 同意');
  assert(reject && reject.textContent === '拒绝', 'the card carries 拒绝');

  // The body is clamped by CSS; a 详情 toggle opens it in place.
  const more = findDom(card, (n) => n.className === 'dnm-ov-more');
  assert(more && more.textContent === '详情' && more.getAttribute('aria-expanded') === 'false',
    'the card starts with its details folded');
  more.onclick();
  assert(card.className.indexOf('dnm-ov-open') !== -1 && more.getAttribute('aria-expanded') === 'true',
    '详情 expands the body');
  assert(more.textContent === '收起', 'the toggle switches to 收起');
  more.onclick();
  assert(card.className.indexOf('dnm-ov-open') === -1, '收起 folds the body back');

  // A click on the card is a look, not a decision: the card must stay.
  card.onclick();
  assert(cards().length === 1, 'clicking the card does not take an unanswered approval down');

  // 2) 同意 runs the same decidePending() chain a worker button press runs.
  approve.onclick();
  await sleep(20);
  assert(answers.length === 1 && answers[0] === 'allowed-once',
    'the card button answers the live approval, got ' + JSON.stringify(answers));
  assert(cards().length === 0, 'the settled card is removed');
  assert(api.debug().actionKeys.length === 0, 'no pending action is left behind');
  assert(b.events.some((e) => e.kind === 'decision' && e.key === 'approval:300' && e.outcome === 'allowed-once'),
    'the decision reaches onEvent listeners like a toast button press');

  // 3) 拒绝 is the other decision, on its own card.
  const rejected = [];
  host.setStatus(new Map([['s1', statusRow(answerableApproval('approval:301', null, rejected))]]));
  host.notifyStatus();
  await sleep(20);
  assert(cards().length === 1, 'the next approval draws its own card');
  button(cards()[0], 'dnm-ov-reject').onclick();
  await sleep(20);
  assert(rejected.length === 1 && rejected[0] === 'rejected',
    'the reject button rejects, got ' + JSON.stringify(rejected));
  assert(cards().length === 0, 'the rejected card is removed');

  // 4) A wait that ends elsewhere takes its card down too (unmarkAttention).
  host.setStatus(new Map([['s1', statusRow(answerableApproval('approval:302', null, []))]]));
  host.notifyStatus();
  await sleep(20);
  assert(cards().length === 1, 'a waiting approval owns a card');
  host.setStatus(new Map());
  host.notifyStatus();
  await sleep(20);
  assert(cards().length === 0, 'the card leaves when the wait ends elsewhere');

  // 5) One card per approval key: a second delivery for the same key must not
  //    stack. The test key is "test:approval:<now>", so a frozen clock makes two
  //    presses collide on one key deterministically.
  const dup = bootBundle({
    extend(sandbox, windowStub) {
      useFakeDom(sandbox, windowStub);
      failingWorker(sandbox);
      sandbox.Date = class extends Date { static now() { return 1700000000000; } };
    },
  });
  attach(dup);
  await sleep(20);
  dup.win.__dshNotifyMe.test('approval');
  dup.win.__dshNotifyMe.test('approval');
  assert(cards().length === 1, 'the same approval key never stacks a second card, got ' + cards().length);
  assert(dup.win.__dshNotifyMe.debug().actionKeys.length === 1, 'the duplicate leaves one pending action');

  // 6) The quick-decision switch still governs the card: off means nothing to
  //    press, and no extra card — the alert is a plain toast, like the Web path.
  const off = boot({ withNotification: true });
  const offHost = attach(off);
  await sleep(20);
  off.win.__dshNotifyMe.setConfig({ quickActions: false });
  off.doc.hidden = true; off.doc.visibilityState = 'hidden';
  offHost.setStatus(new Map([['s1', statusRow(answerableApproval('approval:400', null, []))]]));
  offHost.notifyStatus();
  await sleep(20);
  const offToast = off.lastNotification();
  assert(offToast && offToast.title.indexOf('审批') !== -1, 'the alert is still raised as a plain toast');
  assert(!layer(), 'with quick decisions off no fallback card is drawn');
  assert(!findDom(dom.body, (n) => n.className === 'dnm-ov-btn dnm-ov-approve' || n.className === 'dnm-ov-btn dnm-ov-reject'),
    'and no approve/reject button exists');

  // 7) The card reuses the overlay's 12s budget; a click must not cut it short.
  const delays = [];
  const timed = bootBundle({
    extend(sandbox, windowStub) {
      useFakeDom(sandbox, windowStub);
      failingWorker(sandbox);
      sandbox.setTimeout = (fn, ms) => { delays.push({ fn, ms }); return 0; };
      sandbox.clearTimeout = () => {};
    },
  });
  const timedHost = attach(timed);
  await sleep(20);
  timed.doc.hidden = true; timed.doc.visibilityState = 'hidden';
  timedHost.setStatus(new Map([['s1', statusRow(answerableApproval('approval:500', null, []))]]));
  timedHost.notifyStatus();
  assert(cards().length === 1, 'the timed fallback card is up');
  const actionTimer = delays.filter((d) => d.ms === 12000);
  assert(actionTimer.length === 1, 'the fallback card reuses the 12s overlay budget, got ' + JSON.stringify(delays.map((d) => d.ms)));
  cards()[0].onclick();
  assert(cards().length === 1, 'a look does not shorten the 12s');
  actionTimer[0].fn();
  assert(cards().length === 0, 'the card fades when the 12s budget ends');

  // 8) Web untouched: with the worker up the approval stays on the OS toast and
  //    nothing is drawn into the page, even though this page has a DOM.
  const web = bootBundle({
    withNotification: true,
    extend(sandbox, windowStub) {
      dom = installFakeDom(sandbox);
      windowStub.__DSH_BOOT__ = { entries: [{ id: 'dsh-notify-me', url: '/plugins/??dsh-notify-me/client.js&rev=abc' }] };
      sandbox.navigator = {
        serviceWorker: {
          register() {
            return Promise.resolve({ active: {}, showNotification() {}, getNotifications() { return []; } });
          },
          addEventListener() {},
        },
      };
    },
  });
  const webHost = attach(web);
  await sleep(20);
  assert(web.win.__dshNotifyMe.debug().bridge === 'active',
    'the web worker is active, got ' + web.win.__dshNotifyMe.debug().bridge);
  web.doc.hidden = true; web.doc.visibilityState = 'hidden';
  webHost.setStatus(new Map([['s1', statusRow(answerableApproval('approval:600', null, []))]]));
  webHost.notifyStatus();
  await sleep(20);
  assert(!layer() && cards().length === 0, 'an active worker keeps the approval on the OS toast: no page card');

  console.log('desktop fallback OK: card + 同意/拒绝 + 详情, same 12s, switch-gated, web path unchanged');
}

function settingsAlertSetup() {
  console.log('\n— settings page: no channel choice, card corner under quick decisions —');
  const base = settingsBoot();
  assert(base.text.indexOf('浮层提醒') === -1, 'the overlay channel option is gone');
  assert(base.text.indexOf('通知类型') === -1, 'the alert-type row is gone');
  assert(base.text.indexOf('两个只能选一个') === -1, 'the pick-one hint is gone');
  assert(base.findAll((n) => n.props && n.props.role === 'radio').length === 0,
    'no segmented channel control is left behind');
  // The explanation hangs off the label text only — hovering a switch or a
  // slider must not pop a box the user did not ask for.
  const tips = base.findAll((n) => n.props && String(n.props.className || '').indexOf('dnm-rowTip') !== -1);
  assert(tips.length > 0, 'explained rows mark something as the tooltip target');
  assert(tips.every((n) => String(n.props.className).indexOf('dnm-rowLabel') !== -1),
    'only the label text carries the tooltip');

  // The card exists to carry approvals the Desktop toast cannot, so its corner
  // hangs under the quick-decision switch and needs no extra click to reach.
  const corner = base.find((n) => n.props && n.props['aria-label'] === '审批卡片位置');
  assert(corner && corner.props.value === 'bottom-right',
    'the approval-card corner select renders, got ' + (corner && corner.props.value));
  assert(base.text.indexOf('桌面端审批卡片贴在') !== -1, 'the hint says what the card is for');
  corner.props.onChange({ currentTarget: { value: 'top-left' } });
  assert(base.configNow().overlayCorner === 'top-left', 'corner edits land in config');

  // With quick decisions off there is no card, so its corner row goes away too.
  base.press('审批通知上直接裁决');
  assert(base.configNow().quickActions === false, 'the quick-decision switch persisted');
  assert(!base.find((n) => n.props && n.props['aria-label'] === '审批卡片位置'),
    'no corner row once quick decisions are off');
  base.cleanup();

  // A config written by 1.10.x still renders: the channel keys mean nothing now
  // and reading them back must not crash or silence anything.
  const legacy = settingsBoot({ channel: 'overlay', overlay: true, toast: false });
  assert(legacy.text.length > 0, 'a legacy channel config still renders the page');
  assert(legacy.configNow().channel === undefined && legacy.configNow().overlay === undefined,
    'readConfig scrubs the dead channel keys, got ' + JSON.stringify(legacy.configNow().channel));
  assert(legacy.text.indexOf('审批卡片位置') !== -1, 'the card-corner row still renders for it');
  legacy.cleanup();

  console.log('alert setup OK: channel picker gone, card corner under quick decisions, legacy configs load');
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

(async () => {
  await legacyHost();
  await currentHost();
  await modernHost();
  await subagentSessions();
  await completionUnreadChannel();
  await quickActionsHost();
  await desktopRaiseChannel();
  await soundSources();
  uniqueToastTags();
  settingsSoundRows();
  await externalWebhooks();
  await settingsExternalRows();
  await cardLayer();
  await desktopFallbackCard();
  settingsAlertSetup();
  await listChangeDerivation();
  await awayWithoutHiding();
  await awayWhileFocusedAndIdle();
  await donePolicyScopes();
  await autoDismissPolicy();
  console.log('\nALL SMOKE TESTS PASSED ✔');
  // Exit explicitly: marker-release timers stay armed on purpose (they mirror
  // browser behaviour) and would otherwise hold the loop open.
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
