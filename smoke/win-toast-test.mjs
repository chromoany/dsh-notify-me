// Windows approval-toast route: lib/win-toast.js.
//
// The route only exists on the packed Windows desktop shell, so this test fakes
// that environment (a `win32` platform and an `electron` version string). The
// PowerShell helper cannot reasonably run in CI, so spawn/exec are injected:
// what is pinned here is the route contract (405/403/501/400, GET actions,
// POST send/remove), the decoded toast payload, the HKCU registrations (the
// protocol handler, the plugin's own AUMID and its empty activator CLSID), the
// encoding of the generated VBS handler, and the token rules — single use,
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
// The toast must not borrow the DSH shell's AUMID: that AUMID has a COM toast
// activator registered, so Windows handed every activation to DSH and the
// protocol handler never ran — the buttons only dismissed the toast (issue #41).
assert(win.AUMID === 'dsh-notify-me', "the toast posts under the plugin's own AUMID");
assert(win.AUMID !== 'electron.app.DeepSeek Harness', 'never under the DSH shell AUMID');
assert(/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/.test(win.ACTIVATOR_CLSID),
  'the activator stub is a full CLSID');
// The toast body click must always come back through our protocol handler: the
// helper's dsh://open launch is dead on Windows, and the page's host-route raise
// is what brings a minimized or tray-hidden window back (issue #40).
const toastPs1 = fs.readFileSync(path.join(ROOT, 'lib', 'win-toast.ps1'), 'utf8');
assert(!toastPs1.includes('launch="dsh://open"'), 'the toast body never launches dsh://open');
assert(toastPs1.includes('launch="dsh-notify-me://open"'), 'the toast body launches our own protocol');

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

