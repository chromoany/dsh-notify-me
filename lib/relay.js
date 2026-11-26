/**
 * dsh-notify-me — same-origin relay to an authenticated notification gateway.
 *
 * The page pushes to its external targets with `fetch` from the browser, and a
 * gateway behind Basic auth is unreachable from there: credentials in the URL
 * make `fetch` throw before a byte leaves, an `Authorization` header turns the
 * request into a preflighted one that Apprise answers without any
 * `Access-Control-Allow-*`, and the opaque `no-cors` fallback cannot carry the
 * header at all. The page then reports "unverified" and nothing is delivered.
 *
 * This route is served by the same origin as the page, so none of that
 * applies: the page posts plain JSON here, the host attaches the credentials
 * server-side and answers with the gateway's real status, which is what turns
 * the page's delivery verdict from "unverified" into "sent".
 *
 * The forwarded body is the Apprise `{ title, body, type }` shape by default.
 * For gateways with their own schema (an own push service, a MagicPush-style
 * REST API) `relay.bodyTemplate` overrides it with a JSON template rendered
 * from the event's fields; see {@link toGatewayPayload}.
 *
 * Security posture: the route path is a capability (recommended to contain a
 * random token) and the gateway credential lives in a mode-0600 file the host
 * reads — never in the page, never in the patch layer, never in a reply. GET is
 * a read-only probe and only POST forwards anything upstream; both verbs sit
 * behind the shared request gate, so a cross-site or rebinding caller is
 * refused even if it learns the path. POST additionally needs the intent header
 * {@link RELAY_HEADER}, which a cross-site form post cannot set.
 */

import { bindHostOf, createCredentialReader, deliverNote, guardRequest, isLocalRequest, readBody, respond } from "./page-bridge.js";

/** Reject oversized bodies instead of buffering them. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Intent header a relay POST has to carry.
 *
 * The gate is the security boundary; this is the layer that keeps a request
 * which was never meant as a relay post from reaching the gateway. A cross-site
 * `text/plain` post is a CORS-simple request and needs no preflight, but it
 * cannot set this header without one — and Apprise answers a preflight with no
 * `Access-Control-Allow-*`, so the browser cancels the real request. Same role
 * as `x-dsh-notify-me-page` on the bridge route.
 */
export const RELAY_HEADER = "x-dsh-notify-me-relay";

/** Marker value {@link RELAY_HEADER} must carry. */
export const RELAY_HEADER_VALUE = "relay";

/** Longest upstream response quoted back to the page for its own diagnostics. */
const UPSTREAM_BODY_LIMIT = 500;

/** Longest `bodyTemplate` accepted; a template bigger than this is a mistake. */
const MAX_BODY_TEMPLATE_BYTES = 16 * 1024;

/**
 * Longest body a `bodyTemplate` may render to.
 *
 * The template cap bounds the template, not the request: a template may repeat
 * `{{text}}`, so a 64 KiB event can render to several times its own size. The
 * rendered body is what reaches the gateway, so it is bounded on its own.
 */
const MAX_RENDERED_BODY_BYTES = 256 * 1024;

/**
 * Forwards one client may make per {@link RATE_WINDOW_MS}.
 *
 * The gate already refuses every caller that is not this machine's own page, so
 * this is not an authentication limit: it covers the one case the gate cannot,
 * a page that was injected into or driven in a loop. Every request that gets
 * past the gate becomes a real notification on a real gateway, which is an
 * external service with its own quota, so the route stops forwarding instead of
 * relaying the flood. The page posts once per event and retries with backoff, so
 * a normal page never comes close.
 */
const RATE_LIMIT = 60;

/** Window {@link RATE_LIMIT} counts over. */
const RATE_WINDOW_MS = 60 * 1000;

/**
 * Buckets the throttle keeps.
 *
 * One per socket address, so the table has a ceiling on a long-lived host: an
 * address that has not been seen for a window is the one that can go.
 */
const RATE_BUCKETS = 64;

/**
 * Payload a `bodyTemplate` is dry-run with at boot.
 *
 * Short ASCII values are enough for the only question asked there: does the
 * template render to a JSON object at all? Whether the event's real values can
 * make the body too large is a per-request question, answered in
 * {@link toGatewayPayload}.
 */
const TEMPLATE_PROBE = Object.freeze({
  title: "x",
  body: "x",
  text: "x",
  event: "x",
  time: "x",
  sessionId: "x",
  source: "x",
  version: "x",
});

