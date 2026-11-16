// Host-half route test: the one loopback route lib/index.js registers on the
// web server. It lives in its own file because the route needs nothing from
// cordis — before this, every assertion about it sat behind the "is a DSH
// installation present" probe in cordis-host-test.mjs, so `npm test` on a
// machine without DSH was green while the route (the only security boundary
// the plugin opens) had never been exercised at all.
//
// What is pinned here: the exact path, the read-only GET probe, 405 for
// anything but GET/HEAD/POST, 403 for a foreign peer / Host / Origin, and 501
// for a host that is not the Windows desktop shell (the activation spawn only
// reaches Windows; elsewhere the page raises through dsh://open instead).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

const host = await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href);
assert(typeof host.apply === 'function' && host.name === 'dsh-notify-me', 'the host half exports a cordis plugin');
assert(host.FOCUS_ROUTE === '/__dsh-notify-me/focus-window', 'FOCUS_ROUTE is the path the page posts to');

// Minimal cordis stand-in: apply() only asks for a webServer service and an
// effect(); register() hands back a disposer exactly like dsh-host-webserver.
const routes = [];
const ctx = {
  inject(_services, cb) {
    cb({
      effect(fn) { fn(); return () => {}; },
      webServer: {
        // A listener bound to one concrete LAN interface: the host half reads
        // this so the gate can accept the self-addressed request the shell
        // makes in that setup.
        host: '192.168.1.5',
        register(route) {
          routes.push(route);
          return () => { const i = routes.indexOf(route); if (i !== -1) routes.splice(i, 1); };
        },
      },
    });
  },
};
host.apply(ctx);
assert(routes.length === 1, 'the host half registers exactly one route (got ' + routes.length + ')');
const route = routes[0];
assert(route.kind === 'exact', 'the focus route is exact, got ' + route.kind);
assert(route.path === host.FOCUS_ROUTE, 'the focus route path is ' + host.FOCUS_ROUTE + ', got ' + route.path);

// Drive the handler with the two globals it touches: method and headers.
function callRoute(spec) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const res = {
      statusCode: 0,
      writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
      end(payload) {
        let body = null;
        try { body = payload ? JSON.parse(payload) : null; } catch (e) { body = 'unparsed: ' + payload; }
        done({ status: this.statusCode, headers: this.headers, body });
      },
    };
    const req = {
      method: spec.method,
      headers: Object.assign({ host: '127.0.0.1:3080' }, spec.headers || {}),
      socket: { remoteAddress: spec.remoteAddress || '127.0.0.1' },
      resume() {},
    };
    try {
      const out = route.handler(req, res);
      if (out && typeof out.catch === 'function') out.catch((e) => done({ error: String(e) }));
    } catch (e) { done({ error: String(e) }); }
  });
}

const probe = await callRoute({ method: 'GET' });
assert(probe.status === 200 && probe.body && probe.body.ok === true,
  'the GET probe answers 200 ok (got ' + probe.status + ' ' + JSON.stringify(probe.body) + ')');
assert(probe.body.route === host.FOCUS_ROUTE, 'the GET probe names its own route');
assert(probe.body.desktop === false && probe.body.enabled === false,
  'a plain Node host reports desktop:false, enabled:false (got ' + JSON.stringify(probe.body) + ')');

// A web-profile host answers POST without ever touching the OS.
const bare = await callRoute({ method: 'POST' });
assert(bare.status === 501, 'a POST on a non-desktop host is refused with 501 (got ' + bare.status + ')');

const wrongMethod = await callRoute({ method: 'DELETE' });
assert(wrongMethod.status === 405, 'a non-POST/GET verb answers 405 (got ' + wrongMethod.status + ')');

// The gate: the route answers plain HTTP on the host port, and a DNS-rebinding
// page reaches that port while looking same-origin to the browser, so it can
// send any header. Only the peer address, the Host header and an agreeing
// Origin distinguish it.
const required = { 'x-dsh-notify-me-focus': 'focus' };
const foreignHost = await callRoute({ method: 'POST', headers: Object.assign({ host: 'evil.example' }, required) });
assert(foreignHost.status === 403 && foreignHost.body && foreignHost.body.reason === 'bad-host',
  'a foreign Host is refused before the header even matters (got ' + foreignHost.status + ' ' + JSON.stringify(foreignHost.body) + ')');
