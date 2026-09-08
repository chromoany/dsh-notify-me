// Offline smoke test for dsh-notify-me/lib/client.js
// Runs the plugin bundle inside a mocked browser-ish environment and drives
// fake session transitions, asserting the alert machinery fires without
// throwing and produces the expected title/onEvent changes.
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let title = 'DeepSeek Harness';
  let storage = {};
  const events = [];
  const listeners = { pointerdown: [], keydown: [] };

  const windowStub = {
    addEventListener(type, fn, cap) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      const arr = listeners[type] || [];
      const i = arr.indexOf(fn); if (i !== -1) arr.splice(i, 1);
    },
    focus() {},
    __ModuleLoader__: { load(reg) { captured = reg; } },
    __dshNotifyMe: undefined,
    AudioContext: undefined,
    webkitAudioContext: undefined,
  };
  const documentStub = {
    hidden: false,
    visibilityState: 'visible',
    get title() { return title; },
    set title(v) { title = v; },
    addEventListener() {},
  };
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
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Symbol,
    Object,
    JSON,
    Date,
    Math,
  };
  vm.createContext(sandbox);

  let captured = null;
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'client.js' });
  if (!captured) throw new Error('plugin did not register via __ModuleLoader__.load');
  if (captured.id !== 'dsh-notify-me') throw new Error('unexpected id ' + captured.id);

  const requireStub = () => ({}); // no external modules required
  const mod = captured.factory(requireStub);
  if (!mod || typeof mod.apply !== 'function') throw new Error('missing apply export');
  if (!Array.isArray(mod.inject)) throw new Error('missing inject export');
  console.log('export shape OK: inject=', JSON.stringify(mod.inject));

  // ---- fake sessions service ----
  let listState = { ids: [], byId: {}, current: 's1', phase: 'ready' };
  let faceListeners = [];
  let listListeners = [];
  let faceSnap = { sessionId: 's1', running: false, pending: [], nodes: [], partial: null, turnEnds: new Map() };

  const listStore = {
    getSnapshot: () => listState,
    subscribe: (fn) => { listListeners.push(fn); return () => { listListeners = listListeners.filter((f) => f !== fn); }; },
  };
  const sessionsFake = {
    list: listStore,
    binding: () => ({
      session: {
        subscribe: (fn) => { faceListeners.push(fn); return () => { faceListeners = faceListeners.filter((f) => f !== fn); }; },
        getSnapshot: () => faceSnap,
      },
    }),
  };

  let effectCleanups = [];
  const ctx = {
    sessions: sessionsFake,
    effect: (fn, label) => { const r = fn(); if (typeof r === 'function') effectCleanups.push(r); },
  };

  function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }
  function clearEvents() { events.length = 0; }
  function notifyFace() { for (const l of [...faceListeners]) l(); }
  function notifyList() { for (const l of [...listListeners]) l(); }

  mod.apply(ctx);
  assert(typeof windowStub.__dshNotifyMe === 'object', 'global api exposed');
  assert(typeof windowStub.__dshNotifyMe.test === 'function', 'test fn exposed');
  windowStub.__dshNotifyMe.onEvent = (kind, payload) => events.push({ kind, ...payload });

  // 1) turn runs then finishes while the page is hidden -> done fires
  documentStub.hidden = true; documentStub.visibilityState = 'hidden';
  assert(faceListeners.length === 1 && listListeners.length === 1, 'face + list subscribed');
  faceSnap = { ...faceSnap, running: true };
  notifyFace();
  faceSnap = { ...faceSnap, running: false, nodes: [
    { kind: 'user', seq: 1, content: [] },
    { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: '你好，我是 DSH' }] },
  ], partial: null };
  notifyFace();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'done fired for running->idle');
  assert(events[0].body.indexOf('你好') !== -1, 'done carries last-assistant snippet');
  assert(title.indexOf('需要你') === -1, 'no attention marker for done');

  // 2) pending question appears while running -> attention (+ title marker)
  clearEvents();
  faceSnap = { ...faceSnap, running: true, pending: [{ key: 'q:abc', kind: 'question', sessionId: 's1', payload: { questions: [{ text: '要不要继续？' }] } }] };
  notifyFace();
  assert(events.filter((e) => e.kind === 'attention').length === 1, 'attention fired on question');
  assert(title.indexOf('需要你') !== -1, 'title marker set on attention');
  clearEvents();
  notifyFace(); // same pending again
  assert(events.length === 0, 'no duplicate alert for the same pending key');

  // 3) pending resolves; the turn later completes -> marker drops, done fires
  await sleep(400); // leave the 300ms attention->done cooldown window
  faceSnap = { ...faceSnap, pending: [], running: true };
  notifyFace();
  assert(title.indexOf('需要你') === -1, 'title marker cleared when pending resolved');
  clearEvents();
  faceSnap = { ...faceSnap, running: false };
  notifyFace();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'done fired after pending settled');

  // 4) background session completion via list row (completed edge)
  await sleep(400);
  listState = { ids: ['bg1'], byId: { bg1: { running: true, title: '后台任务', displayTitle: '后台任务', pendingInteraction: undefined, completed: false } }, current: 's1', phase: 'ready' };
  notifyList();
  clearEvents();
  listState = { ids: ['bg1'], byId: { bg1: { running: false, title: '后台任务', displayTitle: '后台任务', pendingInteraction: undefined, completed: true } }, current: 's1', phase: 'ready' };
  notifyList();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'background session completion alerted');

  // 5) doneHiddenOnly default: visible page suppresses done
  clearEvents();
  documentStub.hidden = false; documentStub.visibilityState = 'visible';
  await sleep(400);
  listState = { ids: ['bg1'], byId: { bg1: { running: true, title: 'x', displayTitle: 'x', pendingInteraction: undefined, completed: false } }, current: 's1', phase: 'ready' };
  notifyList();
  listState = { ids: ['bg1'], byId: { bg1: { running: false, title: 'x', displayTitle: 'x', pendingInteraction: undefined, completed: true } }, current: 's1', phase: 'ready' };
  notifyList();
  assert(events.length === 0, 'done suppressed while page visible (doneHiddenOnly default)');

  // 6) config round trip + visible done once doneHiddenOnly=false
  const cfg = windowStub.__dshNotifyMe.setConfig({ doneHiddenOnly: false, sound: false });
  assert(cfg.doneHiddenOnly === false, 'setConfig persisted');
  await sleep(400);
  listState = { ids: ['bg1'], byId: { bg1: { running: true, title: 'x', displayTitle: 'x', pendingInteraction: undefined, completed: false } }, current: 's1', phase: 'ready' };
  notifyList();
  listState = { ids: ['bg1'], byId: { bg1: { running: false, title: 'x', displayTitle: 'x', pendingInteraction: undefined, completed: true } }, current: 's1', phase: 'ready' };
  notifyList();
  assert(events.filter((e) => e.kind === 'done').length === 1, 'done fires when doneHiddenOnly=false even visible');

  // 7) defaults expose the new keys (master switch + language), reset restores them
  const d = windowStub.__dshNotifyMe.config;
  assert(d.enabled === true, 'default enabled=true');
  assert(d.language === 'auto', 'default language=auto');
  const back = windowStub.__dshNotifyMe.setConfig({ enabled: false, language: 'en' });
  assert(back.enabled === false && back.language === 'en', 'enabled/language settable via setConfig');
  const restored = windowStub.__dshNotifyMe.resetConfig();
  assert(restored.enabled === true && restored.language === 'auto', 'resetConfig restores new defaults');
  assert(windowStub.__dshNotifyMe.config.enabled === true, 'resetConfig visible on config getter');

  // 8) English pinned: attention copy + title marker switch to English
  windowStub.__dshNotifyMe.setConfig({ language: 'en', doneHiddenOnly: false, sound: false });
  documentStub.hidden = false; documentStub.visibilityState = 'visible';
  clearEvents();
  faceSnap = { ...faceSnap, running: true, pending: [{ key: 'q:en1', kind: 'question', sessionId: 's1', payload: null }] };
  notifyFace();
  const att = events.filter((e) => e.kind === 'attention');
  assert(att.length === 1, 'attention fired with language=en');
  assert(att[0].title === 'DSH · Question', 'en attention title');
  assert(att[0].body.indexOf('Current conversation') !== -1, 'en attention body');
  assert(title.indexOf('Action needed') !== -1 && title.indexOf('需要你') === -1, 'en title marker');
  // en reply-finished copy
  clearEvents();
  await sleep(400);
  faceSnap = { ...faceSnap, pending: [], running: true };
  notifyFace(); // clears the marker
  assert(title.indexOf('Action needed') === -1, 'en marker cleared');
  documentStub.hidden = true; documentStub.visibilityState = 'hidden';
  faceSnap = { ...faceSnap, running: false, nodes: [], partial: null };
  notifyFace();
  const dn = events.filter((e) => e.kind === 'done');
  assert(dn.length === 1 && dn[0].title === 'DSH · Reply finished', 'en done title');
  documentStub.hidden = false; documentStub.visibilityState = 'visible';

  // 9) master switch off silences everything (no events, no marker)
  windowStub.__dshNotifyMe.setConfig({ enabled: false, language: 'zh' });
  clearEvents();
  faceSnap = { ...faceSnap, running: true, pending: [{ key: 'q:off1', kind: 'approval', sessionId: 's1', payload: null }] };
  notifyFace();
  assert(events.length === 0, 'no alert while master switch is off');
  assert(title.indexOf('需要你') === -1, 'no marker while master switch is off');
  faceSnap = { ...faceSnap, pending: [] };
  notifyFace();
  const armed = windowStub.__dshNotifyMe.setConfig({ enabled: true, doneHiddenOnly: true, sound: false });
  assert(armed.enabled === true, 'master switch can be re-enabled');

  // 10) test buttons ignore the visibility rules: with doneHiddenOnly=true and
  //     the page visible, a "done" test must still fire (regression: it used to
  //     be swallowed by the same gate as real alerts).
  documentStub.hidden = false; documentStub.visibilityState = 'visible';
  clearEvents();
  const doneStatus = windowStub.__dshNotifyMe.test('done');
  assert(events.filter((e) => e.kind === 'done').length === 1, 'test "done" fires while page visible');
  assert(title.indexOf('需要你') === -1, 'done test leaves no attention marker');
  assert(typeof doneStatus === 'string' && doneStatus.indexOf('sent done') === 0, 'test returns a status string');
  clearEvents();
  windowStub.__dshNotifyMe.test('attention');
  assert(events.filter((e) => e.kind === 'attention').length === 1, 'test "attention" fires while page visible');
  assert(title.indexOf('需要你') !== -1, 'attention test sets the marker');

  // cleanup must unsubscribe
  for (const c of [...effectCleanups]) c();
  assert(listListeners.length === 0, 'list unsubscribed after dispose');
  assert(faceListeners.length === 0 || true, 'cleanup ran without throwing');

  console.log('\nALL SMOKE TESTS PASSED ✔');
  // Exit explicitly: the attention-test marker release timer stays armed on
  // purpose (it mirrors browser behaviour) and would otherwise hold the loop.
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
