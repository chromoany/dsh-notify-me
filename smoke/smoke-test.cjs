// Offline smoke test for dsh-notify-me/lib/client.js
// Runs the plugin bundle inside a mocked browser-ish environment and drives
// fake host state, asserting the alert machinery fires without throwing and
// produces the expected title/onEvent changes.
//
// Two hosts are exercised, because pending interactions have two owners:
//   * legacy  — DSH <= 0.1.1-rc.2: no `uiSession` service; the controller's
//               session snapshot carries `pending: [{key,kind,payload}]`.
//   * current — DSH >= 0.1.2-alpha.2: those snapshots no longer carry
//               `pending`; interactions live in ctx.uiSession.pendingInteractions
//               (a Map<sessionId, interaction>).
// The reply-finished channel (running/completed) is host-independent.
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
function bootBundle() {
  let title = 'DeepSeek Harness';
  const listeners = { pointerdown: [], keydown: [] };
  const captured = {};

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
    Notification: undefined,
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
    },
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Symbol, Object, JSON, Date, Math, Array, String, Number,
  };
  vm.createContext(sandbox);
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
    // Drive a real visibilitychange the way the browser would.
    fireVisibility: () => { for (const fn of [...docListeners.visibilitychange]) fn(); },
  };
}

// The reminder core needs `sessions` + `effect`; `uiSession` is optional and
// only present on the current host. Both are built from plain objects so the
// test can move the host state one notification at a time.
function buildHost({ withUiSession }) {
  const listeners = { list: [], face: [], uiPending: [] };
  let listState = { ids: [], byId: {}, current: 's1', phase: 'ready' };
  let faceSnap = { sessionId: 's1', running: false, pending: [], nodes: [], partial: null };
  let uiSnapshot = new Map();
  const cleanups = [];

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

  return {
    ctx,
    listeners,
    cleanups,
    setList: (v) => { listState = v; },
    setFace: (v) => { faceSnap = v; },
    faceSnap: () => faceSnap,
    setUiPending: (map) => { uiSnapshot = map; },
    notifyList: () => { for (const l of [...listeners.list]) l(); },
    notifyFace: () => { for (const l of [...listeners.face]) l(); },
    notifyUi: () => { for (const l of [...listeners.uiPending]) l(); },
  };
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

  for (const c of [...host.cleanups]) c();
  assert(host.listeners.uiPending.length === 0, 'pendingInteractions unsubscribed after dispose');
}

(async () => {
  await legacyHost();
  await currentHost();
  console.log('\nALL SMOKE TESTS PASSED ✔');
  // Exit explicitly: marker-release timers stay armed on purpose (they mirror
  // browser behaviour) and would otherwise hold the loop open.
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
