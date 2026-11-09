// macOS native-notification route (fork addition): lib/mac-notify.js.
//
// The route only exists on the macOS desktop host, so this test fakes that
// environment (a `darwin` platform and an `electron` version string) and points
// the config at a stand-in "app bundle" whose executable is a shell script. What
// is pinned here: the route is not registered elsewhere, the GET probe reports
// whether the helper exists, 405 for anything but GET/POST, 403 for a foreign
// peer and for a POST without the intent header, 501 when the helper is missing,
// 400 for a body that is not a notification, and one spawn per accepted alert.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

const mac = await import(pathToFileURL(path.join(ROOT, 'lib', 'mac-notify.js')).href);
assert(mac.MAC_NOTIFY_ROUTE === '/__dsh-notify-me/mac-notify', 'MAC_NOTIFY_ROUTE is the path the page calls');

// A stand-in bundle: Contents/MacOS/dsh-notify is what the route spawns.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-me-mac-'));
const bundle = path.join(tmp, 'Stub Notify.app');
fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
const spawnLog = path.join(tmp, 'spawned.log');
const stub = path.join(bundle, 'Contents', 'MacOS', 'dsh-notify');
fs.writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${spawnLog}"\necho OK\n`);
fs.chmodSync(stub, 0o755);

/** Mount the route and hand back whatever it registered. */
function mount(config = {}) {
  const routes = [];
  const ctx = {
    effect(fn) { fn(); return () => {}; },
    webServer: { register(route) { routes.push(route); return () => {}; } },
  };
  mac.mountMacNotify(ctx, config, { bindHost: undefined, allowedOrigins: [] }, undefined);
  return routes;
}

/** Drive the registered handler with one synthetic request. */
function call(handler, method, headers = {}, body, peer = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.headers = { host: '127.0.0.1:1', ...headers };
    req.socket = { remoteAddress: peer, localAddress: '127.0.0.1' };
    req.resume = () => {};
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
      writeHead(status) { this.statusCode = status; return this; },
      end(payload) { resolve({ status: this.statusCode, body: String(payload ?? '') }); },
    };
    handler(req, res);
    if (body !== undefined) {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    }
  });
}

// 1. Not the macOS desktop: no route at all, so the page keeps its own toasts.
assert(mount({ appPath: bundle }).length === 0, 'no route outside the macOS desktop host');

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const realElectron = process.versions.electron;
Object.defineProperty(process, 'platform', { value: 'darwin' });
Object.defineProperty(process.versions, 'electron', { value: 'test', configurable: true, writable: true });

try {
  // 2. Missing helper: the route exists but says so, and refuses to send.
  const missing = mount({ appPath: path.join(tmp, 'absent.app') });
  assert(missing.length === 1 && missing[0].kind === 'exact' && missing[0].path === mac.MAC_NOTIFY_ROUTE,
    'exact route on the documented path');
  const probeMissing = await call(missing[0].handler, 'GET');
  assert(JSON.parse(probeMissing.body).enabled === false, 'a missing helper reports enabled:false');
  const refused = await call(missing[0].handler, 'POST', { 'x-dsh-notify-me-mac': 'notify' }, '{"title":"t"}');
  assert(refused.status === 501, 'POST without a helper is 501, got ' + refused.status);

  // 3. With the helper present.
  const routes = mount({ appPath: bundle });
  assert(routes.length === 1, 'exactly one route');
  const handler = routes[0].handler;

  const probe = await call(handler, 'GET');
  const probed = JSON.parse(probe.body);
  assert(probe.status === 200 && probed.enabled === true, 'the probe reports enabled:true');
  assert(probed.click === null, 'a probe with no click pending reports click:null');

  const wrongMethod = await call(handler, 'PUT');
  assert(wrongMethod.status === 405, 'PUT is 405, got ' + wrongMethod.status);

  const foreign = await call(handler, 'GET', {}, undefined, '10.0.0.9');
  assert(foreign.status === 403, 'a non-loopback peer is 403, got ' + foreign.status);

  const noHeader = await call(handler, 'POST', {}, '{"title":"t"}');
  assert(noHeader.status === 403, 'POST without the intent header is 403, got ' + noHeader.status);

  const badBody = await call(handler, 'POST', { 'x-dsh-notify-me-mac': 'notify' }, 'not json');
  assert(badBody.status === 400, 'a non-JSON body is 400, got ' + badBody.status);

  const noTitle = await call(handler, 'POST', { 'x-dsh-notify-me-mac': 'notify' }, '{"body":"b"}');
  assert(noTitle.status === 400, 'a body without a title is 400, got ' + noTitle.status);

  const sent = await call(handler, 'POST', { 'x-dsh-notify-me-mac': 'notify' },
    JSON.stringify({ title: 'DSH · 审批请求', body: '会话：bash', sessionId: 'sess-1', sound: true }));
  assert(sent.status === 200 && JSON.parse(sent.body).ok === true, 'an accepted alert answers 200 ok');
  const argv = fs.readFileSync(spawnLog, 'utf8').split('\n');
  assert(argv.includes('DSH · 审批请求'), 'the title reaches the helper');
  assert(argv.includes('sess-1'), 'the session id reaches the helper');
  assert(argv.includes('--sound'), 'the sound flag reaches the helper');
  assert(argv.some((line) => line === tmp ? true : line.includes('dsh-notify-me-click.json')),
    'the helper is told where to write the click');

  // 4. A click written by the helper is handed to the page once, then cleared.
  const clickFile = path.join(os.tmpdir(), 'dsh-notify-me-click.json');
  fs.writeFileSync(clickFile, JSON.stringify({ sessionId: 'sess-1', at: Date.now() }));
  const clicked = JSON.parse((await call(handler, 'GET')).body);
  assert(clicked.click && clicked.click.sessionId === 'sess-1', 'the pending click is delivered to the page');
  const after = JSON.parse((await call(handler, 'GET')).body);
  assert(after.click === null, 'the click is delivered once and not repeated');
} finally {
  Object.defineProperty(process, 'platform', realPlatform);
  if (realElectron === undefined) delete process.versions.electron;
  else Object.defineProperty(process.versions, 'electron', { value: realElectron, configurable: true, writable: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('mac notify route OK: desktop gate, probe, 405/403/501/400, helper argv, click hand-off');
