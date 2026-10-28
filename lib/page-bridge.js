/**
 * dsh-notify-me — what the host half and its two optional patch modules share.
 *
 * The browser half (lib/client.js) stays the product: it sees the session, it
 * decides what deserves an alert and it owns the toast. The host only steps in
 * for the two things a page cannot do — reach an authenticated gateway
 * (lib/relay.js) and keep alerting while no page is open (lib/host-fallback.js)
 * — plus the loopback route that lets the page tell the host it is still there
 * (lib/index.js).
 *
 * Those three sit on the same few primitives, and every one of them is a
 * correctness or security decision that must not drift apart:
 *
 *   - {@link gateRequest}: the boundary the focus route has always used. It
 *     moved here when a second and a third route needed the same gate, and grew
 *     the permitted-origin list so a tunnel-fronted host accepts the public
 *     name its own page dials.
 *   - {@link createCredentialReader} / {@link deliverNote}: the gateway
 *     credentials never reach the browser, and the "gateway refused these
 *     credentials, re-read the file once" rule has exactly one implementation,
 *     so the page route and the host pusher cannot disagree about it.
 *   - {@link createPresence}: the page's online lease. Two delivery paths with
 *     no shared state would send every alert twice; the lease is that state,
 *     and it doubles as the carrier for the page's language, which is what
 *     keeps an English page from getting Chinese host alerts.
 *   - {@link copyFor} / {@link sessionName}: the wording of a host-side alert
 *     and how a session is named inside it.
 *
 * Diagnostics go through the cordis logger the caller passes in, never through
 * console: a host process routes that logger, and a silent write to the host's
 * terminal is invisible to whoever operates it.
 */

import { readFile } from "node:fs/promises";

/** Route the page probes and renews its online lease on. */
export const BRIDGE_ROUTE = "/__dsh-notify-me/host-bridge";

/**
 * Intent header the page's bridge requests carry. Like the focus route's
 * marker, it is an intent signal and not the security boundary: a DNS-rebinding
 * page is same-origin with the address it resolved, so it can send any custom
 * header without a preflight. The gate is {@link gateRequest}; this header only
 * stops a request that was never meant as a heartbeat from moving the lease.
 */
export const BRIDGE_HEADER = "x-dsh-notify-me-page";

/** Marker value {@link BRIDGE_HEADER} must carry. */
export const BRIDGE_HEADER_VALUE = "bridge";

/** How long one gateway delivery may take before it is abandoned. */
const UPSTREAM_TIMEOUT_MS = 15000;

/**
 * Default page lease. A heartbeat every third of this keeps it fresh; the
 * generous ceiling means one slow or coalesced interval never makes the host
 * believe the page is gone and push a duplicate.
 */
const DEFAULT_PAGE_LEASE_MS = 60000;

/** Languages the host alerts exist in; anything else falls back to `zh`. */
const LANGUAGES = ["zh", "en"];

/**
 * @param hostname - bare hostname.
 * @returns the comparable lowercase form, without IPv6 brackets.
 */
function bareHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * @param hostname - bare hostname (brackets tolerated).
 * @returns whether it names the loopback interface.
 */
function isLoopbackHostname(hostname) {
  const text = bareHostname(hostname);
  if (text === "localhost" || text === "::1") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(text);
}

/**
 * @param value - raw `Host` header (`127.0.0.1:3080`, `[::1]:3080`, `localhost`).
 * @returns `{ hostname, port }`, or `null` when it is not a host at all.
 */
function splitHost(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const bracketed = text.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
  if (bracketed !== null) return { hostname: bracketed[1], port: bracketed[2] ?? "" };
  const plain = text.match(/^([A-Za-z0-9._-]+)(?::(\d{1,5}))?$/);
  if (plain === null) return null;
  return { hostname: plain[1], port: plain[2] ?? "" };
}

/**
 * Whether a peer / `Host` names the listener's own bind address.
 *
 * The webserver can be configured to bind one concrete LAN interface; on such a
 * host the shell reaches it through that address, so the request arrives from
 * this machine with the bind IP as both peer and `Host`. Accepting exactly that
 * literal keeps the gate self-addressed: a remote LAN client connects from its
 * own address, never the server's.
 * @param hostname - bare hostname from the peer address or `Host` header.
 * @param bindHost - configured bind address, if the host exposes one.
 * @returns whether they name the same machine.
 */
function isBindAddress(hostname, bindHost) {
  if (typeof bindHost !== "string" || bindHost.length === 0) return false;
  const zone = bindHost.indexOf("%");
  const text = zone === -1 ? bindHost : bindHost.slice(0, zone);
  return bareHostname(hostname) === bareHostname(text);
}

