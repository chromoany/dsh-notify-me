// Notification content: which part of the page's alert body becomes the macOS
// subtitle, and which stays in the body.
//
// lib/client.js posts a body whose first line is the conversation name and
// whose second line is what happened. macOS draws a `subtitle` between title
// and body, so the name belongs there: left in the body it renders as one thin
// line under the title, and a completion with no snippet read as the bare
// conversation name with nothing else at all.
//
// The split lives here rather than in macos/DSHNotify.swift so it can be
// asserted on every platform — the helper itself is a macOS binary that no CI
// host can spawn. This suite pins three things: `splitNotificationBody()` on
// its own (every shape a body can arrive in), an explicit `subtitle` from the
// page winning over the split, and the argv the route hands the helper (a
// subtitle is passed only when there is one to pass, and the body never
// repeats the title).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

const mac = await import(pathToFileURL(path.join(ROOT, 'lib', 'mac-notify.js')).href);
const { splitNotificationBody, lastReplySnippet } = mac;
assert(typeof splitNotificationBody === 'function', 'mounted module exports splitNotificationBody');
assert(typeof lastReplySnippet === 'function', 'mounted module exports lastReplySnippet');

// 1. The pure split.
const cases = [
  // [body as the page wrote it, expected subtitle, expected body, why]
  ['Main\n已處理三件事，commit 已 push。', 'Main', '已處理三件事，commit 已 push。',
    'a labelled completion: the name becomes the subtitle'],
  ['Main\nReply finished', 'Main', 'Reply finished',
    'a completion with no snippet still gets a second line'],
  ['Main', '', 'Main',
    'a lone label has no boundary to cut on and stays whole'],
  ['Main: An approval is waiting for you', '', 'Main: An approval is waiting for you',
    'an approval is one line by design and must not be cut'],
  ['', '', '',
    'an empty body stays empty'],
  ['Main\n', '', 'Main\n',
    'a trailing newline leaves no detail, so nothing is split'],
  ['\nMain', '', '\nMain',
    'a leading blank line means there is no label to lift'],
  ['Main\nline two\nline three', 'Main', 'line two\nline three',
    'only the first line is lifted; the rest stays verbatim'],
  ['  Main  \n  已處理  ', 'Main', '已處理',
    'both halves are trimmed around the boundary'],
  ['PKB 設定\n已建立 global/AGENTS.md 並完成 symlink。', 'PKB 設定',
    '已建立 global/AGENTS.md 並完成 symlink。', 'CJK text splits the same way'],
  [undefined, '', '', 'a missing body is treated as empty'],
  [null, '', '', 'a null body is treated as empty'],
];
for (const [input, wantSub, wantBody, why] of cases) {
  const got = splitNotificationBody(input);
  assert(got.subtitle === wantSub,
    `${why}: subtitle ${JSON.stringify(got.subtitle)} !== ${JSON.stringify(wantSub)} for ${JSON.stringify(input)}`);
  assert(got.body === wantBody,
    `${why}: body ${JSON.stringify(got.body)} !== ${JSON.stringify(wantBody)} for ${JSON.stringify(input)}`);
}

// 1b. The reply excerpt the host pulls out of a session log.
const asst = (text, extra = []) => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }, ...extra] } } });
const snippetCases = [
  // [events, expected, why]
  [[asst('已改好 parse_range，commit 係 311ca09。')], '已改好 parse_range，commit 係 311ca09。',
    'the last reply is the excerpt'],
  [[asst('第一條'), asst('第二條')], '第二條', 'the most recent reply wins'],
  [[asst('回覆'), { type: 'assistant/message', data: { message: { content: [{ type: 'tool_call' }] } } }], '回覆',
    'a trailing event with no text is skipped'],
  [[{ type: 'tool/result', data: { message: { content: [{ type: 'text', text: '唔應該用' }] } } }], '',
    'tool results are not replies'],
  [[asst('  多餘   空白\n要壓成一行  ')], '多餘 空白 要壓成一行',
    'whitespace is collapsed so the body stays one line'],
  [[asst('x'.repeat(200))], 'x'.repeat(80) + '\u2026', 'a long reply is cut and ellipsised'],
  [[asst('', [{ type: 'image', attachment: { name: 'a.png' } }])], '',
    'an attachment-only reply has no text to show'],
  [[], '', 'an empty log has nothing to show'],
  [undefined, '', 'a missing log is not a failure'],
];
for (const [events, want, why] of snippetCases) {
  assert(lastReplySnippet(events) === want,
    `${why}: got ${JSON.stringify(lastReplySnippet(events))} !== ${JSON.stringify(want)}`);
}

