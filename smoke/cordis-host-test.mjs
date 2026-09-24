// Real-cordis end-to-end test for dsh-notify-me/lib/client.js
//
// Why this file exists: smoke-test.cjs drives the plugin through a HAND-WRITTEN
// ctx object, so `ctx.uiSession` always resolves there no matter what cordis
// actually does. The plugin shipped 1.1.5 with a dead needs-input channel for
// exactly that blind spot — cordis throws `cannot get property "uiSession"
// without inject` for any service the plugin did not declare in `inject`, and
// the plugin's try/catch swallowed it, so the uiSession watcher never bound on
// any 0.1.2+ host.
//
// This test loads the same bundle into a REAL cordis root, has a sibling plugin
// provide the services (uiSession included), and asserts the whole chain:
// service reachable -> watcher bound -> approval in the interaction store ->
// an attention alert in the page. It skips (exit 0) when no DSH installation
// is present to borrow cordis from.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(60);
function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

// Borrow cordis from the DSH installation on this machine.
function findCordis() {
  const win = process.env.APPDATA || '';
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const bases = [
    process.env.DSH_NODE_MODULES,
    path.join(win, 'npm', 'node_modules'),
    path.join(home, '.dsh', 'profiles', 'web', 'node_modules'),
  ].filter(Boolean);
  const candidates = [];
  if (process.env.DSH_CORDIS_PATH) candidates.push(process.env.DSH_CORDIS_PATH);
  for (const base of bases) {
    candidates.push(path.join(base, '@deepseek-ai', 'cordis', 'lib', 'index.js'));
    candidates.push(path.join(base, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js'));
  }
  try { candidates.push(createRequire(import.meta.url).resolve('@deepseek-ai/cordis')); } catch (e) { /* not installed locally */ }
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

// Boot the plugin bundle over a mocked browser and return its module exports
// plus the handles the test drives.
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

// The Controller-side stubs (session list + selected-session snapshot).
function makeController() {
  const listeners = { list: [], face: [] };
  let listState = { ids: [], byId: {}, current: 's1', phase: 'ready' };
  let faceSnap = { sessionId: 's1', running: false, pending: [], nodes: [], partial: null };
  const sessions = {
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
  return {
    sessions, listeners,
    faceSnap: () => faceSnap,
    setFace: (v) => { faceSnap = v; },
    notifyFace: () => { for (const f of [...listeners.face]) f(); },
    setList: (v) => { listState = v; },
    notifyList: () => { for (const f of [...listeners.list]) f(); },
  };
}

// Approval shaped like the shipped 0.1.2+ PendingApproval (class instance).
class FakeApproval {
  constructor(key, sessionId, toolName, reason) {
    this.key = key; this.kind = 'approval'; this.sessionId = sessionId;
    this.toolName = toolName; this.reason = reason;
  }
}

async function main() {
  const cordisPath = findCordis();
  if (!cordisPath) {
    console.log('SKIP cordis-host-test: no DSH installation to borrow @deepseek-ai/cordis from');
    return;
  }
  const { Context, Service } = await import(pathToFileURL(cordisPath).href);
  console.log('cordis:', cordisPath);

  // Host with the interaction store: DSH >= 0.1.2-alpha.2.
  class FakeUiSession extends Service {
    constructor(ctx) {
      super(ctx, 'uiSession');
      this.snapshot = new Map();
      this.listeners = new Set();
      this.pendingInteractions = {
        getSnapshot: () => this.snapshot,
        subscribe: (fn) => { this.listeners.add(fn); return () => this.listeners.delete(fn); },
      };
    }
    publish(map) {
      this.snapshot = map;
      for (const fn of [...this.listeners]) fn();
    }
  }

  const localeStub = {
    register() {}, bind: () => (k) => k,
    subscribe: () => () => {}, getSnapshot: () => ({ active: 'zh' }),
    getLocale: () => ({ active: 'zh' }),
  };
  const slotsStub = { inject() {}, register() {} };

  async function runHost({ withUiSession }) {
    const b = bootBundle();
    const controller = makeController();
    const root = new Context();
    let uiService = null;
    const probe = {};

    // Sibling entry 1: the host services (what dsh-client-ui-session and the
    // Controller provide on a real boot).
    root.plugin({
      name: 'fake-host-services',
      apply(ctx) {
        ctx.provide('sessions', controller.sessions);
        ctx.provide('locale', localeStub);
        ctx.provide('slots', slotsStub);
        if (withUiSession) uiService = new FakeUiSession(ctx);
      },
    });

    // Sibling entry 2: a semantics probe. This is the regression guard — it
    // pins the cordis behaviour the plugin must survive: a plain service
    // property read throws for a name outside inject, while ctx.get() works.
    root.plugin({
      name: 'cordis-semantics-probe',
      inject: ['sessions'],
      apply(ctx) {
        try { void ctx.uiSession; probe.property = 'ok'; } catch (e) { probe.property = e.message; }
        try { probe.get = !!ctx.get('uiSession'); } catch (e) { probe.get = 'threw: ' + e.message; }
      },
    });

    // Sibling entry 3: the plugin under test, loaded from its real bundle.
    root.plugin({ name: 'dsh-notify-me', inject: b.mod.inject, apply: b.mod.apply });
    await tick();

    assert(b.mod.inject.indexOf('uiSession') === -1,
      'uiSession must NOT be a hard inject entry (hosts older than 0.1.2 have no such service and the entry would stay pending)');
    assert(b.win.__dshNotifyMe.version === PKG_VERSION,
      'api.version (' + b.win.__dshNotifyMe.version + ') != package.json (' + PKG_VERSION + ')');
    return { ...b, controller, uiService, probe, root };
  }

  // ── host with uiSession (DSH >= 0.1.2) ──────────────────────────────
  console.log('\n— real cordis host WITH uiSession —');
  {
    const h = await runHost({ withUiSession: true });
    assert(h.probe.property !== 'ok',
      'probe: a plain ctx.uiSession read should throw on this host (got ' + h.probe.property + ')');
    assert(String(h.probe.property).indexOf('without inject') !== -1,
      'probe: expected the cordis "without inject" error, got: ' + h.probe.property);
    assert(h.probe.get === true, 'probe: ctx.get("uiSession") must resolve the service');
    console.log('cordis semantics OK: property read throws, ctx.get() resolves');

    const dbg = h.win.__dshNotifyMe.debug();
    assert(dbg.uiSession === 'bound', 'plugin must bind the interaction store (debug: ' + JSON.stringify(dbg) + ')');
    console.log('watcher bound OK (uiSessionNote=' + dbg.uiSessionNote + ')');

    // approval appears while the user is away -> one attention alert + marker
    h.doc.hidden = true; h.doc.visibilityState = 'hidden';
    const appr = new FakeApproval('approval:1', 's1', 'pwsh', 'needs elevated shell');
    h.uiService.publish(new Map([['s1', appr]]));
    await tick();
    const att = h.events.filter((e) => e.kind === 'attention');
    assert(att.length === 1, 'approval must raise exactly one attention alert (got ' + att.length + ')');
    assert(att[0].title.indexOf('审批') !== -1, 'zh approval title, got: ' + att[0].title);
    assert(att[0].body.indexOf('pwsh') !== -1, 'body carries the tool name, got: ' + att[0].body);
    assert(h.getTitle().indexOf('需要你') !== -1, 'tab marker set while the approval waits');
    console.log('approval alert OK:', JSON.stringify(att[0]));

    // same interaction re-published -> no duplicate
    h.uiService.publish(new Map([['s1', appr]]));
    await tick();
    assert(h.events.filter((e) => e.kind === 'attention').length === 1, 'no duplicate alert for the same interaction key');

    // answered -> marker drops
    h.uiService.publish(new Map());
    await tick();
    assert(h.getTitle().indexOf('需要你') === -1, 'tab marker cleared once the interaction is answered');
    console.log('dedupe + marker release OK');

    // a wait inside the conversation already on screen: silent while the user
    // is looking at it, delivered once the page goes to the background
    h.doc.hidden = false; h.doc.visibilityState = 'visible';
    const onScreen = new FakeApproval('approval:2', 's1', 'pwsh', 'right here on screen');
    h.uiService.publish(new Map([['s1', onScreen]]));
    await tick();
    assert(h.events.filter((e) => e.kind === 'attention').length === 1,
      'a wait in the conversation on screen must not add an alert');
    assert(h.win.__dshNotifyMe.debug().quietedKeys.indexOf('approval:2') !== -1,
      'the on-screen wait is queued for the background');
    console.log('on-screen wait stayed silent (queued)');

    h.doc.hidden = true; h.doc.visibilityState = 'hidden';
    h.fireVisibility();
    await tick();
    const flushed = h.events.filter((e) => e.kind === 'attention');
    assert(flushed.length === 2, 'the queued wait is delivered once the page is backgrounded (got ' + flushed.length + ')');
    console.log('background flush OK:', JSON.stringify(flushed[1]));
    h.uiService.publish(new Map());
    await tick();
  }

  // ── legacy host (no uiSession service at all) ───────────────────────
  console.log('\n— real cordis host WITHOUT uiSession (legacy controller path) —');
  {
    const h = await runHost({ withUiSession: false });
    assert(h.probe.get === false, 'probe: ctx.get("uiSession") must be undefined on a legacy host');
    const dbg = h.win.__dshNotifyMe.debug();
    assert(dbg.uiSession === 'unbound', 'legacy host must not report a bound interaction store');
    console.log('legacy fallback OK (note=' + dbg.uiSessionNote + ')');

    // the legacy live source: pending inside the selected-session snapshot.
    // The user is away, which is when the controller path has to speak up.
    h.doc.hidden = true; h.doc.visibilityState = 'hidden';
    h.controller.setFace({
      sessionId: 's1', running: true, nodes: [], partial: null,
      pending: [{ key: 'q:legacy1', kind: 'question', sessionId: 's1', payload: { text: '继续吗？' } }],
    });
    h.controller.notifyFace();
    await tick();
    const att = h.events.filter((e) => e.kind === 'attention');
    assert(att.length === 1, 'legacy controller pending must still alert (got ' + att.length + ')');
    console.log('legacy pending alert OK:', JSON.stringify(att[0]));

    // ... and the same source stays silent while that session is on screen
    h.doc.hidden = false; h.doc.visibilityState = 'visible';
    h.events.length = 0;
    h.controller.setFace({
      sessionId: 's1', running: true, nodes: [], partial: null,
      pending: [{ key: 'q:legacy2', kind: 'question', sessionId: 's1', payload: { text: '还在看吗？' } }],
    });
    h.controller.notifyFace();
    await tick();
    assert(h.events.length === 0, 'a legacy on-screen wait stays silent while the page is visible');
    console.log('legacy on-screen wait stayed silent');
  }

  console.log('\ncordis-host-test passed');
}

main().then(() => {
  // The plugin's 1.5s re-bind timer stays armed on purpose (it mirrors the
  // browser), so the event loop would never drain on its own.
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