/**
 * Escape one placeholder value for embedding inside a JSON string literal.
 *
 * A template is JSON text, and the event's title/body are user content: a quote
 * or a newline copied in raw would turn the rendered template into malformed
 * JSON. Quoting through `JSON.stringify` and dropping the outer quotes is the
 * exact inverse of the unescape a JSON parser applies.
 * @param value - the placeholder value.
 * @returns it ready to sit between two JSON quotes.
 */
function escapeJsonStringValue(value) {
  return JSON.stringify(value === undefined || value === null ? "" : String(value)).slice(1, -1);
}

/**
 * Render a JSON `bodyTemplate` with the event's fields.
 *
 * Supported placeholders: `{{title}}` `{{body}}` `{{text}}` `{{event}}`
 * `{{time}}` `{{session}}` `{{source}}` `{{version}}`. `{{session}}` reads
 * `sessionId` because that is the field the page sends; the others are used
 * verbatim. Whitespace inside the braces is allowed; a field the event does not
 * carry renders as the empty string. Only placeholders inside JSON string
 * literals make sense: anywhere else the substitution produces invalid JSON,
 * which is reported rather than forwarded.
 * @param template - the configured JSON template.
 * @param payload - parsed request body.
 * @returns the rendered JSON text.
 */
function renderBodyTemplate(template, payload) {
  return template.replace(
    /\{\{\s*(title|body|text|event|time|session|source|version)\s*\}\}/g,
    (_match, key) => escapeJsonStringValue(key === "session" ? payload.sessionId : payload[key]),
  );
}

/**
 * Check that a configured `bodyTemplate` can render to a JSON object.
 *
 * Asked twice, both before any alert: once while the config is normalized (so
 * the status reply does not promise a relay that cannot mount) and once while
 * the route is mounted (so the warning and the missing route land together).
 * A template that cannot work would answer 500 on every alert, which is worse
 * than no route at all.
 * @param template - the configured template; empty means "not configured".
 * @returns `null` when usable, otherwise the failure reason.
 */
