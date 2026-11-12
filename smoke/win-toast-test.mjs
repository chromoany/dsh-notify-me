// Windows approval-toast route: lib/win-toast.js.
//
// The route only exists on the packed Windows desktop shell, so this test fakes
// that environment (a `win32` platform and an `electron` version string). The
// PowerShell helper cannot reasonably run in CI, so spawn/exec are injected:
// what is pinned here is the route contract (405/403/501/400, GET actions,
// POST send/remove), the decoded toast payload, the HKCU protocol registration,
// the encoding of the generated VBS handler, and the token rules — single use,
// bound to one approval key, expiring.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

const win = await import(pathToFileURL(path.join(ROOT, 'lib', 'win-toast.js')).href);
assert(win.WIN_TOAST_ROUTE === '/__dsh-notify-me/win-toast', 'WIN_TOAST_ROUTE is the path the page calls');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-me-win-'));
// mountWinToast derives its directories from %LOCALAPPDATA% on Windows; point
// that at the scratch dir so the test never touches the real profile directory.
const realLocalAppData = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = tmp;
const psPath = path.join(tmp, 'powershell.exe');
const scriptPath = path.join(tmp, 'win-toast.ps1');
fs.writeFileSync(psPath, '');
fs.writeFileSync(scriptPath, '');
const actionsDir = path.join(tmp, 'dsh-notify-me', 'actions');

const spawned = [];
const execCalls = [];
function fakeChild(code, stderr) {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.kill = () => {};
  process.nextTick(() => {
    if (stderr) child.stderr.emit('data', stderr);
    child.emit('close', code);
  });
  return child;
}
function fakeSpawn(bin, args, opts) {
  spawned.push({ bin, args, opts });
  return fakeChild(0, '');
}
function fakeExec(file, args, cb) {
  execCalls.push({ file, args });
  if (typeof cb === 'function') cb(null);
}
function decodePayload(call) {
  const at = call.args.indexOf('-Base64');
  return JSON.parse(Buffer.from(call.args[at + 1], 'base64').toString('utf8'));
}

function mount(config = {}, deps = {}) {
  const routes = [];
  const ctx = {
    effect(fn) { fn(); return () => {}; },
    webServer: { register(route) { routes.push(route); return () => {}; } },
  };
  win.mountWinToast(ctx, config, { bindHost: undefined, allowedOrigins: [] }, undefined, {
    spawn: fakeSpawn,
    execFile: fakeExec,
    psPath: psPath,
    scriptPath: scriptPath,
    aumid: 'test.aumid',
    ...deps,
  });
  return routes;
}

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
function writeAction(name, url) {
  fs.mkdirSync(actionsDir, { recursive: true });
  fs.writeFileSync(path.join(actionsDir, name), url);
}
function post(handler, note) {
  return call(handler, 'POST', { 'x-dsh-notify-me-win': 'toast' }, JSON.stringify(note));
}
const HEADERS = { 'x-dsh-notify-me-win': 'toast' };
const APPROVAL = { title: 'DSH · 审批请求', body: '会话：bash', sessionId: 'sess-1', tag: 'tag-1', approvalKey: 'approval:sess-1:1', approveText: '同意', rejectText: '拒绝' };

// 1. Not the Windows desktop: no route at all, so the page keeps its own toasts.
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const realElectron = process.versions.electron;
Object.defineProperty(process, 'platform', { value: 'linux' });
assert(mount().length === 0, 'no route outside the Windows desktop host');

Object.defineProperty(process, 'platform', { value: 'win32' });
Object.defineProperty(process.versions, 'electron', { value: 'test', configurable: true, writable: true });

