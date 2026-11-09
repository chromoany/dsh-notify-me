// macOS native-notification route: lib/mac-notify.js.
//
// The route only exists on the macOS desktop host, so this test fakes that
// environment (a `darwin` platform and an `electron` version string) and points
// the config at a stand-in "app bundle". The helper executable itself cannot
// run here (it is a macOS binary, and on Windows a POSIX shebang script cannot
// be spawned either), so the test injects a fake spawn and pins the argv the
// host module hands over. That also makes this suite run on every CI platform,
// which the earlier shell-script stub could not (PR #32 review).
//
// Pinned here: the route is not registered elsewhere, the GET probe reports
// whether the helper exists, 405 for anything but GET/POST, 403 for a foreign
// peer and for a POST without the intent header, 501 when the helper is missing,
// 400 for a body that is not a notification, one spawn per accepted alert with
// its identifier, a withdraw spawn for `{remove}`, and the click hand-off.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-me-mac-'));
const bundle = path.join(tmp, 'Stub Notify.app');
fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
const clickFile = path.join(tmp, 'click.json');
// The spawn itself is faked; the helper only has to exist for existsSync().
fs.writeFileSync(path.join(bundle, 'Contents', 'MacOS', 'dsh-notify'), '');

const spawned = [];
const execCalls = [];
function fakeChild(code, out) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.kill = () => {};
  process.nextTick(() => {
    if (out) child.stdout.emit('data', out);
    child.emit('close', code);
  });
  return child;
}
function fakeSpawn(bin, args, opts) {
  spawned.push({ bin, args, opts });
  return fakeChild(0, 'OK\n');
}
function fakeExec(file, args, cb) {
  execCalls.push({ file, args });
  if (typeof cb === 'function') cb(null);
}

/** Mount the route and hand back whatever it registered. */
function mount(config = {}) {
  const routes = [];
  const ctx = {
    effect(fn) { fn(); return () => {}; },
    webServer: { register(route) { routes.push(route); return () => {}; } },
  };
  mac.mountMacNotify(ctx, config, { bindHost: undefined, allowedOrigins: [] }, undefined, {
    spawn: fakeSpawn,
    execFile: fakeExec,
    clickFile: clickFile,
  });
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
  assert(execCalls.length === 0, 'no helper registration happens before the route is mounted');

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

  spawned.length = 0;
  const sent = await call(handler, 'POST', { 'x-dsh-notify-me-mac': 'notify' },
    JSON.stringify({ title: 'DSH · 审批请求', body: '会话：bash', sessionId: 'sess-1', id: 'tag-1', sound: true }));
  assert(sent.status === 200 && JSON.parse(sent.body).ok === true, 'an accepted alert answers 200 ok');
  assert(spawned.length === 1, 'one helper spawn per accepted alert');
  const argv = spawned[0].args;
  assert(argv.includes('DSH · 审批请求'), 'the title reaches the helper');
  assert(argv.includes('sess-1'), 'the session id reaches the helper');
  assert(argv.includes('--sound'), 'the sound flag reaches the helper');
  assert(argv[argv.indexOf('--id') + 1] === 'tag-1', 'the tracking identifier reaches the helper');
  assert(argv[argv.indexOf('--click-file') + 1] === clickFile, 'the helper is told where to write the click');

  // 3b. Back-at-the-page withdrawal: a remove spawn, not another notification.
  spawned.length = 0;
  const removed = await call(handler, 'POST', { 'x-dsh-notify-me-mac': 'notify' },
    JSON.stringify({ remove: 'tag-1' }));
  assert(removed.status === 200, 'a remove answers 200, got ' + removed.status);
  assert(spawned.length === 1 && spawned[0].args[0] === '--remove' && spawned[0].args[1] === 'tag-1',
    'the remove spawns the helper with --remove and the identifier');

  // 4. A click written by the helper is handed to the page once, then cleared.
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

console.log('mac notify route OK: desktop gate, probe, 405/403/501/400, helper argv, id, remove, click hand-off');
