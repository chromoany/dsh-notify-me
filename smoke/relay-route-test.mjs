// Relay route test: the same-origin route the page posts through when its
// gateway needs authentication the browser cannot supply.
//
// Why its own file: this route is the only place in the plugin where a request
// from the page turns into a request the host makes on its behalf, so its
// status mapping is a contract the page's own retry logic reads (200 sent /
// 502 gateway refused / 503 host has no credential), and the payload mapping
// is a correctness trap — one forwarded `tag` turns every Apprise delivery
// into 424 "nothing could be sent".
//
// What is pinned here: the GET/HEAD probe, 405, the gate on POST (fed by the
// same top-level allow-list the bridge route and the health probe use),
// 403/413/400/503 refusals, the 200/502 mapping, the exact forwarded payload (no `tag`,
// `text` used when `body` is missing), the credentials file in both of its
// shapes, the configured headers, and that a 401 retries exactly once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const RELAY = '/__dsh-notify-me/relay/' + 'a7f3'.repeat(8);
const TARGET = 'https://cue.example/notify/hook-key';
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

const host = await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href);

const realFetch = globalThis.fetch;
const basic = (user, password) => 'Basic ' + Buffer.from(user + ':' + password, 'utf8').toString('base64');

/** Capture the requests the host would send to the gateway. */
function captureFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: init.body });
    const answer = (responder ? responder(calls) : undefined) ?? { status: 200, text: 'Sent' };
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, text: async () => answer.text ?? '' };
  };
  return calls;
}

/** Boot the plugin over a hand-written ctx; relay only, so no session feed. */
function bootRelay(relayOver) {
  const routes = [];
  const warnings = [];
  const effect = (fn) => {
    const off = fn();
    return () => { if (typeof off === 'function') off(); };
  };
  const ctx = {
    logger: { info() {}, warn(message) { warnings.push(String(message)); } },
    on() { return () => {}; },
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
  const { allowedOrigins, ...relayFields } = relayOver;
  host.apply(ctx, {
    allowedOrigins,
    gateway: { target: relayOver.gatewayTarget === undefined ? TARGET : relayOver.gatewayTarget, credentialsFile: relayOver.credentialsFile },
    relay: Object.assign({ enabled: true, path: RELAY }, relayFields),
  });
  const route = (routePath) => {
    const found = routes.find((candidate) => candidate.path === routePath);
    assert(found !== undefined, 'a route is registered at ' + routePath + ' (got ' + routes.map((r) => r.path).join(', ') + ')');
    return found;
  };
  return { routes, warnings, route };
}

/** Drive one route with the globals the handlers touch. */
function call(route, spec) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('route did not answer: ' + spec.method)), 3000);
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-me-relay-'));
const credFile = path.join(tempDir, 'gateway.json');
const tokenFile = path.join(tempDir, 'token.json');
fs.writeFileSync(credFile, JSON.stringify({ user: 'alice', password: 'secret' }), { mode: 0o600 });
fs.writeFileSync(tokenFile, JSON.stringify({ authorization: 'tok-123' }), { mode: 0o600 });

const eventBody = (over) => JSON.stringify(Object.assign({
  source: 'dsh-notify-me',
  version: '1.14.7',
  event: 'done',
  title: 'DSH · 回复完成 · atlas',
  body: 'atlas\n你刚才问：check the parser',
  text: 'DSH · 回复完成 · atlas\natlas\n你刚才问：check the parser',
  sessionId: 'sess-alpha',
  time: '2026-10-28T06:00:00.000Z',
  tag: 'attention',
}, over || {}));