export function bodyTemplateProblem(template) {
  if (typeof template !== "string" || template.length === 0) return null;
  if (Buffer.byteLength(template, "utf8") > MAX_BODY_TEMPLATE_BYTES) return "template-too-large";
  let parsed;
  try {
    parsed = JSON.parse(renderBodyTemplate(template, TEMPLATE_PROBE));
  } catch {
    return "invalid-body-template";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "invalid-body-template";
  return null;
}

/**
 * Map the page's event payload onto the gateway's notify schema.
 *
 * The page sends `source / version / event / title / body / text / sessionId /
 * time`; Apprise accepts `title / body / type`. `tag` is deliberately dropped:
 * Apprise treats a tag as a service filter, so an unmatched tag turns the
 * delivery into 424 "nothing could be sent" — the notify key's own
 * configuration decides the destinations, not the payload.
 *
 * A configured `bodyTemplate` replaces that fixed shape: a gateway with its own
 * schema (an own push service, a MagicPush-style API, …) gets exactly the fields
 * it documents. The template must render to a JSON object no larger than
 * {@link MAX_RENDERED_BODY_BYTES}; anything else is reported instead of sending
 * a body the gateway cannot parse.
 * @param payload - parsed request body.
 * @param bodyTemplate - optional JSON template from `relay.bodyTemplate`.
 * @returns `{ ok: true, body }` with the JSON body to forward, or
 *   `{ ok: false, reason }` when the template cannot produce a JSON object.
 */
function toGatewayPayload(payload, bodyTemplate) {
  if (typeof bodyTemplate !== "string" || bodyTemplate.length === 0) {
    const title = typeof payload.title === "string" && payload.title.length > 0 ? payload.title : "DSH";
    const body =
      typeof payload.body === "string" && payload.body.length > 0
        ? payload.body
        : typeof payload.text === "string"
          ? payload.text
          : "";
    return { ok: true, body: { title, body, type: "info" } };
  }
  if (Buffer.byteLength(bodyTemplate, "utf8") > MAX_BODY_TEMPLATE_BYTES) {
    return { ok: false, reason: "template-too-large" };
  }
  const rendered = renderBodyTemplate(bodyTemplate, payload);
  if (Buffer.byteLength(rendered, "utf8") > MAX_RENDERED_BODY_BYTES) {
    return { ok: false, reason: "rendered-body-too-large" };
  }
  let parsed;
  try {
    parsed = JSON.parse(rendered);
  } catch {
    return { ok: false, reason: "invalid-body-template" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "invalid-body-template" };
  }
  return { ok: true, body: parsed };
}

/**
 * Complete a `done` payload the page could not caption.
 *
 * Hosts from `0.1.6` on carry no conversation text in `SessionSnapshot` (it
 * holds lifecycle and control state only), so a completion reaches the page as
 * the conversation label alone: `body` is one caption line and `text` is
 * "title + newline + label". The log is readable only by the host
 * (`ctx.sessionQuery`), so the last reply is filled in here, before the
 * template renders it.
 *
 * A page body that already carries a second line (an older host with a
 * snippet) is left untouched — the page's own caption is never overwritten.
 *
 * The filled-in text keeps its newlines: a markdown `##` heading or a `- ` list
 * item only reads as one from the line start, and collapsing them into one line
 * leaves nothing but inline text on the phone.
 * @param payload - the parsed page payload; `body` / `text` are modified in place.
 * @param readSnippet - the host's reader `(sessionId) => Promise<string>`.
 */
async function fillDoneSnippet(payload, readSnippet) {
  if (typeof readSnippet !== "function") return;
  if (payload.event !== "done") return;
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
  if (sessionId.length === 0) return;
  const body = typeof payload.body === "string" ? payload.body : "";
  if (body.includes("\n")) return;
  let snippet = "";
  try {
    snippet = await readSnippet(sessionId);
  } catch {
    return;
  }
  snippet = typeof snippet === "string" ? snippet.trim() : "";
  if (snippet.length === 0) return;
  payload.body = snippet;
  payload.text = (typeof payload.title === "string" ? payload.title : "") + "\n" + snippet;
}

/**
 * Build the per-client forward cap.
 *
 * Buckets are keyed by socket address (`127.0.0.1` for the page) and the oldest
 * is dropped once the table is full. Only a request that already passed the
 * gate is counted, so a refused cross-site caller cannot spend a real client's
 * budget — and a bucket is re-inserted after every counted request, because
 * `Map` keeps insertion order and `set` on an existing key would not make it
 * the most recently used.
 * @param logger - cordis logger, for the one line naming the throttling.
 * @returns `(req) => boolean`, `true` when the request may be forwarded.
 */
function createThrottle(logger) {
  const buckets = new Map();
  let warned = false;
  return function allowForward(req) {
    const address = typeof req?.socket?.remoteAddress === "string" ? req.socket.remoteAddress : "unknown";
    const now = Date.now();
    const recent = (buckets.get(address) || []).filter((stamp) => now - stamp < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      buckets.delete(address);
      buckets.set(address, recent);
      if (!warned) {
        warned = true;
        logger?.warn?.(`dsh-notify-me: relay is dropping forwards from ${address} at more than ${RATE_LIMIT} per minute, check the page for a loop`);
      }
      return false;
    }
    recent.push(now);
    buckets.delete(address);
    buckets.set(address, recent);
    if (buckets.size > RATE_BUCKETS) buckets.delete(buckets.keys().next().value);
    return true;
  };
}

/**
 * Build the route handler.
 * @param config - the resolved `relay` section.
 * @param credentials - credential reader for the gateway.
 * @param shared - `{ version, bindHost }` from lib/index.js.
 * @param logger - cordis logger.
 * @param readSnippet - the host's last-reply reader, for a completion the page
 *   could not caption.
 * @returns the web-server route handler.
 */
function createHandler(config, credentials, shared, logger, readSnippet) {
  const delivery = { target: config.target, headers: config.headers, credentials, logger };
  // One diagnostic line at most when a public-name request is refused the
  // caption: a tunnel serving the page is a legitimate deployment, only the
  // log read is not.
  let publicNameLogged = false;
  const allowForward = createThrottle(logger);

  return function handleRelay(req, res) {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && method !== "POST") {
      respond(res, 405, { ok: false, reason: "method-not-allowed" });
      return;
    }
    const guard = guardRequest(req, {
      bindHost: shared?.bindHost,
      allowedOrigins: shared?.allowedOrigins,
      connection: shared?.connection,
    });
    if (guard !== null) {
      respond(res, guard.status, { ok: false, reason: guard.reason });
      return;
    }
    if (method === "GET" || method === "HEAD") {
      respond(res, 200, { ok: true, route: config.path, version: shared?.version ?? null, enabled: true });
      return;
    }
    if (req.headers[RELAY_HEADER] !== RELAY_HEADER_VALUE) {
      respond(res, 403, { ok: false, reason: "missing-intent" });
      return;
    }
    // Counted here, after the gate and the intent header: only a request that
    // would actually reach the gateway spends the budget, and a page stuck in a
    // loop gets the answer before its body is even read.
    if (!allowForward(req)) {
      respond(res, 429, { ok: false, reason: "rate-limited" });
      return;
    }

    void readBody(req, MAX_BODY_BYTES).then(async (body) => {
      if (body.ok === false) {
        // A body that never arrived is the same answer as a bad one: there is
        // nothing to forward either way, and a client abort is not a gateway
        // problem, so it must not be reported as one.
        respond(res, body.reason === "body-too-large" ? 413 : 400, {
          ok: false,
          reason: body.reason === "body-too-large" ? "body-too-large" : "invalid-json",
        });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(body.text);
      } catch {
        respond(res, 400, { ok: false, reason: "invalid-json" });
        return;
      }
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        respond(res, 400, { ok: false, reason: "invalid-json" });
        return;
      }

      // Complete a `done` payload the page could not caption, before the
      // template renders it. Only for a request that arrived on a local name: a
      // request through a public name may forward what the page sent, but the
      // payload names the session and the path is a capability, so answering it
      // with a session's last reply would hand the conversation to whoever can
      // reach the relay.
      const local = isLocalRequest(req, { bindHost: shared?.bindHost });
      if (!local && typeof readSnippet === "function" && !publicNameLogged) {
        publicNameLogged = true;
        logger?.info?.("dsh-notify-me: relay completion captions stay off for requests arriving on a public name");
      }
      await fillDoneSnippet(payload, local ? readSnippet : undefined);
      const mapped = toGatewayPayload(payload, config.bodyTemplate);
      if (mapped.ok === false) {
        // A broken template is a configuration error that would fail on every
        // alert; report it instead of forwarding a body the gateway cannot read.
        respond(res, 500, { ok: false, reason: mapped.reason });
        return;
      }
      const result = await deliverNote(delivery, mapped.body);
      if (result.reason === "credentials-unavailable") {
        respond(res, 503, { ok: false, reason: "credentials-unavailable" });
        return;
      }
      if (result.reason === "upstream-error") {
        respond(res, 502, { ok: false, reason: "upstream-error", message: String(result.text).slice(0, 200) });
        return;
      }
      respond(res, result.ok ? 200 : 502, {
        ok: result.ok === true,
        upstreamStatus: result.status,
        upstreamBody: String(result.text).slice(0, UPSTREAM_BODY_LIMIT),
      });
    }).catch((error) => {
      // Reached only when writing the answer itself failed (a client that hung
      // up mid-body): answering again would throw inside this catch and leave a
      // rejected promise on a long-lived host process.
      logger?.warn?.(`dsh-notify-me: relay answer failed: ${error?.message ?? String(error)}`);
    });
  };
}