function mount(config = {}, deps = {}, shared = { bindHost: undefined, allowedOrigins: [] }) {
  const routes = [];
  const ctx = {
    effect(fn) { fn(); return () => {}; },
    webServer: { register(route) { routes.push(route); return () => {}; } },
  };
  win.mountWinToast(ctx, config, shared, undefined, {
    spawn: fakeSpawn,
    execFile: fakeExec,
    psPath: psPath,
    scriptPath: scriptPath,
    aumid: 'test.aumid',
    osBuild: 26200,
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

  assert(execCalls.length === 6, 'the first toast registers the protocol, the AUMID and the activator stub');
  const regs = execCalls.map((c) => c.args.join(' '));
  assert(execCalls[0].file === 'reg' && regs[0].includes('HKCU\\Software\\Classes\\dsh-notify-me'),
    'the protocol is registered under HKCU\\Software\\Classes');
  assert(regs[3].includes('HKCU\\Software\\Classes\\AppUserModelId\\test.aumid') && regs[3].includes('DisplayName'),
    'the toast AUMID gets the display name the notification header shows');
  assert(regs[4].includes('\\test.aumid') && regs[4].includes('CustomActivator') && regs[4].includes(win.ACTIVATOR_CLSID),
    'the AUMID names the activator stub');
  assert(regs[5] === 'add HKCU\\Software\\Classes\\CLSID\\' + win.ACTIVATOR_CLSID + ' /f',
    'the activator CLSID is created empty: with no LocalServer32 Windows dispatches the protocol (issue #41)');
  assert(!regs.some((line) => line.includes('LocalServer32')), 'no COM server is installed');
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
  // Windows rewrites a protocol URI that has no path before handing it to the
  // handler: dsh-notify-me://approve?token=… arrives as approve/?token=… (seen
  // on Windows 11 26200 with a real toast click). The decision must survive it.
  const rewritten = JSON.parse((await post(handler, { ...APPROVAL, tag: 'tag-4' })).body);
  writeAction('a2b.txt', 'dsh-notify-me://approve/?token=' + rewritten.token);
  const normalized = JSON.parse((await call(handler, 'GET')).body);
  assert(normalized.actions.length === 1 && normalized.actions[0].action === 'approve'
    && normalized.actions[0].key === 'approval:sess-1:1',
    'a shell-normalized action URL (slash before the query) still delivers the decision');

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
  // A body click without a session is still a raise request; the page must see
  // it (issue #40: it used to be dropped here and only dsh://open tried to wake
  // the window, which never worked).
  writeAction('a4b.txt', 'dsh-notify-me://open');
  const openedNoSession = JSON.parse((await call(handler, 'GET')).body);
  assert(openedNoSession.actions.length === 1 && openedNoSession.actions[0].action === 'open'
    && openedNoSession.actions[0].sessionId === '',
    'a no-session body click keeps an open action with no session');

  // 3e. Expiry: a token older than the TTL never becomes a decision.
  let clock = 1000;
  const clocked = mount({}, { now: () => clock });
  assert(clocked.length === 1, 'clocked mount still registers the route');
  const aged = JSON.parse((await post(clocked[0].handler, { ...APPROVAL, tag: 'tag-3' })).body);
  clock += 3 * 60 * 1000 + 1;
  writeAction('a5.txt', 'dsh-notify-me://approve?token=' + aged.token);
  assert(JSON.parse((await call(clocked[0].handler, 'GET')).body).actions.length === 0, 'an expired token is ignored');

  // 3g. The composition's admission fence runs first when the host exposes its
  // connection service: an unauthenticated browser session never reaches the
  // action files or the toast helper, and an admitted request still gets the
  // plugin's own loopback gate.
  let admissionCalls = 0;
  const fenced = mount({}, {}, {
    bindHost: undefined,
    allowedOrigins: [],
    connection: () => ({
      requestRejection(req) {
        admissionCalls += 1;
        return req.headers['x-test-deny'] ? 401 : undefined;
      },
    }),
  });
  assert(fenced.length === 1, 'fenced mount registers the toast route');
  const fencedDenied = await call(fenced[0].handler, 'GET', { 'x-test-deny': '1' });
  assert(fencedDenied.status === 401 && JSON.parse(fencedDenied.body).reason === 'unauthenticated',
    'a connection 401 is relayed before the toast route answers');
  const fencedProbe = JSON.parse((await call(fenced[0].handler, 'GET')).body);
  assert(fencedProbe.ok === true && admissionCalls === 2, 'an admitted probe answers normally after one admission call');
  const fencedPeer = await call(fenced[0].handler, 'GET', {}, undefined, '10.0.0.9');
  assert(fencedPeer.status === 403 && JSON.parse(fencedPeer.body).reason === 'bad-remote',
    'the plugin gate still refuses a non-loopback peer after admission');

  // 3f. Removal: withdraw by page tag, resolved to the history tag.
  spawned.length = 0;
  const removed = await post(handler, { remove: 'tag-1' });
  assert(removed.status === 200, 'a remove answers 200');
  assert(spawned.length === 1 && spawned[0].args.includes('-RemoveTag') && spawned[0].args.includes(sentBody.id),
    'the remove spawns -RemoveTag for the history tag');
  // 3h. A toast without buttons registers the app identity first too: its body
  // click comes back through the same protocol, and Windows only dispatches it
  // for an AUMID that does not answer to a COM activator.
  const plain = mount({}, { aumid: '' }); // '' falls back to the module default
  const plainSent = JSON.parse((await post(plain[0].handler, { title: 'DSH waiting for input', body: 'session: bash', tag: 'q-1' })).body);
  assert(plainSent.ok === true && plainSent.token === '', 'a toast without an approval key carries no token');
  const plainSpawned = spawned.length;
  const plainRegs = execCalls.slice(-6).map((c) => c.args.join(' '));
  assert(plainRegs.some((line) => line.includes('HKCU\\Software\\Classes\\AppUserModelId\\' + win.AUMID)),
    'without an injected AUMID the registration writes the plugin-owned one');
  assert(!plainRegs.some((line) => line.includes('electron.app')), 'the DSH shell AUMID is never registered here');

  // 3i. Windows 10: the route stays mounted (so debug() can say why) but the
  // helper never claims to be usable — posting would only yield buttons whose
  // clicks Windows 10 drops (issue #41).
  const regsBeforeTen = execCalls.length;
  const tenRoutes = mount({}, { osBuild: 19045 });
  assert(tenRoutes.length === 1, 'the route still answers on Windows 10');
  const tenProbe = JSON.parse((await call(tenRoutes[0].handler, 'GET')).body);
  assert(tenProbe.ok === true && tenProbe.enabled === false && tenProbe.reason === 'windows-10',
    'a Windows 10 helper reports enabled:false and the reason');
  const tenPost = await post(tenRoutes[0].handler, { title: 't', approvalKey: 'approval:sess-1:1' });
  assert(tenPost.status === 501 && JSON.parse(tenPost.body).reason === 'windows-10', 'Windows 10 refuses to post');
  assert(execCalls.length === regsBeforeTen && spawned.length === plainSpawned,
    'Windows 10 registers nothing and posts no toast');
} finally {
  if (realLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = realLocalAppData;
  Object.defineProperty(process, 'platform', realPlatform);
  if (realElectron === undefined) delete process.versions.electron;
  else Object.defineProperty(process.versions, 'electron', { value: realElectron, configurable: true, writable: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('win toast route OK: desktop gate, 405/403/501/400, payload, HKCU protocol + app identity, Windows 10 gate, tokens (single-use/TTL), remove');