const foreignPeer = await callRoute({ method: 'POST', remoteAddress: '10.0.0.5', headers: required });
assert(foreignPeer.status === 403 && foreignPeer.body && foreignPeer.body.reason === 'bad-remote',
  'a non-loopback peer is refused (got ' + foreignPeer.status + ' ' + JSON.stringify(foreignPeer.body) + ')');
const foreignOrigin = await callRoute({
  method: 'POST',
  headers: Object.assign({ origin: 'http://evil.example' }, required),
});
assert(foreignOrigin.status === 403 && foreignOrigin.body && foreignOrigin.body.reason === 'cross-origin',
  'a cross-site Origin is refused (got ' + foreignOrigin.status + ' ' + JSON.stringify(foreignOrigin.body) + ')');
const sameOrigin = await callRoute({
  method: 'POST',
  headers: Object.assign({ origin: 'http://127.0.0.1:3080' }, required),
});
assert(sameOrigin.status === 501,
  'a same-origin page passes the gate and then gets the plain 501 (got ' + sameOrigin.status + ')');
const wrongPort = await callRoute({
  method: 'POST',
  headers: Object.assign({ origin: 'http://127.0.0.1:9999' }, required),
});
assert(wrongPort.status === 403 && wrongPort.body && wrongPort.body.reason === 'cross-origin',
  'an Origin on another port counts as cross-origin (got ' + wrongPort.status + ' ' + JSON.stringify(wrongPort.body) + ')');
// A listener bound to a concrete LAN interface: the shell dials that address,
// so the peer and Host are the bind IP. A remote client's peer never is.
const bindSelf = await callRoute({
  method: 'POST',
  remoteAddress: '192.168.1.5',
  headers: Object.assign({ host: '192.168.1.5:3080', origin: 'http://192.168.1.5:3080' }, required),
});
assert(bindSelf.status === 501,
  'a self-addressed bind address passes the gate, got ' + bindSelf.status + ' ' + JSON.stringify(bindSelf.body));
const bindForeignPeer = await callRoute({
  method: 'POST',
  remoteAddress: '192.168.1.50',
  headers: Object.assign({ host: '192.168.1.5:3080' }, required),
});
assert(bindForeignPeer.status === 403 && bindForeignPeer.body && bindForeignPeer.body.reason === 'bad-remote',
  'a LAN client cannot borrow the bind address (got ' + bindForeignPeer.status + ' ' + JSON.stringify(bindForeignPeer.body) + ')');
const bindForeignHost = await callRoute({
  method: 'POST',
  remoteAddress: '192.168.1.5',
  headers: Object.assign({ host: 'evil.example' }, required),
});
assert(bindForeignHost.status === 403 && bindForeignHost.body && bindForeignHost.body.reason === 'bad-host',
  'a self-addressed peer with a foreign Host is still refused (got ' + bindForeignHost.status + ')');
const bindCrossOrigin = await callRoute({
  method: 'POST',
  remoteAddress: '192.168.1.5',
  headers: Object.assign({ host: '192.168.1.5:3080', origin: 'http://evil.example' }, required),
});
assert(bindCrossOrigin.status === 403 && bindCrossOrigin.body && bindCrossOrigin.body.reason === 'cross-origin',
  'a cross-site Origin is refused on the bind path too (got ' + bindCrossOrigin.status + ')');

const preflight = await callRoute({
  method: 'OPTIONS',
  headers: { host: 'evil.example', origin: 'http://evil.example' },
});
assert(preflight.status === 405,
  'a preflight is answered 405 and never with CORS headers (got ' + preflight.status + ')');