/**
 * Mount the relay route.
 *
 * Mounted by lib/index.js only when `relay.enabled` is true, so the default
 * composition registers no extra route at all.
 * @param ctx - host cordis context.
 * @param config - the resolved `relay` section (gateway defaults already merged
 *   in by the loader entry).
 * @param shared - `{ version, bindHost, allowedOrigins }` from lib/index.js;
 *   the bind address and the allow-list are read per request, so they are
 *   current even when this module mounted before the web server existed.
 * @param deps - `{ readSnippet }`: the host's last-reply reader, injected by
 *   lib/index.js so a completion the page could not caption still has a body.
 */
export function mountRelay(ctx, config, shared, deps = {}) {
  // Nothing is registered without a path that can be an exact route, a
  // reachable gateway, and a template that renders to a JSON object: a
  // half-configured relay would answer 502 or 500 on every POST, which is
  // harder to diagnose than no route at all.
  if (typeof config.path !== "string" || !config.path.startsWith("/")) {
    ctx.logger?.warn?.("dsh-notify-me: relay.enabled is true but relay.path is not an absolute path, nothing registered");
    return;
  }
  if (typeof config.target !== "string" || config.target.length === 0) {
    ctx.logger?.warn?.("dsh-notify-me: relay.enabled is true but no relay.target and no gateway.target, nothing registered");
    return;
  }
  const templateProblem = bodyTemplateProblem(config.bodyTemplate);
  if (templateProblem !== null) {
    ctx.logger?.warn?.(`dsh-notify-me: relay.bodyTemplate cannot be used (${templateProblem}), nothing registered`);
    return;
  }
  const credentials = createCredentialReader(config.credentialsFile, ctx.logger);

  ctx.inject(["webServer"], (webCtx) => {
    if (shared !== undefined && shared !== null && shared.bindHost === undefined) {
      shared.bindHost = bindHostOf(webCtx.webServer);
    }
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: "exact",
          path: config.path,
          handler: createHandler(config, credentials, shared, ctx.logger, deps.readSnippet),
        }),
      "dsh-notify-me: same-origin relay route",
    );
    ctx.logger?.info?.(`dsh-notify-me: relay route registered at ${config.path}`);
  });
}