// 2. The argv the route builds, driven through a fake spawn so the helper never
//    has to exist as a runnable binary.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-me-content-'));
const bundle = path.join(tmp, 'Stub Notify.app');
fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
fs.writeFileSync(path.join(bundle, 'Contents', 'MacOS', 'dsh-notify'), '');
const clickFile = path.join(tmp, 'click.json');

const spawned = [];
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
function fakeSpawn(bin, args) {
  spawned.push({ bin, args });
  return fakeChild(0, 'OK\n');
}

function mount(extra = {}) {
  const routes = [];
  const ctx = {
    effect(fn) { fn(); return () => {}; },
    webServer: { register(route) { routes.push(route); return () => {}; } },
  };
  mac.mountMacNotify(ctx, { appPath: bundle }, { bindHost: undefined, allowedOrigins: [] }, undefined, {
    spawn: fakeSpawn,
    execFile: () => {},
    clickFile,
    ...extra,
  });
  return routes;
}

function call(handler, method, headers, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.headers = { host: '127.0.0.1:1', ...headers };
    req.socket = { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' };
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

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const realElectron = process.versions.electron;
Object.defineProperty(process, 'platform', { value: 'darwin' });
Object.defineProperty(process.versions, 'electron', { value: 'test', configurable: true, writable: true });

try {
  const handler = mount()[0].handler;
  const post = (note) => call(handler, 'POST', { 'x-dsh-notify-me-mac': 'notify' }, JSON.stringify(note));
  let argv;

  // 2a0. The page can lift the label itself: a completion with no snippet sends
  //      the conversation name as `subtitle` and an empty body, because the
  //      body it needs for a page toast (issue #20) is that name alone. An
  //      explicit subtitle wins over the split, and a body the page does send
  //      is passed through untouched.
  spawned.length = 0;
  const lifted = await post({ title: 'DSH · 回复完成', body: '', subtitle: '当前会话', kind: 'done', sessionId: 's1', id: 'tag-0' });
  assert(lifted.status === 200, 'a page-lifted subtitle answers 200, got ' + lifted.status);
  argv = spawned[0].args;
  assert(argv[argv.indexOf('--subtitle') + 1] === '当前会话',
    'the page-lifted label reaches --subtitle, got ' + JSON.stringify(argv));
  assert(argv[argv.indexOf('--body') + 1] === '',
    'without a session-query service the completion body stays empty');

  spawned.length = 0;
  const explicit = await post({ title: 'DSH · 提醒', body: '手动写好的正文', subtitle: '当前会话', kind: 'attention', sessionId: 's1', id: 'tag-0b' });
  assert(explicit.status === 200, 'a body the page chose answers 200');
  argv = spawned[0].args;
  assert(argv[argv.indexOf('--body') + 1] === '手动写好的正文', 'the body the page chose is untouched');
  assert(argv[argv.indexOf('--subtitle') + 1] === '当前会话', 'the subtitle rides along with a body');

  // 2a. A labelled completion reaches the helper as a subtitle plus a detail.
  spawned.length = 0;
  const labelled = await post({
    title: 'DSH · 回复完成', body: 'Main\n已處理三件事。', sessionId: 'sess-1', id: 'tag-1', sound: true,
  });
  assert(labelled.status === 200, 'a labelled completion answers 200, got ' + labelled.status);
  argv = spawned[0].args;
  assert(argv[argv.indexOf('--subtitle') + 1] === 'Main', 'the conversation name reaches --subtitle');
  assert(argv[argv.indexOf('--body') + 1] === '已處理三件事。', 'the detail alone reaches --body');
  assert(argv[argv.indexOf('--title') + 1] === 'DSH · 回复完成', 'the title is unchanged');

  // 2b. A one-line body passes no subtitle at all, so an approval keeps its
  //     single line exactly as before.
  spawned.length = 0;
  const oneLine = await post({ title: 'DSH · 审批请求', body: '会话：bash', id: 'tag-2' });
  assert(oneLine.status === 200, 'a one-line alert answers 200, got ' + oneLine.status);
  argv = spawned[0].args;
  assert(!argv.includes('--subtitle'), 'a one-line body must not gain a subtitle');
  assert(argv[argv.indexOf('--body') + 1] === '会话：bash', 'a one-line body reaches --body whole');

  // 2c. Regression: with a body that ends at the newline, --body must not
  //     become the title. The split has no title to fall back to on purpose.
  spawned.length = 0;
  const bare = await post({ title: 'DSH · 回复完成', body: 'Main\n', id: 'tag-3' });
  assert(bare.status === 200, 'a trailing-newline body answers 200, got ' + bare.status);
  argv = spawned[0].args;
  assert(argv[argv.indexOf('--body') + 1] !== 'DSH · 回复完成', '--body must never repeat the title');
  assert(!argv.includes('--subtitle'), 'nothing is split when there is no detail');

  // 2d. The page's own limits still apply after the split: the body is cut at
  //     1000 characters, and the subtitle rides along independently.
  spawned.length = 0;
  const long = 'L'.repeat(50) + '\n' + 'D'.repeat(2000);
  const truncated = await post({ title: 't', body: long, id: 'tag-4' });
  assert(truncated.status === 200, 'a long body answers 200, got ' + truncated.status);
  argv = spawned[0].args;
  assert(argv[argv.indexOf('--subtitle') + 1] === 'L'.repeat(50), 'a 50-character label survives intact');
  assert(argv[argv.indexOf('--body') + 1].length === 1000, 'the detail is still cut at 1000 characters');

  // 2d2. A completion the page could not caption gets its body from the session
  //      log, which only the host can read. An attention alert with an empty
  //      body must not pay for that read: it has no reply to summarise.
  const reads = [];
  const snippetHandler = mount({
    readSnippet: async (sessionId) => { reads.push(sessionId); return '已改好 parse_range，commit 係 311ca09。'; },
  })[0].handler;
  const postSnippet = (note) => call(snippetHandler, 'POST', { 'x-dsh-notify-me-mac': 'notify' }, JSON.stringify(note));

  spawned.length = 0;
  const caption = await postSnippet({ title: 'DSH · Reply finished', body: '', subtitle: 'Main', kind: 'done', sessionId: 's9', id: 'tag-5' });
  assert(caption.status === 200, 'a captioned completion answers 200, got ' + caption.status);
  argv = spawned[0].args;
  assert(argv[argv.indexOf('--body') + 1] === '已改好 parse_range，commit 係 311ca09。',
    'the reply excerpt becomes the body, got ' + JSON.stringify(argv));
  assert(argv[argv.indexOf('--subtitle') + 1] === 'Main', 'the conversation name stays the subtitle');
  assert(reads.length === 1 && reads[0] === 's9', 'the host reads exactly the finished session');

  spawned.length = 0;
  reads.length = 0;
  await postSnippet({ title: 'DSH · 审批请求', body: '', subtitle: 'Main', kind: 'attention', sessionId: 's9', id: 'tag-6' });
  assert(reads.length === 0, 'an attention alert never triggers a session read');
  argv = spawned[0].args;
  assert(argv[argv.indexOf('--body') + 1] === '', 'an attention alert keeps its empty body');

  // 2d3. A session-query failure must not cost the notification: the alert is
  //      still posted, with no body.
  const failingHandler = mount({ readSnippet: async () => { throw new Error('boom'); } })[0].handler;
  spawned.length = 0;
  await call(failingHandler, 'POST', { 'x-dsh-notify-me-mac': 'notify' }, JSON.stringify({ title: 'DSH · Reply finished', body: '', subtitle: 'Main', kind: 'done', sessionId: 's9', id: 'tag-7' }));
  assert(spawned.length === 1, 'a failed read still posts the notification');
  assert(spawned[0].args.includes('--title'), 'the failed read keeps the title');

  // 2e. A withdrawal never carries content, split or not.
  spawned.length = 0;
  await post({ remove: 'tag-1' });
  assert(spawned[0].args[0] === '--remove', 'a remove spawns --remove and nothing else');
  assert(!spawned[0].args.includes('--subtitle'), 'a remove carries no subtitle');
} finally {
  Object.defineProperty(process, 'platform', realPlatform);
  if (realElectron === undefined) delete process.versions.electron;
  else Object.defineProperty(process.versions, 'electron', { value: realElectron, configurable: true, writable: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('mac notify content OK: split table, reply excerpt, --subtitle argv, title never repeated, truncation, remove');