/**
 * Bare hostnames a list of allowed origins stands for.
 *
 * A tunnel or reverse proxy hands the request the *public* name, not the
 * loopback address the listener is bound to, so an `allowedOrigins` entry has
 * to widen the `Host` check as well. Without that the page's own heartbeat and
 * the relay POST would be refused as `bad-host` on exactly the deployments the
 * relay exists for.
 * @param allowedOrigins - configured origin strings, e.g. `['https://dsh.example.com']`.
 * @returns the set of bare hostnames those origins name.
 */
function originHostnames(allowedOrigins) {
  const hosts = new Set();
  for (const value of Array.isArray(allowedOrigins) ? allowedOrigins : []) {
    if (typeof value !== "string" || value.length === 0) continue;
    try {
      hosts.add(bareHostname(new URL(value).hostname));
    } catch {
      // A malformed entry is skipped rather than guessed at: a typo in the
      // config must narrow the gate, never widen it.
    }
  }
  return hosts;
}

/**
 * @param value - an origin string.
 * @returns a comparable `scheme//host[:port]` form, or `null` when the value is
 *   not an http(s) origin.
 */
function normalizeOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return `${parsed.protocol}//${bareHostname(parsed.hostname)}${parsed.port.length > 0 ? ":" + parsed.port : ""}`;
}

/**
 * Refuse a request that did not come from this machine's own page.
 *
 * The shell already rejects a foreign `Origin` before forwarding, but these
 * routes also answer plain HTTP on the host port, and a DNS-rebinding page
 * reaches that port while looking same-origin to the browser — it can send any
 * header, including {@link BRIDGE_HEADER}, and no preflight fires. What it
 * cannot forge is the connection's source address (this machine, so loopback or
 * the bind address) or the `Host` header: the shell deletes the original and
 * the fetch re-fills it from the URL it dialled, while a rebound page keeps its
 * own name.
 *
 * So the gate is: loopback or bind-address peer, the same for `Host` (plus the
 * public names listed in `allowedOrigins`, which a proxy or tunnel makes the
 * legitimate `Host`), and an `Origin` that is either explicitly allowed or
 * agrees with that `Host` when one is present.
 *
 * The focus route passes no `allowedOrigins` and therefore behaves exactly as
 * it did before this was generalized (`smoke/host-route-test.mjs` is the
 * regression net for that claim).
 * @param req - the incoming request.
 * @param options - `{ bindHost, allowedOrigins }`; both optional.
 * @returns a short refusal reason, or `null` when the request may proceed.
 */
export function gateRequest(req, options) {
  const bindHost = options?.bindHost;
  const allowedHosts = originHostnames(options?.allowedOrigins);
  const allowedOrigins = new Set();
  for (const value of Array.isArray(options?.allowedOrigins) ? options.allowedOrigins : []) {
    const normalized = normalizeOrigin(value);
    if (normalized !== null) allowedOrigins.add(normalized);
  }

  const remote = String(req.socket?.remoteAddress ?? "").replace(/^::ffff:/i, "");
  if (!isLoopbackHostname(remote) && !isBindAddress(remote, bindHost)) return "bad-remote";

  const host = splitHost(req.headers.host);
  if (host === null) return "bad-host";
  const hostname = bareHostname(host.hostname);
  if (!isLoopbackHostname(hostname) && !isBindAddress(hostname, bindHost) && !allowedHosts.has(hostname)) {
    return "bad-host";
  }

  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.length === 0) return null;
  if (origin === "dsh-app://app") return null; // the desktop page, if not stripped
  const parsed = normalizeOrigin(origin);
  if (parsed === null) return "cross-origin";
  // An explicitly allowed origin may legitimately disagree with `Host`: a proxy
  // that rewrites `Host` to its upstream address is a supported deployment.
  if (allowedOrigins.has(parsed)) return null;
  const originUrl = new URL(origin);
  const defaultPort = originUrl.protocol === "https:" ? "443" : "80";
  if (bareHostname(originUrl.hostname) !== hostname) return "cross-origin";
  if ((originUrl.port || defaultPort) !== (host.port || defaultPort)) return "cross-origin";
  return null;
}

/**
 * @param webServer - the host web server service.
 * @returns its configured bind address when it exposes one.
 */