try {
  // 1) The read-only probe, and that only POST forwards anything.
  {
    captureFetch();
    const relay = bootRelay({ target: TARGET, credentialsFile: credFile, allowedOrigins: ['https://dsh.example.com'] });
    const handle = relay.route(RELAY);
    const probe = await call(handle, { method: 'GET' });
    assert(probe.status === 200 && probe.body.ok === true, 'the GET probe answers 200 ok (got ' + probe.status + ')');
    assert(probe.body.route === RELAY, 'the probe names its own route, got ' + probe.body.route);
    assert(probe.body.version === PKG_VERSION, 'the probe reports the package version, got ' + probe.body.version);
    assert(probe.body.enabled === true, 'the probe reports the route as enabled');
    const head = await call(handle, { method: 'HEAD' });
    assert(head.status === 200, 'HEAD is answered like GET (got ' + head.status + ')');
    // The probe is behind the same gate as every other entry point: the path is
    // a capability, so an ungated probe would confirm a guessed token.
    const probeForeignPeer = await call(handle, { method: 'GET', remoteAddress: '203.0.113.9' });
    assert(probeForeignPeer.status === 403 && probeForeignPeer.body.reason === 'bad-remote',
      'a non-loopback peer cannot read the probe (got ' + probeForeignPeer.status + ' ' + JSON.stringify(probeForeignPeer.body) + ')');
    const probeForeignHost = await call(handle, { method: 'GET', headers: { host: 'evil.example' } });
    assert(probeForeignHost.status === 403 && probeForeignHost.body.reason === 'bad-host',
      'a foreign Host cannot read the probe (got ' + probeForeignHost.status + ')');
    const probeTunnel = await call(handle, {
      method: 'GET',
      headers: { host: 'dsh.example.com', origin: 'https://dsh.example.com' },
    });
    assert(probeTunnel.status === 200, 'the allow-listed public name can read the probe (got ' + probeTunnel.status + ')');
    for (const method of ['PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      const refused = await call(handle, { method });
      assert(refused.status === 405 && refused.body.reason === 'method-not-allowed',
        method + ' answers 405 (got ' + refused.status + ')');
    }
    globalThis.fetch = realFetch;
  }

  // 2) The shared gate on POST: a cross-site page that learned the capability
  // path is still refused, and a rebinding page cannot borrow a foreign Host.
  {
    const calls = captureFetch();
    const relay = bootRelay({ target: TARGET, credentialsFile: credFile, allowedOrigins: ['https://dsh.example.com'] });
    const handle = relay.route(RELAY);
    const crossOrigin = await call(handle, { method: 'POST', headers: { origin: 'https://evil.example' }, body: eventBody() });
    assert(crossOrigin.status === 403 && crossOrigin.body.reason === 'cross-origin',
      'a foreign Origin is refused (got ' + crossOrigin.status + ' ' + JSON.stringify(crossOrigin.body) + ')');
    const foreignPeer = await call(handle, { method: 'POST', remoteAddress: '203.0.113.9', body: eventBody() });
    assert(foreignPeer.status === 403 && foreignPeer.body.reason === 'bad-remote',
      'a non-loopback peer is refused (got ' + foreignPeer.status + ')');
    const foreignHost = await call(handle, { method: 'POST', headers: { host: 'evil.example' }, body: eventBody() });
    assert(foreignHost.status === 403 && foreignHost.body.reason === 'bad-host',
      'a foreign Host is refused (got ' + foreignHost.status + ')');
    assert(calls.length === 0, 'none of the refused requests reached the gateway (got ' + calls.length + ')');
    globalThis.fetch = realFetch;
  }

  // 3) The happy path: the payload is mapped onto the gateway schema and the
  // host adds the credential. `tag` must not survive — an unmatched Apprise tag
  // turns the delivery into 424.
  {
    const calls = captureFetch(() => ({ status: 200, text: 'Sent (1/1)' }));
    const relay = bootRelay({ target: TARGET, credentialsFile: credFile, headers: { 'x-relay': 'yes' } });
    const handle = relay.route(RELAY);
    const posted = await call(handle, { method: 'POST', body: eventBody() });
    assert(posted.status === 200 && posted.body.ok === true,
      'a delivered event answers 200 (got ' + posted.status + ' ' + JSON.stringify(posted.body) + ')');
    assert(posted.body.upstreamStatus === 200 && posted.body.upstreamBody === 'Sent (1/1)',
      'the gateway status and body are reported (got ' + JSON.stringify(posted.body) + ')');
    assert(calls.length === 1, 'exactly one gateway request was made (got ' + calls.length + ')');
    const sent = calls[0];
    assert(sent.url === TARGET, 'the request went to the configured target, got ' + sent.url);
    assert(sent.headers['content-type'] === 'application/json', 'the gateway request is JSON');
    assert(sent.headers['x-relay'] === 'yes', 'the configured headers are attached, got ' + JSON.stringify(sent.headers));
    assert(sent.headers.authorization === basic('alice', 'secret'),
      'the credentials file supplies Basic auth, got ' + sent.headers.authorization);
    const forwarded = JSON.parse(sent.body);
    assert(forwarded.title === 'DSH · 回复完成 · atlas', 'the title is forwarded, got ' + JSON.stringify(forwarded.title));
    assert(forwarded.body === 'atlas\n你刚才问：check the parser', 'the body is forwarded, got ' + JSON.stringify(forwarded.body));
    assert(forwarded.type === 'info', 'the type is the fixed info, got ' + forwarded.type);
    assert(forwarded.tag === undefined, 'the page tag is never forwarded (Apprise would answer 424)');
    assert(Object.keys(forwarded).length === 3, 'nothing else is forwarded, got ' + Object.keys(forwarded).join(','));
    globalThis.fetch = realFetch;
  }

  // 4) Fallbacks that make the route usable by any custom target: a missing
  // title, and a payload that only carries the rendered text.
  {
    const calls = captureFetch();
    const relay = bootRelay({ target: TARGET, credentialsFile: credFile });
    const handle = relay.route(RELAY);
    const posted = await call(handle, { method: 'POST', body: JSON.stringify({ text: 'only the text' }) });
    assert(posted.status === 200, 'a minimal payload is accepted (got ' + posted.status + ')');
    const forwarded = JSON.parse(calls[0].body);
    assert(forwarded.title === 'DSH', 'a missing title falls back to DSH, got ' + JSON.stringify(forwarded.title));
    assert(forwarded.body === 'only the text', 'a missing body falls back to text, got ' + JSON.stringify(forwarded.body));
    globalThis.fetch = realFetch;

    const tokenCalls = captureFetch();
    const tokenRelay = bootRelay({ target: TARGET, credentialsFile: tokenFile });
    await call(tokenRelay.route(RELAY), { method: 'POST', body: eventBody() });
    assert(tokenCalls[0].headers.authorization === 'Bearer tok-123',
      'a bare authorization token is sent as a bearer token, got ' + tokenCalls[0].headers.authorization);
    globalThis.fetch = realFetch;

    const headerCalls = captureFetch();
    const headerRelay = bootRelay({ target: TARGET, credentialsFile: credFile, headers: { authorization: 'Basic ' + basic('cfg', 'pw') } });
    await call(headerRelay.route(RELAY), { method: 'POST', body: eventBody() });
    assert(headerCalls[0].headers.authorization === 'Basic ' + basic('cfg', 'pw'),
      'an authorization written into the configured headers wins over the file');
    globalThis.fetch = realFetch;
  }

  // 4b) A gateway that needs no authentication at all: an empty
  // `credentialsFile` means "send it as-is", not "misconfigured", so the page
  // gets the gateway's real verdict instead of a credential error on every
  // alert.
  {
    const calls = captureFetch(() => ({ status: 200, text: 'Sent' }));
    const relay = bootRelay({ target: TARGET, credentialsFile: '' });
    const posted = await call(relay.route(RELAY), { method: 'POST', body: eventBody() });
    assert(posted.status === 200 && posted.body.ok === true && posted.body.upstreamStatus === 200,
      'an unauthenticated gateway accepts the delivery (got ' + posted.status + ' ' + JSON.stringify(posted.body) + ')');
    assert(calls.length === 1, 'exactly one gateway request was made (got ' + calls.length + ')');
    assert(calls[0].headers.authorization === undefined,
      'and it carries no Authorization header (got ' + JSON.stringify(calls[0].headers.authorization) + ')');
    assert(calls[0].headers['content-type'] === 'application/json', 'while still being a JSON POST');
    assert(relay.warnings.length === 0, 'an empty credentials path is not treated as a failure, got ' + JSON.stringify(relay.warnings));
    globalThis.fetch = realFetch;
  }

  // 5) Refusals that never leave the host: an oversized body, a body that is
  // not a JSON object, and a gateway credential the host cannot read.
  {
    const calls = captureFetch();
    const relay = bootRelay({ target: TARGET, credentialsFile: credFile });
    const handle = relay.route(RELAY);

    const huge = await call(handle, { method: 'POST', body: JSON.stringify({ body: 'x'.repeat(65 * 1024) }) });
    assert(huge.status === 413 && huge.body.reason === 'body-too-large',
      'a body over 64KB answers 413 (got ' + huge.status + ' ' + JSON.stringify(huge.body) + ')');
    const badJson = await call(handle, { method: 'POST', body: 'nope{' });
    assert(badJson.status === 400 && badJson.body.reason === 'invalid-json',
      'a malformed body answers 400 (got ' + badJson.status + ')');
    const arrayBody = await call(handle, { method: 'POST', body: '[{"title":"x"}]' });
    assert(arrayBody.status === 400 && arrayBody.body.reason === 'invalid-json',
      'a JSON array is not an event object (got ' + arrayBody.status + ')');
    const scalarBody = await call(handle, { method: 'POST', body: '"hello"' });
    assert(scalarBody.status === 400, 'a JSON string is not an event object (got ' + scalarBody.status + ')');
    assert(calls.length === 0, 'no refused request reached the gateway (got ' + calls.length + ')');
    globalThis.fetch = realFetch;

    const missingCalls = captureFetch();
    const missing = bootRelay({ target: TARGET, credentialsFile: path.join(tempDir, 'does-not-exist.json') });
    const unavailable = await call(missing.route(RELAY), { method: 'POST', body: eventBody() });
    assert(unavailable.status === 503 && unavailable.body.reason === 'credentials-unavailable',
      'an unreadable credential file answers 503 (got ' + unavailable.status + ' ' + JSON.stringify(unavailable.body) + ')');
    assert(missingCalls.length === 0, 'nothing was sent without credentials');
    assert(missing.warnings.length === 1, 'the missing credential is warned about once, got ' + JSON.stringify(missing.warnings));
    globalThis.fetch = realFetch;
  }

  // 6) The upstream verdict is reported verbatim: the page needs to know
  // whether the gateway accepted the delivery, which is the whole reason this
  // route exists.
  {
    const calls = captureFetch(() => ({ status: 500, text: 'internal error x'.repeat(60) }));
    const relay = bootRelay({ target: TARGET, credentialsFile: credFile });
    const failed = await call(relay.route(RELAY), { method: 'POST', body: eventBody() });
    assert(failed.status === 502 && failed.body.ok === false,
      'a gateway error answers 502 (got ' + failed.status + ')');
    assert(failed.body.upstreamStatus === 500, 'the gateway status is preserved, got ' + failed.body.upstreamStatus);
    assert(failed.body.upstreamBody.length <= 500, 'the quoted body is bounded, got ' + failed.body.upstreamBody.length);
    globalThis.fetch = realFetch;

    const deadCalls = captureFetch(() => { throw new Error('connection refused'); });
    const dead = bootRelay({ target: TARGET, credentialsFile: credFile });
    const unreachable = await call(dead.route(RELAY), { method: 'POST', body: eventBody() });
    assert(unreachable.status === 502 && unreachable.body.reason === 'upstream-error',
      'an unreachable gateway answers 502 upstream-error (got ' + unreachable.status + ' ' + JSON.stringify(unreachable.body) + ')');
    assert(deadCalls.length === 1, 'an unreachable gateway is tried once, got ' + deadCalls.length);
    globalThis.fetch = realFetch;
  }

  // 7) A 401 is a rotated password until proven otherwise: drop the cache,
  // re-read the file, retry exactly once.
  {
    const calls = captureFetch((recorded) => {
      if (recorded.length === 1) {
        fs.writeFileSync(credFile, JSON.stringify({ user: 'alice', password: 'rotated' }), { mode: 0o600 });
        return { status: 401, text: 'unauthorized' };
      }
      return { status: 200, text: 'Sent' };
    });
    const relay = bootRelay({ target: TARGET, credentialsFile: credFile });
    const recovered = await call(relay.route(RELAY), { method: 'POST', body: eventBody() });
    assert(recovered.status === 200 && recovered.body.ok === true,
      'the delivery recovers once the file is re-read (got ' + recovered.status + ' ' + JSON.stringify(recovered.body) + ')');
    assert(calls.length === 2, 'exactly one retry was made (got ' + calls.length + ')');
    assert(calls[0].headers.authorization === basic('alice', 'secret'), 'the first attempt used the cached credential');
    assert(calls[1].headers.authorization === basic('alice', 'rotated'), 'the retry used the new credential');
    globalThis.fetch = realFetch;
    fs.writeFileSync(credFile, JSON.stringify({ user: 'alice', password: 'secret' }), { mode: 0o600 });

    const stubbornCalls = captureFetch(() => ({ status: 401, text: 'still unauthorized' }));
    const stubborn = bootRelay({ target: TARGET, credentialsFile: credFile });
    const stillRefused = await call(stubborn.route(RELAY), { method: 'POST', body: eventBody() });
    await sleep(20);
    assert(stubbornCalls.length === 2, 'a persistent 401 is retried once, not forever (got ' + stubbornCalls.length + ')');
    assert(stillRefused.status === 502 && stillRefused.body.upstreamStatus === 401,
      'the surviving 401 is reported as a gateway refusal (got ' + stillRefused.status + ' ' + JSON.stringify(stillRefused.body) + ')');
    globalThis.fetch = realFetch;
  }

  // 8) A tunnel sends the public name: the gate accepts it only because the
  // config lists that origin, which is also what makes the Host acceptable.
  {
    const calls = captureFetch();
    const relay = bootRelay({ target: TARGET, credentialsFile: credFile, allowedOrigins: ['https://dsh.example.com'] });
    const tunneled = await call(relay.route(RELAY), {
      method: 'POST',
      headers: { host: 'dsh.example.com', origin: 'https://dsh.example.com', 'x-forwarded-proto': 'https' },
      body: eventBody(),
    });
    assert(tunneled.status === 200 && tunneled.body.ok === true,
      'an allow-listed public Host and Origin pass the gate (got ' + tunneled.status + ' ' + JSON.stringify(tunneled.body) + ')');
    assert(calls.length === 1, 'and the event reaches the gateway');

    const unknown = await call(relay.route(RELAY), {
      method: 'POST',
      headers: { host: 'other.example', origin: 'https://other.example' },
      body: eventBody(),
    });
    assert(unknown.status === 403 && unknown.body.reason === 'bad-host',
      'a public name nobody allow-listed is refused (got ' + unknown.status + ' ' + JSON.stringify(unknown.body) + ')');
    assert(calls.length === 1, 'the refused request never reached the gateway');

    const rewritten = await call(relay.route(RELAY), {
      method: 'POST',
      headers: { host: '127.0.0.1:3080', origin: 'https://dsh.example.com' },
      body: eventBody(),
    });
    assert(rewritten.status === 200, 'an allow-listed Origin passes even when a proxy rewrote Host (got ' + rewritten.status + ')');
    globalThis.fetch = realFetch;
  }

  // 9) A half-configured relay is not registered at all: a route answering 502
  // on every POST would be harder to diagnose than no route.
  {
    captureFetch();
    const noPath = bootRelay({ path: '', target: TARGET, credentialsFile: credFile });
    assert(noPath.routes.filter((r) => r.path.startsWith('/__dsh-notify-me/relay/')).length === 0,
      'an empty relay.path registers no route');
    assert(noPath.warnings.length === 1, 'and warns once, got ' + JSON.stringify(noPath.warnings));
    const noTarget = bootRelay({ path: RELAY, target: '', gatewayTarget: '', credentialsFile: credFile });
    assert(noTarget.routes.filter((r) => r.path === RELAY).length === 0, 'a relay with no target registers no route');
    assert(noTarget.warnings.length === 1, 'and warns once, got ' + JSON.stringify(noTarget.warnings));
    globalThis.fetch = realFetch;
  }

  console.log('relay route OK: probe, gate, 405/413/400/503, payload mapping, 200/502, single retry');
} finally {
  globalThis.fetch = realFetch;
  fs.rmSync(tempDir, { recursive: true, force: true });
}