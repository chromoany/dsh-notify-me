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
// The reply-finished channel (running/completed) is host-independent.
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
    mod: captured.reg.factory(() => ({})),
    win: windowStub,
    doc: documentStub,
    events,
    getTitle: () => title,
    lastNotification: () => lastNotification,
    // Drive a real visibilitychange the way the browser would.
    fireVisibility: () => { for (const fn of [...docListeners.visibilitychange]) fn(); },
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

  // 5) doneHiddenOnly default suppresses "done" while the page is visible
  events.length = 0;
  doc.hidden = false; doc.visibilityState = 'visible';
  await sleep(400);
  host.setList({ ids: ['bg1'], byId: { bg1: { running: true, displayTitle: 'x', completed: false } }, current: 's1', phase: 'ready' });
  host.notifyList();
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
function bootWorker(HubCtor) {
  const handlers = {};
  let loadCalls = 0;
  const selfStub = {
    registration: { scope: '/plugins/' },
    addEventListener(type, fn) { handlers[type] = fn; },
    clients: { matchAll: () => Promise.resolve([]) },
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
  const w = bootWorker(HubCtor);
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

  for (const c of [...host.cleanups]) c();
  console.log('quick-decision bridge OK:', JSON.stringify({
    registered: registered[0],
    decisions: answers.concat(answers2, answers3),
  }));
}

// ────────── subagent sessions stay quiet by default (1.4.0) ──────────
// DSH lists every subagent's child session as an ordinary row (origin:
// 'subagent', parentId: <parent>), so a watcher that walks the whole list
// alerts for a step of a conversation the user never started. The mute keys on
// that origin field alone: a forked session (parentId set, no origin) is still
// the user's own conversation and keeps alerting.
async function subagentSessions() {
  console.log('\n— subagent sessions (origin: "subagent") are muted by default —');
  const b = bootBundle();
  const host = buildHost({ withSessionStatus: true, withWorkspace: true });
  const { mod, win, doc, events, getTitle } = b;
  const cur = { running: false, displayTitle: '当前会话', retainedBy: { mainView: 1 } };
  const bg = (title, extra) => Object.assign({ running: true, displayTitle: title, retainedBy: {} }, extra || {});
  const child = (title, extra) => bg(title, Object.assign({ origin: 'subagent', parentId: 's1' }, extra || {}));
  const fork = (title) => bg(title, { parentId: 's1' });

  mod.apply(host.ctx);
  win.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });
  assert(win.__dshNotifyMe.config.ignoreSubagent === true, 'ignoreSubagent defaults to true');
  assert(win.__dshNotifyMe.debug().ignoreSubagent === true, 'debug() reports ignoreSubagent');

  // 1) a subagent finishing raises nothing; a normal background session still does
  doc.hidden = true; doc.visibilityState = 'hidden';
  host.setList({ ids: ['s1', 'sub1', 's2'], byId: { s1: cur, sub1: child('子代理：探索'), s2: bg('后台任务') }, phase: 'ready' });
  host.notifyList();
  events.length = 0;
  host.setList({ ids: ['s1', 'sub1', 's2'], byId: { s1: cur, sub1: child('子代理：探索', { running: false }), s2: bg('后台任务', { running: false }) }, phase: 'ready' });
  host.notifyList();
  const done = events.filter((e) => e.kind === 'done');
  assert(done.length === 1, 'only the normal session reports "reply finished", got ' + JSON.stringify(done));
  assert(done[0].body === '后台任务', 'the surviving alert is the normal session, got ' + JSON.stringify(done[0].body));

  // 2) a subagent's wait never alerts and never marks the tab
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

  for (const c of [...host.cleanups]) c();
}

(async () => {
  await legacyHost();
  await currentHost();
  await modernHost();
  await subagentSessions();
  await quickActionsHost();
  console.log('\nALL SMOKE TESTS PASSED ✔');
  // Exit explicitly: marker-release timers stay armed on purpose (they mirror
  // browser behaviour) and would otherwise hold the loop open.
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