export function bindHostOf(webServer) {
  try {
    const host = webServer?.host;
    return typeof host === "string" && host.length > 0 ? host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write a JSON response. Route handlers own the whole response lifecycle.
 * @param res - the server response.
 * @param status - HTTP status to send.
 * @param body - JSON-serialisable payload.
 */
export function respond(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Buffer a request body up to `limit` bytes.
 *
 * An oversized body is answered with 413 rather than hung up on: destroying the
 * socket (the obvious alternative) loses the verdict the caller is waiting for.
 * Buffering stops at the limit and the rest of the stream is drained and
 * dropped, so memory stays bounded either way.
 * @param req - the incoming request.
 * @param limit - maximum number of body bytes to keep.
 * @returns `{ ok: true, text }`, or `{ ok: false, reason }` where the reason
 *   distinguishes an oversized body from a stream that never arrived.
 */
export function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => settle(overflow ? { ok: false, reason: "body-too-large" } : { ok: true, text: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", () => settle({ ok: false, reason: "body-read-error" }));
  });
}

/**
 * Turn parsed credentials-file contents into an `Authorization` value.
 * @param parsed - parsed JSON of the mode-0600 credentials file.
 * @returns the header value, or `null` when the file carries no usable
 *   credential.
 */
function authorizationFrom(parsed) {
  if (parsed === null || typeof parsed !== "object") return null;
  const user = typeof parsed.user === "string" ? parsed.user : "";
  const password = typeof parsed.password === "string" ? parsed.password : "";
  if (user.length > 0 || password.length > 0) {
    // Half a pair is a broken file, not an anonymous credential: posting
    // unauthenticated would turn a config typo into a gateway-side 401 that
    // reads like a rotated password.
    if (user.length === 0 || password.length === 0) return null;
    return "Basic " + Buffer.from(user + ":" + password, "utf8").toString("base64");
  }
  const raw = typeof parsed.authorization === "string" ? parsed.authorization.trim() : "";
  if (raw.length === 0) return null;
  // A value naming its own scheme ("Basic …", "Bearer …") is passed through; a
  // bare token is the bearer token this field exists for.
  return /\s/.test(raw) ? raw : "Bearer " + raw;
}

/**
 * Read the gateway credentials, caching a successful read until the gateway
 * rejects them. A rotated password therefore recovers on the next delivery
 * (the gateway answers 401, the cache drops, the file is re-read) instead of
 * needing a restart of the host process.
 *
 * The cache lives in the host process only; the value is never handed to the
 * page and never echoed into a response or a log line.
 *
 * "No file configured" and "the file cannot be read" are different states, and
 * {@link configured} is what tells them apart: an empty path means the gateway
 * needs no authentication at all (a plain webhook), so a delivery goes out
 * without the header instead of failing on every alert. A configured path that
 * is unreadable is a real fault and stays one.
 * @param file - path of the mode-0600 JSON credentials file; empty for a
 *   gateway that needs no authentication.
 * @param logger - cordis logger, for at most one diagnostic line per failure.
 * @returns `{ configured, get, invalidate }`; `configured` says whether a file
 *   was named at all, `get()` resolves to `{ authorization }` or `null`.
 */
export function createCredentialReader(file, logger) {
  let cached = null;
  let reported = false;
  return {
    /** Whether a credentials file was configured for this gateway. */
    configured: typeof file === "string" && file.length > 0,
    /** Drop the cached credential so the next `get()` re-reads the file. */
    invalidate() {
      cached = null;
    },
    async get() {
      if (cached !== null) return cached;
      if (typeof file !== "string" || file.length === 0) return null;
      try {
        const parsed = JSON.parse(await readFile(file, "utf8"));
        const authorization = authorizationFrom(parsed);
        if (authorization === null) throw new Error("no user/password pair and no authorization value");
        cached = { authorization };
        reported = false;
        return cached;
      } catch (error) {
        if (!reported) {
          reported = true;
          logger?.warn?.(`dsh-notify-me: gateway credentials unavailable (${file}): ${error?.message ?? String(error)}`);
        }
        return null;
      }
    },
  };
}

/**
 * @param headers - a header bag.
 * @param name - a header name.
 * @returns whether the bag already carries that header, in any casing.
 */
function hasHeader(headers, name) {
  const wanted = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === wanted);
}

/**
 * One delivery attempt to the gateway; {@link deliverNote} owns the retry so
 * no caller has to remember it.
 * @param delivery - `{ target, headers, authorization }`.
 * @param note - `{ title, body, type }`.
 * @returns `{ ok, status, text }`; a network failure throws and is classified
 *   by {@link deliverNote}.
 */
async function postGateway(delivery, note) {
  const headers = { "content-type": "application/json" };
  if (delivery.headers !== null && typeof delivery.headers === "object") {
    for (const [key, value] of Object.entries(delivery.headers)) {
      if (typeof value === "string" && value.length > 0) headers[key] = value;
    }
  }
  // An authorization written into the configured headers wins: the operator
  // chose it deliberately, and silently overwriting a header someone set is
  // worse than the gateway answering 401.
  if (!hasHeader(headers, "authorization") && typeof delivery.authorization === "string" && delivery.authorization.length > 0) {
    headers.authorization = delivery.authorization;
  }
  // A plain global fetch on purpose: the host process installs its own undici
  // dispatcher at startup and that dispatcher honours the process's proxy
  // environment, so a box behind a proxy routes the delivery the same way every
  // other host request goes. A private Agent here would bypass the routing the
  // operator configured. The counterpart: in a proxied deployment the gateway
  // host must be listed in `no_proxy`, or the delivery goes out through the
  // proxy instead of straight to it.
  const upstream = await fetch(delivery.target, {
    method: "POST",
    headers,
    body: JSON.stringify(note),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const text = await upstream.text().catch(() => "");
  return { ok: upstream.ok, status: upstream.status, text };
}

/**
 * Deliver one note, re-reading credentials once when the gateway refuses them.
 *
 * Shared by the page route and the host pusher on purpose: the retry rule is
 * what makes a rotated gateway password recover without restarting the host,
 * and two copies of it would eventually disagree about how many attempts are
 * acceptable.
 *
 * A gateway with no credentials file gets an unauthenticated request: many
 * webhook endpoints simply do not ask for one, and demanding a credential file
 * there would make the feature fail on every alert for a config that is
 * correct. Only a *configured but unreadable* file is reported as
 * `credentials-unavailable`.
 * @param delivery - `{ target, headers, credentials, logger }`.
 * @param note - `{ title, body, type }`.
 * @returns `{ ok, status, text, reason }`; `reason` is
 *   `'credentials-unavailable'` or `'upstream-error'` for the two failures the
 *   callers answer differently, and `null` otherwise.
 */
export async function deliverNote(delivery, note) {
  const logger = delivery.logger;
  const reader = delivery.credentials ?? null;
  const configured = reader !== null && reader.configured === true;
  let authorization = null;
  if (configured) {
    const secret = await reader.get();
    if (secret === null) return { ok: false, status: 0, text: "credentials-unavailable", reason: "credentials-unavailable" };
    authorization = secret.authorization;
  }

  const attempt = async (value) => {
    try {
      return await postGateway({ target: delivery.target, headers: delivery.headers, authorization: value }, note);
    } catch (error) {
      logger?.warn?.(`dsh-notify-me: gateway delivery failed: ${error?.message ?? String(error)}`);
      return { ok: false, status: 0, text: String(error?.message ?? error), reason: "upstream-error" };
    }
  };

  let result = await attempt(authorization);
  if (configured && (result.status === 401 || result.status === 403)) {
    // The gateway refused these credentials, and a rotated password is the
    // common cause: drop the cache, re-read the file, try exactly once more.
    // Without a file there is nothing to re-read, so the refusal is final.
    reader.invalidate();
    const retry = await reader.get();
    if (retry !== null) result = await attempt(retry.authorization);
  }
  if (result.reason === undefined) result.reason = null;
  return result;
}

/**
 * The page's online lease.
 *
 * Both delivery paths push the same alert when both think they own it, so one
 * of them has to know about the other. The page is the better-informed sender
 * (it renders the toast and knows the session), so the host yields whenever a
 * heartbeat arrived within the lease and takes over the moment the page is
 * gone — either because the lease expired silently (crash, frozen tab) or
 * because the page said so on `pagehide`.
 *
 * The same heartbeat carries the page's language, so the host's wording follows
 * what the user is reading instead of a second, drifting config copy. It does
 * not carry the page's external-push switches: the rule is simply "the host
 * takes over while no page is open", and a page's visibility and idle
 * heuristics are invisible to the host, so honouring half of them would produce
 * a rule nobody can predict.
 * @param options - `{ leaseMs }`; `0` means "coordination off" and makes the
 *   host push unconditionally (a debugging mode, documented as producing
 *   duplicates while a page is open).
 * @returns the lease handle used by the page route and the host pusher.
 */
export function createPresence(options = {}) {
  const configured = Number(options.leaseMs);
  const leaseMs = Number.isFinite(configured) ? Math.max(0, configured) : DEFAULT_PAGE_LEASE_MS;
  /** When the last heartbeat arrived; 0 means no page has checked in yet. */
  let lastBeatAt = 0;
  /** Set by `alive:false` or {@link clear}: the page left, whatever the clock says. */
  let released = true;
  /** Last language the page reported; `null` until it reports one. */
  let language = null;

  const leaseUntil = () => (lastBeatAt === 0 || leaseMs <= 0 ? 0 : lastBeatAt + leaseMs);

  return {
    /**
     * Record one heartbeat.
     * @param beat - `{ alive, language }`, both optional; an omitted field keeps
     *   its previous value so a short heartbeat cannot erase what a full one
     *   reported, and any other key is ignored rather than trusted.
     * @returns the instant the lease now runs to (`0` when disabled).
     */
    touch(beat = {}) {
      lastBeatAt = Date.now();
      released = beat.alive === false;
      if (LANGUAGES.includes(beat.language)) language = beat.language;
      return leaseUntil();
    },
    /**
     * Record that the page is gone. The language survives: the host's next
     * alerts still have to arrive in the language the user reads.
     */
    clear() {
      released = true;
      lastBeatAt = 0;
    },
    /**
     * @param now - clock to compare against, injectable for tests.
     * @returns whether the page is currently believed to be delivering alerts
     *   itself.
     */
    isAlive(now = Date.now()) {
      if (leaseMs <= 0) return false; // coordination off: the host always pushes
      if (lastBeatAt === 0 || released) return false;
      return now - lastBeatAt < leaseMs;
    },
    /**
     * @param now - clock to compare against, injectable for tests.
     * @returns `{ alive, ageMs, leaseUntil, language }`; `ageMs` is `null` when
     *   no page ever checked in.
     */
    snapshot(now = Date.now()) {
      return {
        alive: this.isAlive(now),
        ageMs: lastBeatAt === 0 ? null : Math.max(0, now - lastBeatAt),
        leaseUntil: leaseUntil(),
        language,
      };
    },
  };
}

/**
 * Flatten text into one bounded line.
 * @param text - arbitrary text (a prompt, an approval reason).
 * @param limit - maximum characters kept.
 * @returns the collapsed text, prefixed with an ellipsis marker when clipped.
 */
export function clip(text, limit) {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length === 0) return "";
  return flat.length > limit ? flat.slice(0, limit) + "…" : flat;
}

/**
 * The host-side alert wording, in the language the page reported.
 *
 * This is a transcription of the page's own `TXT.zh` / `TXT.en` tables, not a
 * second design: an external push and the toast it stands in for have to read
 * as the same product, so the title is `<prefix> · <label>` and the body is the
 * session name plus — for an approval — the tool and its reason. Nothing from
 * the conversation itself is quoted: the last user message may carry injected
 * context (`<system-reminder>`, memory blocks, timestamps), and a notification
 * that reproduces it is unreadable.
 * @param language - `'zh'` or `'en'`; anything else falls back to `zh`.
 * @returns the string table for that language.
 */
export function copyFor(language) {
  const en = language === "en";
  return {
    language: en ? "en" : "zh",
    separator: " · ",
    // The label only; `host-fallback` prefixes it with `titlePrefix`.
    approval: en ? "Approval request" : "审批请求",
    done: en ? "Reply finished" : "回复完成",
    // The page separates the session label from an approval detail with a full
    // width colon in Chinese and a plain one in English (`TXT.*.sep`).
    bodySeparator: en ? ": " : "：",
    detailJoiner: " · ",
    /**
     * @param text - the reason a turn ended.
     * @returns that reason as an appended parenthetical.
     */
    reason: (text) => (en ? ` (${text})` : `（${text}）`),
  };
}

/**
 * @param configured - the configured `language` value (`auto` | `zh` | `en`).
 * @param fromPage - the language the page last reported, if any.
 * @returns the language to use: an explicit config wins, otherwise the page's,
 *   otherwise `zh`.
 */
export function pickLanguage(configured, fromPage) {
  if (configured === "zh" || configured === "en") return configured;
  return fromPage === "en" ? "en" : "zh";
}

/**
 * Name a session for an alert body.
 *
 * The title is what the user sees in the sidebar and is by far the most
 * recognisable, but it is generated lazily, so a cwd basename and finally the
 * session id keep the alert useful in the first seconds of a session and for
 * sessions that never get a title.
 * @param source - `{ title, cwd, id }` of the session, any field optional.
 * @returns the display name, never empty.
 */
export function sessionName(source) {
  const title = clip(source?.title, 80);
  if (title.length > 0) return title;
  const cwd = typeof source?.cwd === "string" ? source.cwd : "";
  // Both separators: the host process may be Windows even when the sessions
  // were created elsewhere, and the page's own name derivation reads either.
  const base = cwd.split(/[\\/]/).filter((part) => part.length > 0).pop() ?? "";
  if (base.length > 0) return base;
  const id = typeof source?.id === "string" ? source.id : "";
  return id.length > 0 ? id.slice(0, 8) : "unknown";
}