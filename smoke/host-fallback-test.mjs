// Host-fallback test: the alerts the host sends while no page is open, and the
// lease that keeps it from sending them twice while one is.
//
// Why its own file: this module's whole value is a state machine over two
// inputs the page never sees — the session event feed and the page lease — and
// every branch it gets wrong is invisible in production. A missed dedupe is a
// notification storm; a lease check on the wrong side of the throttle is a
// missing alert; a credential retry that never happens reads to the user as
// "the gateway password is broken". It needs no cordis and no real gateway, so
// a hand-written ctx and a captured `fetch` can pin all of it.
//
// What is pinned here: the lease gate on both event kinds, release and expiry,
// `pageLeaseMs: 0`, language following the heartbeat, approval dedupe, the
// per-session throttle, the subagent skip, the session title that names a body,
// the copy that must match the page's toast verbatim, the reason suffix, one
// credential retry on 401, and the health probe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const HEALTH = '/__dsh-notify-me/host-fallback';
const BRIDGE = '/__dsh-notify-me/host-bridge';
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const TARGET = 'https://gw.example/hook';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

const host = await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href);

const realFetch = globalThis.fetch;

/**
 * Capture gateway deliveries instead of sending them.
 * @param responder - receives the call list, returns `{ status, text }`.
 * @returns the recorded calls.
 */
function captureFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: init.body });
    const answer = (responder ? responder(calls) : undefined) ?? { status: 200, text: 'ok' };
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, text: async () => answer.text ?? '' };
  };
  return calls;
}

/** Boot the plugin over a hand-written ctx and return the handles to drive it. */
function bootHost(config) {
  const routes = [];
  const handlers = { 'session/event': [], 'session/disposed': [] };
  const warnings = [];
  const effect = (fn) => {
    const off = fn();
    return () => { if (typeof off === 'function') off(); };
  };
  const ctx = {
    logger: { info() {}, warn(message) { warnings.push(String(message)); } },
    on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); return () => {}; },
    effect,
    inject(_services, cb) {
      cb({
        effect,
        webServer: {
          host: '192.168.1.5',
          register(route) {
            routes.push(route);
            return () => { const i = routes.indexOf(route); if (i !== -1) routes.splice(i, 1); };
          },
        },
      });
    },
  };
  host.apply(ctx, config);
  const route = (routePath) => {
    const found = routes.find((candidate) => candidate.path === routePath);
    assert(found !== undefined, 'a route is registered at ' + routePath + ' (got ' + routes.map((r) => r.path).join(', ') + ')');
    return found;
  };
  return {
    routes,
    warnings,
    route,
    emit(session, event) { for (const fn of handlers['session/event'] || []) fn(session, event); },
    disposed(session) { for (const fn of handlers['session/disposed'] || []) fn(session); },
    /** Send one bridge heartbeat and wait for its answer. */
    async beat(body, headers) {
      const beatRoute = route(BRIDGE);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the bridge did not answer a heartbeat')), 3000);
        const res = {
          statusCode: 0,
          writeHead(status) { this.statusCode = status; },
          end() { clearTimeout(timer); resolve(this.statusCode); },
        };
        const listeners = {};
        const req = {
          method: 'POST',
          headers: Object.assign({ host: '127.0.0.1:3080', 'x-dsh-notify-me-page': 'bridge' }, headers || {}),
          socket: { remoteAddress: '127.0.0.1' },
          on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); return req; },
          resume() {},
        };
        setImmediate(() => {
          for (const fn of listeners.data || []) fn(Buffer.from(body));
          for (const fn of listeners.end || []) fn();
        });
        beatRoute.handler(req, res);
      });
    },
    /**
     * Read one route's JSON body. `spec` overrides the request shape the gate
     * looks at: `{ method, host, origin, remoteAddress }`.
     */
    async get(routePath, spec) {
      const found = route(routePath);
      const shape = spec || {};
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error((shape.method || 'GET') + ' ' + routePath + ' did not answer')), 3000);
        const res = {
          statusCode: 0,
          writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
          end(payload) {
            clearTimeout(timer);
            let body = null;
            try { body = payload ? JSON.parse(payload) : null; } catch (e) { body = payload; }
            resolve({ status: this.statusCode, body });
          },
        };
        const req = {
          method: shape.method || 'GET',
          headers: Object.assign({ host: shape.host || '127.0.0.1:3080' }, shape.origin ? { origin: shape.origin } : {}),
          socket: { remoteAddress: shape.remoteAddress || '127.0.0.1' },
          on() { return req; },
          resume() {},
        };
        found.handler(req, res);
      });
    },
  };
}

