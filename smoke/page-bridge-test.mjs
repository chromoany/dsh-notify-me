// Page-bridge route test: the one new route that exists whenever either patch
// module is enabled, and the pivot the page/host dedupe hangs on.
//
// Why its own file: this route decides whether the page heartbeats at all (it
// only does when `hostFallback.enabled` is true) and its lease is what keeps
// the host quiet while a page is open. Both answers are read by lib/client.js,
// so a wrong shape here is a silent duplicate-notification bug rather than a
// visible failure — the kind of thing only a test can pin.
//
// What is pinned here: the default composition adds no route (a bare install
// must behave exactly as it did before these modules existed), the GET status
// shape, the heartbeat POST and its lease, `alive:false`, the intent-header
// refusal, the shared gate including the `allowedOrigins`-derived `Host` a
// tunnel needs, the body limits, and that the reported language follows the
// heartbeat.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BRIDGE = '/__dsh-notify-me/host-bridge';
const RELAY = '/__dsh-notify-me/relay/test-token';
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

const host = await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href);

// Minimal cordis stand-in, the same shape smoke/host-route-test.mjs uses:
// apply() asks for a webServer service, an effect() and (only when a patch
// module is enabled) the session event feed.
function boot(config) {
  const routes = [];
  const subscriptions = [];
  const warnings = [];
  const effect = (fn) => {
    const off = fn();
    return () => { if (typeof off === 'function') off(); };
  };
  const ctx = {
    logger: { info() {}, warn(message) { warnings.push(String(message)); } },
    on(type, fn) { subscriptions.push({ type, fn }); return () => {}; },
    effect,
    inject(_services, cb) {
      cb({
        effect,
        webServer: {
          // A listener bound to one concrete LAN interface, as in the focus
          // route test: the gate reads it so the shell's self-addressed request
          // still passes.
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
  return { routes, subscriptions, warnings };
}

function routeAt(routes, routePath) {
  const route = routes.find((candidate) => candidate.path === routePath);
  assert(route !== undefined, 'a route is registered at ' + routePath + ' (got ' + routes.map((r) => r.path).join(', ') + ')');
  assert(route.kind === 'exact', 'the route at ' + routePath + ' is exact, got ' + route.kind);
  return route;
}

// Drive one route with the globals the handlers touch. A body is delivered on
// the next macrotask, which is after the handler attached its stream listeners.
function call(route, spec) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('route did not answer: ' + spec.method + ' ' + route.path)), 3000);
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const res = {
      statusCode: 0,
      writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
      end(payload) {
        let body = null;
        try { body = payload ? JSON.parse(payload) : null; } catch (e) { body = 'unparsed: ' + payload; }
        done({ status: this.statusCode, headers: this.headers, body });
      },
    };
    const listeners = {};
    const req = {
      method: spec.method,
      headers: Object.assign({ host: '127.0.0.1:3080' }, spec.headers || {}),
      socket: { remoteAddress: spec.remoteAddress || '127.0.0.1' },
      on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); return req; },
      resume() {},
    };
    setImmediate(() => {
      if (spec.body !== undefined) for (const fn of listeners.data || []) fn(Buffer.from(spec.body));
      for (const fn of listeners.end || []) fn();
    });
    try {
      const out = route.handler(req, res);
      if (out && typeof out.catch === 'function') out.catch((e) => done({ error: String(e) }));
    } catch (e) { done({ error: String(e) }); }
  });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-me-bridge-'));
const credFile = path.join(tempDir, 'gateway.json');
fs.writeFileSync(credFile, JSON.stringify({ user: 'u', password: 'p' }), { mode: 0o600 });