try {
  // 2. Disabled helper: route answers, probe says so, send refuses.
  const off = mount({ enabled: false });
  assert(off.length === 1 && off[0].kind === 'exact' && off[0].path === win.WIN_TOAST_ROUTE, 'exact route');
  const probeOff = await call(off[0].handler, 'GET');
  assert(JSON.parse(probeOff.body).enabled === false, 'a disabled helper reports enabled:false');
  assert((await post(off[0].handler, { title: 't' })).status === 501, 'POST while disabled is 501');

  // 3. Enabled helper.
  const routes = mount();
  assert(routes.length === 1, 'exactly one route');
  const handler = routes[0].handler;

  const probe = JSON.parse((await call(handler, 'GET')).body);
  assert(probe.ok === true && probe.enabled === true && Array.isArray(probe.actions) && probe.actions.length === 0,
    'the probe reports enabled:true and no actions yet');

  assert((await call(handler, 'PUT')).status === 405, 'PUT is 405');
  assert((await call(handler, 'GET', {}, undefined, '10.0.0.9')).status === 403, 'a non-loopback peer is 403');
  assert((await call(handler, 'POST', {}, '{"title":"t"}')).status === 403, 'POST without the intent header is 403');
  assert((await call(handler, 'POST', HEADERS, 'not json')).status === 400, 'a non-JSON body is 400');
  assert((await post(handler, { body: 'b' })).status === 400, 'a body without a title is 400');

  // 3a. One approval toast: protocol registered, payload carries the buttons.
  const sent = await post(handler, APPROVAL);
  const sentBody = JSON.parse(sent.body);
  assert(sent.status === 200 && sentBody.ok === true, 'an accepted approval answers 200 ok');
  assert(typeof sentBody.token === 'string' && sentBody.token.length === 32, 'the page gets a 32-hex token');
  assert(typeof sentBody.id === 'string' && sentBody.id.length <= 16, 'the history tag fits the Windows limit');
  assert(spawned.length === 1, 'one PowerShell spawn per toast');
  assert(spawned[0].bin === psPath && spawned[0].args.includes('-File') && spawned[0].args.includes(scriptPath),
    'the helper script is the spawned file');
  const payload = decodePayload(spawned[0]);
  assert(payload.aumid === 'test.aumid', 'the AUMID reaches the helper');
  assert(payload.title === APPROVAL.title && payload.body === APPROVAL.body, 'title and body reach the helper');
  assert(payload.tag === sentBody.id && payload.session === 'sess-1', 'history tag and session reach the helper');
  assert(payload.approveToken === sentBody.token && payload.rejectToken.length === 32, 'both buttons carry tokens');
  assert(payload.approveText === '同意' && payload.rejectText === '拒绝', 'button labels reach the helper');
  assert(payload.sound === false, 'the sound flag is off unless the cue is system');

  assert(execCalls.length === 3, 'first approval registers the protocol with three reg.exe calls');
  assert(execCalls[0].file === 'reg' && execCalls[0].args.join(' ').includes('HKCU\\Software\\Classes\\dsh-notify-me'),
    'the protocol is registered under HKCU\\Software\\Classes');
  const handlerVbs = path.join(tmp, 'dsh-notify-me', 'notify-handler.vbs');
  assert(fs.existsSync(handlerVbs), 'the protocol handler script is written');
  const vbsBytes = fs.readFileSync(handlerVbs);
  assert(vbsBytes[0] === 0xff && vbsBytes[1] === 0xfe, 'the handler script carries a UTF-16LE BOM');
  const vbsText = vbsBytes.subarray(2).toString('utf16le');
  assert(/^[\x00-\x7f]*$/.test(vbsText), 'the handler script is pure ASCII, so a non-ASCII profile path cannot be garbled');
  assert(vbsText.includes('sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\dsh-notify-me\\actions"'),
    'the actions directory is resolved from %LOCALAPPDATA% at click time');
  assert(!vbsText.includes(tmp), 'no profile path is baked into the handler script');

  // 3b. Approve click: single use, bound to the approval key.
  writeAction('a1.txt', 'dsh-notify-me://approve?token=' + sentBody.token);
  const approved = JSON.parse((await call(handler, 'GET')).body);
  assert(approved.actions.length === 1 && approved.actions[0].action === 'approve', 'the click is delivered as approve');
  assert(approved.actions[0].key === 'approval:sess-1:1' && approved.actions[0].sessionId === 'sess-1', 'the decision is bound to the key');
  assert(JSON.parse((await call(handler, 'GET')).body).actions.length === 0, 'the action is delivered once');
  writeAction('a2.txt', 'dsh-notify-me://approve?token=' + sentBody.token);
  assert(JSON.parse((await call(handler, 'GET')).body).actions.length === 0, 'a used token is dead');

  // 3c. Reject click.
  const second = JSON.parse((await post(handler, { ...APPROVAL, tag: 'tag-2' })).body);
  writeAction('a3.txt', 'dsh-notify-me://reject?token=' + second.token);
  const rejected = JSON.parse((await call(handler, 'GET')).body);
  assert(rejected.actions.length === 1 && rejected.actions[0].action === 'reject', 'the click is delivered as reject');

  // 3d. Body click: raises DSH and carries the session back.
  writeAction('a4.txt', 'dsh-notify-me://open?session=sess-9');
  const opened = JSON.parse((await call(handler, 'GET')).body);
  assert(opened.actions.length === 1 && opened.actions[0].action === 'open' && opened.actions[0].sessionId === 'sess-9',
    'a body click delivers an open action with its session');

  // 3e. Expiry: a token older than the TTL never becomes a decision.
  let clock = 1000;
  const clocked = mount({}, { now: () => clock });
  assert(clocked.length === 1, 'clocked mount still registers the route');
  const aged = JSON.parse((await post(clocked[0].handler, { ...APPROVAL, tag: 'tag-3' })).body);
  clock += 3 * 60 * 1000 + 1;
  writeAction('a5.txt', 'dsh-notify-me://approve?token=' + aged.token);
  assert(JSON.parse((await call(clocked[0].handler, 'GET')).body).actions.length === 0, 'an expired token is ignored');

  // 3f. Removal: withdraw by page tag, resolved to the history tag.
  spawned.length = 0;
  const removed = await post(handler, { remove: 'tag-1' });
  assert(removed.status === 200, 'a remove answers 200');
  assert(spawned.length === 1 && spawned[0].args.includes('-RemoveTag') && spawned[0].args.includes(sentBody.id),
    'the remove spawns -RemoveTag for the history tag');
} finally {
  if (realLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = realLocalAppData;
  Object.defineProperty(process, 'platform', realPlatform);
  if (realElectron === undefined) delete process.versions.electron;
  else Object.defineProperty(process.versions, 'electron', { value: realElectron, configurable: true, writable: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('win toast route OK: desktop gate, 405/403/501/400, payload, HKCU protocol, tokens (single-use/TTL), remove');