// The composition's connection fence runs before the payload when the host
// exposes it: the call is DSH's own `requestRejection` (Host/Origin fence plus
// browser authentication), and its status is relayed verbatim. It runs after the
// method check, exactly where the plugin gate it replaces used to sit. A host
// without the service (the stand-in above, older DSH, the tests) falls back to
// the plugin gate that the cases above pin.
const seeing = [];
ctx.get = (name) => name === 'connection' ? {
  requestRejection(req) {
    seeing.push(req.method);
    if (req.headers['x-test-forbidden']) return 403;
    if (req.headers['x-test-unauthorized']) return 401;
    return undefined;
  },
} : undefined;
const deniedUntrusted = await callRoute({ method: 'GET', headers: { 'x-test-forbidden': '1' } });
assert(deniedUntrusted.status === 403 && deniedUntrusted.body && deniedUntrusted.body.reason === 'untrusted',
  'a connection 403 is relayed as untrusted (got ' + deniedUntrusted.status + ' ' + JSON.stringify(deniedUntrusted.body) + ')');
const deniedUnauthenticated = await callRoute({ method: 'GET', headers: { 'x-test-unauthorized': '1' } });
assert(deniedUnauthenticated.status === 401 && deniedUnauthenticated.body && deniedUnauthenticated.body.reason === 'unauthenticated',
  'a connection 401 is relayed as unauthenticated (got ' + deniedUnauthenticated.status + ' ' + JSON.stringify(deniedUnauthenticated.body) + ')');
const admittedProbe = await callRoute({ method: 'GET' });
assert(admittedProbe.status === 200,
  'an admitted request continues to the route probe (got ' + admittedProbe.status + ')');
assert(seeing.length === 3, 'every request consults connection.requestRejection first (saw ' + seeing.length + ')');
const admittedForeign = await callRoute({ method: 'POST', headers: { host: 'evil.example' } });
assert(admittedForeign.status === 403 && admittedForeign.body && admittedForeign.body.reason === 'bad-host',
  'the plugin gate still runs after admission (got ' + admittedForeign.status + ' ' + JSON.stringify(admittedForeign.body) + ')');
console.log('host route admission OK: connection 401/403 relayed, admitted requests still gated');

// Point the route at a stand-in script: this is the test hook that turns the
// desktop path on inside a plain Node process.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-me-focus-'));
const focusScript = path.join(tempDir, 'temp-focus-win.ps1');
const missScript = path.join(tempDir, 'temp-focus-miss.ps1');
try {
  process.env.DSH_NOTIFY_ME_FOCUS_SCRIPT = focusScript;
  const forbidden = await callRoute({ method: 'POST', headers: {} });
  assert(forbidden.status === 403, 'a POST without the page header is refused with 403 (got ' + forbidden.status + ')');

  if (process.platform === 'win32') {
    fs.writeFileSync(focusScript, 'Write-Output "DETAIL=stub-ok"\nWrite-Output "FOCUSED=1"\n', 'utf8');
    fs.writeFileSync(missScript, 'Write-Output "FOCUSED=0"\n', 'utf8');

    const raised = await callRoute({ method: 'POST', headers: required });
    assert(raised.status === 200 && raised.body && raised.body.focused === true,
      'a script reporting FOCUSED=1 answers 200 focused:true (got ' + raised.status + ' ' + JSON.stringify(raised.body) + ')');
    assert(raised.body.detail === 'stub-ok', 'the script DETAIL line is surfaced, got ' + raised.body.detail);

    await sleep(450); // outside the coalescing window
    process.env.DSH_NOTIFY_ME_FOCUS_SCRIPT = missScript;
    const missed = await callRoute({ method: 'POST', headers: required });
    assert(missed.status === 202 && missed.body && missed.body.focused === false,
      'a script reporting FOCUSED=0 answers 202 focused:false (got ' + missed.status + ' ' + JSON.stringify(missed.body) + ')');
    console.log('host route OK: exact path, probe, 403/405/501 refusals, and both script verdicts');
  } else {
    const err = await callRoute({ method: 'POST', headers: required });
    assert(err.status === 202 && err.body && err.body.focused === false,
      'a spawn that cannot run answers 202 focused:false (got ' + err.status + ' ' + JSON.stringify(err.body) + ')');
    console.log('host route OK: exact path, probe, 403/405/501 refusals, non-fatal spawn failure');
  }
} finally {
  delete process.env.DSH_NOTIFY_ME_FOCUS_SCRIPT;
  fs.rmSync(tempDir, { recursive: true, force: true });
}