try {
  // 1) The promise the whole merge makes: nothing changes for a bare install.
  for (const config of [undefined, {}, { gateway: { target: 'https://gw.example/hook' } }, { hostFallback: { enabled: false } }]) {
    const dflt = boot(config);
    assert(dflt.routes.length === 1, 'a disabled composition registers exactly one route (got ' + dflt.routes.length + ' for ' + JSON.stringify(config) + ')');
    assert(dflt.routes[0].path === host.FOCUS_ROUTE, 'that one route is the focus route');
    assert(dflt.subscriptions.length === 0, 'a disabled composition subscribes to no session events');
    assert(dflt.warnings.length === 0, 'a disabled composition warns about nothing (got ' + JSON.stringify(dflt.warnings) + ')');
  }

  // 2) The status GET the page reads to decide whether to heartbeat.
  const fallbackOnly = boot({
    hostFallback: { enabled: true, target: 'https://gw.example/hook', credentialsFile: credFile, pageLeaseMs: 400 },
  });
  assert(fallbackOnly.routes.length === 3,
    'hostFallback adds the bridge and health routes only (got ' + fallbackOnly.routes.map((r) => r.path).join(', ') + ')');
  assert(fallbackOnly.subscriptions.filter((s) => s.type === 'session/event').length === 1,
    'hostFallback subscribes to the session feed once');

  const bridge = routeAt(fallbackOnly.routes, BRIDGE);
  const status = await call(bridge, { method: 'GET' });
  assert(status.status === 200 && status.body && status.body.ok === true,
    'the GET probe answers 200 ok (got ' + status.status + ' ' + JSON.stringify(status.body) + ')');
  assert(status.body.version === PKG_VERSION, 'the probe reports the package version ' + PKG_VERSION + ', got ' + status.body.version);
  assert(Array.isArray(status.body.features) && status.body.features.indexOf('page-bridge') !== -1,
    'features always name page-bridge (got ' + JSON.stringify(status.body.features) + ')');
  assert(status.body.features.indexOf('host-fallback') !== -1, 'features name the enabled host fallback');
  assert(status.body.features.indexOf('relay') === -1, 'features do not name a disabled relay');
  assert(status.body.hostFallback.enabled === true && status.body.hostFallback.leaseMs === 400,
    'hostFallback reports enabled and the configured lease (got ' + JSON.stringify(status.body.hostFallback) + ')');
  assert(status.body.relay.enabled === false && status.body.relay.path === null,
    'a disabled relay reports no path (got ' + JSON.stringify(status.body.relay) + ')');
  assert(status.body.language === 'zh', 'with no heartbeat the language is zh (got ' + status.body.language + ')');
  assert(status.body.page.alive === false && status.body.page.ageMs === null,
    'with no heartbeat the page is not alive and has no age (got ' + JSON.stringify(status.body.page) + ')');
  assert(status.body.page.external === undefined,
    'the status reports nothing about the page push switches (got ' + JSON.stringify(status.body.page) + ')');

  // 3) The heartbeat, and the lease it renews.
  // A heartbeat carries exactly two things: whether a page is open, and the
  // language it is showing. The page's own push switches stay out of it — the
  // host's rule is "push while no page is open", full stop.
  const beat = await call(bridge, {
    method: 'POST',
    headers: { 'x-dsh-notify-me-page': 'bridge' },
    body: JSON.stringify({ alive: true, language: 'en' }),
  });
  assert(beat.status === 200 && beat.body && beat.body.ok === true,
    'a heartbeat with the intent header answers 200 (got ' + beat.status + ' ' + JSON.stringify(beat.body) + ')');
  assert(typeof beat.body.leaseUntil === 'number' && beat.body.leaseUntil > Date.now(),
    'the heartbeat answers the instant the lease runs to (got ' + beat.body.leaseUntil + ')');
  const afterBeat = await call(bridge, { method: 'GET' });
  assert(afterBeat.body.page.alive === true, 'a fresh heartbeat makes the page alive');
  assert(typeof afterBeat.body.page.ageMs === 'number' && afterBeat.body.page.ageMs < 2000,
    'the age is the time since that heartbeat (got ' + afterBeat.body.page.ageMs + ')');
  assert(afterBeat.body.language === 'en', 'the reported language follows the heartbeat (got ' + afterBeat.body.language + ')');

  // Lease expiry is what hands delivery back to the host.
  await sleep(450);
  const expired = await call(bridge, { method: 'GET' });
  assert(expired.body.page.alive === false, 'an expired lease reports the page as gone');
  assert(expired.body.page.ageMs >= 400, 'the age keeps counting past the lease (got ' + expired.body.page.ageMs + ')');

  // 4) `alive:false` on pagehide releases the lease immediately.
  await call(bridge, { method: 'POST', headers: { 'x-dsh-notify-me-page': 'bridge' }, body: JSON.stringify({ alive: true }) });
  assert((await call(bridge, { method: 'GET' })).body.page.alive === true, 'the lease is fresh again before the release');
  await call(bridge, { method: 'POST', headers: { 'x-dsh-notify-me-page': 'bridge' }, body: JSON.stringify({ alive: false }) });
  assert((await call(bridge, { method: 'GET' })).body.page.alive === false, 'alive:false releases the lease before it expires');

  // An empty body is a bare "I am here": every heartbeat field is optional.
  const bare = await call(bridge, { method: 'POST', headers: { 'x-dsh-notify-me-page': 'bridge' }, body: '' });
  assert(bare.status === 200 && bare.body.ok === true, 'an empty heartbeat body is accepted (got ' + bare.status + ')');
  assert((await call(bridge, { method: 'GET' })).body.page.alive === true, 'an empty heartbeat still renews the lease');

  // 5) Refusals. The intent header is not the gate, but a POST without it is
  // not a heartbeat either.
  const noHeader = await call(bridge, { method: 'POST', body: JSON.stringify({ alive: true }) });
  assert(noHeader.status === 403 && noHeader.body.reason === 'forbidden',
    'a heartbeat without the intent header is refused (got ' + noHeader.status + ' ' + JSON.stringify(noHeader.body) + ')');
  const wrongHeader = await call(bridge, {
    method: 'POST',
    headers: { 'x-dsh-notify-me-page': 'nope' },
    body: JSON.stringify({ alive: true }),
  });
  assert(wrongHeader.status === 403, 'a heartbeat with the wrong intent value is refused (got ' + wrongHeader.status + ')');

  const foreignPeer = await call(bridge, { method: 'GET', remoteAddress: '10.0.0.5' });
  assert(foreignPeer.status === 403 && foreignPeer.body.reason === 'bad-remote',
    'a non-loopback peer is refused (got ' + foreignPeer.status + ' ' + JSON.stringify(foreignPeer.body) + ')');
  const foreignHost = await call(bridge, { method: 'GET', headers: { host: 'evil.example' } });
  assert(foreignHost.status === 403 && foreignHost.body.reason === 'bad-host',
    'a foreign Host is refused (got ' + foreignHost.status + ' ' + JSON.stringify(foreignHost.body) + ')');
  const foreignOrigin = await call(bridge, { method: 'GET', headers: { origin: 'http://evil.example' } });
  assert(foreignOrigin.status === 403 && foreignOrigin.body.reason === 'cross-origin',
    'a cross-site Origin is refused (got ' + foreignOrigin.status + ' ' + JSON.stringify(foreignOrigin.body) + ')');
  const wrongVerb = await call(bridge, { method: 'DELETE' });
  assert(wrongVerb.status === 405 && wrongVerb.body.reason === 'method-not-allowed',
    'an unsupported verb answers 405 (got ' + wrongVerb.status + ')');

  // 6) A tunnel or reverse proxy sends the public name, which the gate accepts
  // only when the config lists that origin.
  const tunnel = boot({
    allowedOrigins: ['https://dsh.example.com'],
    relay: { enabled: true, path: RELAY, target: 'https://gw.example/hook', credentialsFile: credFile },
  });
  const tunnelBridge = routeAt(tunnel.routes, BRIDGE);
  const tunnelStatus = await call(tunnelBridge, {
    method: 'GET',
    headers: { host: 'dsh.example.com', origin: 'https://dsh.example.com' },
  });
  assert(tunnelStatus.status === 200 && tunnelStatus.body.ok === true,
    'an allow-listed public Host passes the gate (got ' + tunnelStatus.status + ' ' + JSON.stringify(tunnelStatus.body) + ')');
  assert(tunnelStatus.body.relay.enabled === true && tunnelStatus.body.relay.path === RELAY,
    'the relay path is reported so the page can show it (got ' + JSON.stringify(tunnelStatus.body.relay) + ')');
  assert(tunnelStatus.body.features.indexOf('relay') !== -1, 'features name the enabled relay');
  const strayHost = await call(tunnelBridge, { method: 'GET', headers: { host: 'other.example', origin: 'https://other.example' } });
  assert(strayHost.status === 403 && strayHost.body.reason === 'bad-host',
    'a public name nobody allow-listed is still refused (got ' + strayHost.status + ' ' + JSON.stringify(strayHost.body) + ')');
  const proxyRewrittenHost = await call(tunnelBridge, {
    method: 'GET',
    headers: { host: '127.0.0.1:3080', origin: 'https://dsh.example.com' },
  });
  assert(proxyRewrittenHost.status === 200,
    'an allow-listed Origin passes even when a proxy rewrote Host (got ' + proxyRewrittenHost.status + ')');

  // 7) Body limits.
  const badJson = await call(bridge, { method: 'POST', headers: { 'x-dsh-notify-me-page': 'bridge' }, body: 'not json{' });
  assert(badJson.status === 400 && badJson.body.reason === 'invalid-json',
    'a malformed heartbeat is refused with 400 (got ' + badJson.status + ' ' + JSON.stringify(badJson.body) + ')');
  const listBody = await call(bridge, { method: 'POST', headers: { 'x-dsh-notify-me-page': 'bridge' }, body: '[1,2]' });
  assert(listBody.status === 400 && listBody.body.reason === 'invalid-json',
    'a heartbeat that is not an object is refused with 400 (got ' + listBody.status + ')');
  const huge = await call(bridge, {
    method: 'POST',
    headers: { 'x-dsh-notify-me-page': 'bridge' },
    body: JSON.stringify({ language: 'zh', padding: 'x'.repeat(17 * 1024) }),
  });
  assert(huge.status === 413 && huge.body.reason === 'body-too-large',
    'a heartbeat over 16KB is refused with 413 (got ' + huge.status + ' ' + JSON.stringify(huge.body) + ')');

  // 8) The lease is off when the config says so: coordination disabled means
  // the host never believes the page is there, which is the documented
  // debugging mode.
  const uncoordinated = boot({
    hostFallback: { enabled: true, target: 'https://gw.example/hook', credentialsFile: credFile, pageLeaseMs: 0 },
  });
  const uncoordinatedBridge = routeAt(uncoordinated.routes, BRIDGE);
  const offBeat = await call(uncoordinatedBridge, {
    method: 'POST',
    headers: { 'x-dsh-notify-me-page': 'bridge' },
    body: JSON.stringify({ alive: true }),
  });
  assert(offBeat.body.leaseUntil === 0, 'pageLeaseMs:0 answers a zero lease (got ' + offBeat.body.leaseUntil + ')');
  const offStatus = await call(uncoordinatedBridge, { method: 'GET' });
  assert(offStatus.body.page.alive === false,
    'pageLeaseMs:0 never reports the page as alive (got ' + JSON.stringify(offStatus.body.page) + ')');
  assert(offStatus.body.hostFallback.leaseMs === 0, 'the status reports the disabled lease');
  assert(offStatus.body.language === 'zh', 'the language still comes from the heartbeat: none yet means zh');

  // 9) The allow-list has exactly one home, and it has to widen the gate for a
  // deployment that enables only the host fallback: a tunnel hands that page's
  // heartbeat the public Host, and a refused heartbeat means the host believes
  // the page is gone and pushes a duplicate for it.
  {
    const fallbackTunnel = boot({
      allowedOrigins: ['https://dsh.example.com'],
      hostFallback: { enabled: true, target: 'https://gw.example/hook', credentialsFile: credFile },
    });
    assert(fallbackTunnel.routes.filter((r) => r.path === RELAY).length === 0, 'the relay route is not registered');
    const fallbackBridge = routeAt(fallbackTunnel.routes, BRIDGE);
    const allowed = await call(fallbackBridge, {
      method: 'GET',
      headers: { host: 'dsh.example.com', origin: 'https://dsh.example.com' },
    });
    assert(allowed.status === 200 && allowed.body.ok === true,
      'a top-level allow-list widens the gate with the relay off (got ' + allowed.status + ' ' + JSON.stringify(allowed.body) + ')');
    const beat = await call(fallbackBridge, {
      method: 'POST',
      headers: { host: 'dsh.example.com', origin: 'https://dsh.example.com', 'x-dsh-notify-me-page': 'bridge' },
      body: JSON.stringify({ alive: true }),
    });
    assert(beat.status === 200 && beat.body.leaseUntil > 0,
      'and the heartbeat through that public name is accepted (got ' + beat.status + ' ' + JSON.stringify(beat.body) + ')');
    assert((await call(fallbackBridge, { method: 'GET', headers: { host: 'dsh.example.com' } })).body.page.alive === true,
      'so the host knows the page is open');
    assert(fallbackTunnel.warnings.length === 0,
      'and that deployment warns about nothing (got ' + JSON.stringify(fallbackTunnel.warnings) + ')');
  }

  // 10) A configured path that collides with a fixed route is dropped, with a
  // warning: registering it would throw inside the web server and take the
  // focus route down with it.
  {
    const colliding = boot({
      relay: { enabled: true, path: BRIDGE, target: 'https://gw.example/hook', credentialsFile: credFile },
      hostFallback: { enabled: true, target: 'https://gw.example/hook', credentialsFile: credFile, healthPath: BRIDGE },
    });
    assert(colliding.routes.filter((r) => r.path === BRIDGE).length === 1, 'the fixed bridge route is registered exactly once');
    assert(colliding.routes.filter((r) => r.path === host.FOCUS_ROUTE).length === 1, 'and the focus route still survives');
    const collisions = colliding.warnings.filter((message) => message.indexOf('already registers') !== -1);
    assert(collisions.length === 2, 'both collisions are warned about, got ' + JSON.stringify(colliding.warnings));
    assert(colliding.routes.filter((r) => r.path === '/__dsh-notify-me/host-fallback').length === 1,
      'the health route falls back to its default path');
  }

  console.log('page bridge OK: status shape, lease, refusals, tunnel Host derivation, body limits, path collisions');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}