/** Wait until a predicate holds, or fail loudly instead of hanging. */
async function waitFor(predicate, label) {
  for (let i = 0; i < 400; i += 1) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error('timed out waiting for ' + label);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-me-host-'));
const credFile = path.join(tempDir, 'gateway.json');
const rotatedFile = path.join(tempDir, 'rotated.json');
fs.writeFileSync(credFile, JSON.stringify({ user: 'alice', password: 'old' }), { mode: 0o600 });
fs.writeFileSync(rotatedFile, JSON.stringify({ user: 'alice', password: 'new' }), { mode: 0o600 });

const basic = (user, password) => 'Basic ' + Buffer.from(user + ':' + password, 'utf8').toString('base64');
/** A session header as the host publishes it. */
const session = (id, extra) => ({ header: Object.assign({ id, cwd: '/home/liegu/projects/atlas' }, extra || {}) });
const ALPHA = session('sess-alpha');
const BETA = session('sess-beta', { origin: 'subagent' });

const withAllowList = (origins, over) => Object.assign({ allowedOrigins: origins }, baseConfig(over));
const baseConfig = (over) => ({
  hostFallback: Object.assign(
    {
      enabled: true,
      target: TARGET,
      credentialsFile: credFile,
      events: ['turn/end', 'approval/asked'],
      includeSubagents: false,
      turnEndThrottleMs: 15000,
      titlePrefix: 'DSH',
      language: 'auto',
      pageLeaseMs: 400,
      healthPath: HEALTH,
    },
    over || {},
  ),
});

try {
  // 1) A fresh lease means the page is delivering: the host must stay quiet for
  // both event kinds, or every alert would arrive twice.
  {
    const calls = captureFetch();
    const hostHalf = bootHost(baseConfig());
    assert(await hostHalf.beat(JSON.stringify({ alive: true })) === 200, 'the heartbeat is accepted');
    hostHalf.emit(ALPHA, { type: 'user/message', data: { role: 'user', content: 'review the parser' } });
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    hostHalf.emit(ALPHA, { type: 'approval/asked', data: { id: 'ap-1', toolName: 'shell' } });
    await sleep(60);
    assert(calls.length === 0, 'a fresh lease suppresses both alerts (got ' + calls.length + ')');
    globalThis.fetch = realFetch;
  }

  // 2) `alive:false` hands delivery back immediately, not when the lease would
  // have expired, and the body is the session name — exactly what the page's own
  // toast shows for the same event.
  {
    const calls = captureFetch();
    const hostHalf = bootHost(baseConfig());
    await hostHalf.beat(JSON.stringify({ alive: true }));
    await hostHalf.beat(JSON.stringify({ alive: false }));
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 1, 'the released lease to let a turn alert through');
    const call = calls[0];
    assert(call.url === TARGET, 'the alert goes to the configured gateway, got ' + call.url);
    assert(call.headers['content-type'] === 'application/json', 'the alert is sent as JSON');
    assert(call.headers.authorization === basic('alice', 'old'), 'the credentials file supplies Basic auth, got ' + call.headers.authorization);
    const payload = JSON.parse(call.body);
    assert(payload.title === 'DSH · 回复完成', 'the turn title is the Chinese copy, got ' + JSON.stringify(payload.title));
    assert(payload.body === 'atlas', 'the body is the session name alone, got ' + JSON.stringify(payload.body));
    assert(payload.type === 'info', 'a finished turn is an info alert, got ' + payload.type);
    globalThis.fetch = realFetch;
  }

  // 3) A session/title beats the cwd name, an approval names the tool, and the
  // language follows the last heartbeat rather than the config default.
  {
    const calls = captureFetch();
    const hostHalf = bootHost(baseConfig());
    hostHalf.emit(ALPHA, { type: 'session/title', data: { title: 'Parser rewrite', source: { kind: 'llm' } } });
    hostHalf.emit(ALPHA, { type: 'approval/asked', data: { id: 'ap-2', toolName: 'shell', reason: 'runs rm -rf on the workspace' } });
    await waitFor(() => calls.length === 1, 'an approval on a never-alive lease');
    const cjk = JSON.parse(calls[0].body);
    assert(cjk.title === 'DSH · 审批请求', 'the approval title uses the page label, got ' + JSON.stringify(cjk.title));
    assert(cjk.body === 'Parser rewrite：shell · runs rm -rf on the workspace',
      'the approval body mirrors the page toast (session, colon, tool, reason), got ' + JSON.stringify(cjk.body));
    assert(cjk.type === 'warning', 'an approval is a warning alert, got ' + cjk.type);

    calls.length = 0;
    await hostHalf.beat(JSON.stringify({ alive: true, language: 'en' }));
    await hostHalf.beat(JSON.stringify({ alive: false }));
    hostHalf.emit(ALPHA, { type: 'approval/asked', data: { id: 'ap-3', toolName: 'write' } });
    await waitFor(() => calls.length === 1, 'an approval after an English heartbeat');
    const english = JSON.parse(calls[0].body);
    assert(english.title === 'DSH · Approval request', 'the title follows the heartbeat language, got ' + JSON.stringify(english.title));
    assert(english.body === 'Parser rewrite: write', 'the body follows it too, got ' + JSON.stringify(english.body));
    globalThis.fetch = realFetch;
  }

  // 4) An approval alert is sent once per id: the host re-reads the session log
  // on reload, and a reloaded log must not re-announce a decision.
  {
    const calls = captureFetch();
    const hostHalf = bootHost(baseConfig());
    hostHalf.emit(ALPHA, { type: 'approval/asked', data: { id: 'ap-4', toolName: 'shell' } });
    hostHalf.emit(ALPHA, { type: 'approval/asked', data: { id: 'ap-4', toolName: 'shell' } });
    hostHalf.emit(ALPHA, { type: 'approval/asked', data: { id: 'ap-5', toolName: 'shell' } });
    await waitFor(() => calls.length === 2, 'two distinct approvals');
    await sleep(40);
    assert(calls.length === 2, 'the repeated id is deduplicated (got ' + calls.length + ' deliveries)');
    globalThis.fetch = realFetch;
  }

  // 5) turn/end is throttled per session: a burst inside the window collapses,
  // another session is unaffected, and the window reopens.
  {
    const calls = captureFetch();
    const hostHalf = bootHost(baseConfig({ turnEndThrottleMs: 200 }));
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 1, 'the first turn of a burst');
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } });
    await sleep(40);
    assert(calls.length === 1, 'a second turn inside the window is collapsed (got ' + calls.length + ')');
    const gamma = session('sess-gamma');
    hostHalf.emit(gamma, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 2, 'a turn in another session');
    await sleep(220);
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 3, 'a turn outside the window');
    globalThis.fetch = realFetch;
  }

  // 6) A subagent session is noise by default and included on request.
  {
    const calls = captureFetch();
    const hostHalf = bootHost(baseConfig());
    hostHalf.emit(BETA, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    hostHalf.emit(BETA, { type: 'approval/asked', data: { id: 'ap-sub', toolName: 'shell' } });
    await sleep(60);
    assert(calls.length === 0, 'subagent sessions are skipped by default (got ' + calls.length + ')');
    globalThis.fetch = realFetch;

    const included = captureFetch();
    const withSubagents = bootHost(baseConfig({ includeSubagents: true }));
    withSubagents.emit(BETA, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await waitFor(() => included.length === 1, 'a subagent turn with includeSubagents:true');
    assert(JSON.parse(included[0].body).body.indexOf('atlas') !== -1, 'the body still names the session');
    globalThis.fetch = realFetch;
  }

  // 7) An expired lease is as good as a closed page: a tab that crashed never
  // sent its `alive:false`.
  {
    const calls = captureFetch();
    const hostHalf = bootHost(baseConfig({ pageLeaseMs: 80 }));
    await hostHalf.beat(JSON.stringify({ alive: true }));
    await sleep(120);
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 1, 'a turn after the lease expired');
    globalThis.fetch = realFetch;
  }

  // 8) pageLeaseMs:0 is the documented "no coordination" mode: the host pushes
  // even while the page is clearly open (and therefore duplicates).
  {
    const calls = captureFetch();
    const hostHalf = bootHost(baseConfig({ pageLeaseMs: 0 }));
    assert(await hostHalf.beat(JSON.stringify({ alive: true })) === 200, 'the heartbeat is still accepted');
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 1, 'a turn with coordination disabled');
    globalThis.fetch = realFetch;
  }

  // 9) A rotated gateway password recovers without a restart: the 401 drops the
  // cache, the file is re-read, and exactly one retry is made.
  {
    const calls = captureFetch((recorded) => {
      if (recorded.length === 1) {
        fs.writeFileSync(credFile, JSON.stringify({ user: 'alice', password: 'rotated' }), { mode: 0o600 });
        return { status: 401, text: 'denied' };
      }
      return { status: 200, text: 'sent' };
    });
    const hostHalf = bootHost(baseConfig());
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 2, 'the retry after a 401');
    assert(calls[0].headers.authorization === basic('alice', 'old'), 'the first attempt used the cached credential');
    assert(calls[1].headers.authorization === basic('alice', 'rotated'), 'the retry used the re-read credential, got ' + calls[1].headers.authorization);
    await sleep(40); // let the delivery verdict land before the probe reads it
    const health = await hostHalf.get(HEALTH);
    assert(health.body.lastDelivery.ok === true && health.body.lastDelivery.status === 200,
      'the probe reports the successful retry (got ' + JSON.stringify(health.body.lastDelivery) + ')');
    globalThis.fetch = realFetch;
    fs.writeFileSync(credFile, JSON.stringify({ user: 'alice', password: 'old' }), { mode: 0o600 });
  }

  // 10) A credential the gateway keeps refusing is retried once per delivery,
  // not in a loop.
  {
    const calls = captureFetch(() => ({ status: 403, text: 'forbidden' }));
    const hostHalf = bootHost(baseConfig({ credentialsFile: rotatedFile, turnEndThrottleMs: 0 }));
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 2, 'the single retry of a refused credential');
    await sleep(40);
    assert(calls.length === 2, 'a persistent 403 is not retried forever (got ' + calls.length + ')');
    const health = await hostHalf.get(HEALTH);
    assert(health.body.lastDelivery.ok === false && health.body.lastDelivery.status === 403,
      'the probe reports the refusal (got ' + JSON.stringify(health.body.lastDelivery) + ')');
    globalThis.fetch = realFetch;
  }

  // 11) The reason a turn ended is appended, except for the normal one; the
  // body itself stays the session name.
  {
    const calls = captureFetch();
    const hostHalf = bootHost(baseConfig({ turnEndThrottleMs: 0 }));
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 9, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 1, 'a completed turn');
    assert(JSON.parse(calls[0].body).body === 'atlas', 'a completed turn appends nothing, got ' + JSON.stringify(JSON.parse(calls[0].body).body));
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 10, reason: { kind: 'max-tokens', error: { code: 'LIMIT' } } } });
    await waitFor(() => calls.length === 2, 'a turn that hit the token limit');
    assert(JSON.parse(calls[1].body).body === 'atlas（max-tokens）',
      'an abnormal end appends the reason kind, got ' + JSON.stringify(JSON.parse(calls[1].body).body));
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 11, reason: 'aborted' } });
    await waitFor(() => calls.length === 3, 'a turn with a legacy string reason');
    assert(JSON.parse(calls[2].body).body === 'atlas（aborted）', 'a string reason is honoured too');
    globalThis.fetch = realFetch;
  }

  // 11b) A user message carries injected blocks in this deployment
  // (`<system-reminder>`, memory context, timestamp lines). Nothing from the
  // conversation belongs in an external push: the alert must stay the session
  // name, or the gateway shows the user a wall of harness internals.
  {
    const calls = captureFetch();
    const hostHalf = bootHost(baseConfig({ turnEndThrottleMs: 0 }));
    hostHalf.emit(ALPHA, {
      type: 'user/message',
      data: [
        { type: 'text', text: '<system-reminder> A skill is available: …' },
        { type: 'text', text: '<openviking-context> Relevant memory … </openviking-context>' },
        { type: 'text', text: 'Time sampled while preparing turn 3, step 20: 2026-10-28T16:11:09+08:00' },
      ],
    });
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 1, 'a turn after an injected user message');
    const payload = JSON.parse(calls[0].body);
    assert(payload.body === 'atlas', 'the body is the session name only, got ' + JSON.stringify(payload.body));
    for (const marker of ['你刚才问', 'You asked', 'system-reminder', 'openviking-context', 'Time sampled']) {
      assert(payload.body.indexOf(marker) === -1, 'the payload must not quote ' + marker + ', got ' + JSON.stringify(payload.body));
    }
    globalThis.fetch = realFetch;
  }

  // 12) The health probe reports what the operator needs to tell a live host
  // from a mounted-but-idle one.
  {
    captureFetch();
    const hostHalf = bootHost(baseConfig({ includeSubagents: true, events: ['turn/end'] }));
    const health = await hostHalf.get(HEALTH);
    assert(health.status === 200 && health.body.ok === true, 'the probe answers 200 ok');
    assert(health.body.version === PKG_VERSION, 'the probe reports the package version, got ' + health.body.version);
    assert(health.body.enabled === true, 'the probe reports the module as enabled');
    assert(JSON.stringify(health.body.events) === JSON.stringify(['turn/end']), 'the probe reports the subscribed events, got ' + JSON.stringify(health.body.events));
    assert(health.body.includeSubagents === true, 'the probe reports the subagent switch');
    assert(health.body.pageAlive === false, 'no page has checked in yet');
    assert(health.body.lastDelivery === null, 'nothing has been delivered yet');
    globalThis.fetch = realFetch;
  }

  // 12b) The health probe goes through the same gate as every other entry: it
  // discloses that this host runs the fallback and when it last delivered, so a
  // deployment must not expose it to a LAN it did not allow.
  {
    captureFetch();
    const hostHalf = bootHost(withAllowList(['https://dsh.example.com']));
    const local = await hostHalf.get(HEALTH);
    assert(local.status === 200 && local.body.ok === true, 'a loopback probe reads the payload (got ' + local.status + ')');
    assert(local.body.version === PKG_VERSION, 'the payload is intact behind the gate');
    const tunneled = await hostHalf.get(HEALTH, { host: 'dsh.example.com', origin: 'https://dsh.example.com' });
    assert(tunneled.status === 200 && tunneled.body.ok === true,
      'the public name the allow-list derives reads it through a tunnel (got ' + tunneled.status + ' ' + JSON.stringify(tunneled.body) + ')');
    const bindSelf = await hostHalf.get(HEALTH, { host: '192.168.1.5:3080', origin: 'http://192.168.1.5:3080', remoteAddress: '192.168.1.5' });
    assert(bindSelf.status === 200, 'a self-addressed bind address still reads it (got ' + bindSelf.status + ')');
    const strayHost = await hostHalf.get(HEALTH, { host: 'other.example', origin: 'https://other.example' });
    assert(strayHost.status === 403 && strayHost.body.reason === 'bad-host',
      'a public name nobody allow-listed is refused (got ' + strayHost.status + ' ' + JSON.stringify(strayHost.body) + ')');
    const foreignPeer = await hostHalf.get(HEALTH, { remoteAddress: '203.0.113.9' });
    assert(foreignPeer.status === 403 && foreignPeer.body.reason === 'bad-remote',
      'a non-loopback peer is refused (got ' + foreignPeer.status + ' ' + JSON.stringify(foreignPeer.body) + ')');
    const crossOrigin = await hostHalf.get(HEALTH, { origin: 'https://evil.example' });
    assert(crossOrigin.status === 403 && crossOrigin.body.reason === 'cross-origin',
      'a cross-site Origin is refused (got ' + crossOrigin.status + ')');
    const posted = await hostHalf.get(HEALTH, { method: 'POST' });
    assert(posted.status === 405 && posted.body.reason === 'method-not-allowed',
      'the probe stays read-only (got ' + posted.status + ')');
    globalThis.fetch = realFetch;
  }

  // 12c) The host pusher follows the same rule as the relay: no credentials
  // file configured means the gateway wants no authentication, so alerts must
  // not fail on an unreadable credential that was never asked for.
  {
    const calls = captureFetch(() => ({ status: 200, text: 'Sent' }));
    const hostHalf = bootHost(baseConfig({ credentialsFile: '' }));
    hostHalf.emit(ALPHA, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 1, 'a delivery to an unauthenticated gateway');
    assert(calls[0].headers.authorization === undefined,
      'the delivery carries no Authorization header (got ' + JSON.stringify(calls[0].headers.authorization) + ')');
    assert(JSON.parse(calls[0].body).body === 'atlas', 'and the alert itself is unchanged');
    await sleep(40);
    const health = await hostHalf.get(HEALTH);
    assert(health.body.lastDelivery.ok === true && health.body.lastDelivery.status === 200,
      'the probe reports the successful delivery (got ' + JSON.stringify(health.body.lastDelivery) + ')');
    globalThis.fetch = realFetch;
  }

  // 13) Disposal releases the per-session caches, and a configuration that
  // cannot deliver is refused with one warning instead of silent failures.
  {
    const calls = captureFetch();
    const disposed = bootHost(baseConfig());
    disposed.emit(ALPHA, { type: 'session/title', data: { title: 'Atlas work' } });
    disposed.disposed(ALPHA);
    disposed.emit(ALPHA, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await waitFor(() => calls.length === 1, 'a turn after the session was disposed');
    assert(JSON.parse(calls[0].body).body === 'atlas',
      'the disposal dropped the cached title, got ' + JSON.stringify(JSON.parse(calls[0].body).body));
    globalThis.fetch = realFetch;

    const noTarget = bootHost({ hostFallback: { enabled: true, credentialsFile: credFile } });
    assert(noTarget.warnings.length === 1, 'an enabled module with no gateway warns exactly once (got ' + JSON.stringify(noTarget.warnings) + ')');
    assert(noTarget.routes.filter((r) => r.path === HEALTH).length === 0, 'and registers no health route');
    assert(noTarget.routes.filter((r) => r.path === BRIDGE).length === 1, 'the bridge route stays, so the page can still discover the host');
  }

  // 14) The bridge answers with the language the host will use, once a heartbeat
  // has reported one.
  {
    captureFetch();
    const hostHalf = bootHost(baseConfig({ language: 'en' }));
    await hostHalf.beat(JSON.stringify({ alive: true, language: 'zh' }));
    const status = await (async () => {
      const found = hostHalf.route(BRIDGE);
      return new Promise((resolve) => {
        const res = {
          statusCode: 0,
          writeHead(status) { this.statusCode = status; },
          end(payload) { resolve({ status: this.statusCode, body: JSON.parse(payload) }); },
        };
        found.handler({ method: 'GET', headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' }, on() {}, resume() {} }, res);
      });
    })();
    assert(status.body.language === 'en', 'an explicit config language outranks the heartbeat, got ' + status.body.language);
    globalThis.fetch = realFetch;
  }

  console.log('host fallback OK: lease gate, dedupe, throttle, subagent skip, language, page-parity copy, retry, probe');
} finally {
  globalThis.fetch = realFetch;
  fs.rmSync(tempDir, { recursive: true, force: true });
}