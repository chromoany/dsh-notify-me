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

import { bindHostOf, createCredentialReader, deliverNote, gateRequest, readBody, respond } from "./page-bridge.js";

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
 * verbatim. Whitespace inside the braces is allowed.
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
 * it documents. The template must render to a JSON object; anything else is
 * reported instead of sending a body the gateway cannot parse.
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
  if (bodyTemplate.length > MAX_BODY_TEMPLATE_BYTES) {
    return { ok: false, reason: "template-too-large" };
  }
  let parsed;
  try {
    parsed = JSON.parse(renderBodyTemplate(bodyTemplate, payload));
  } catch {
    return { ok: false, reason: "invalid-body-template" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "invalid-body-template" };
  }
  return { ok: true, body: parsed };
}

/**
 * Build the route handler.
 * @param config - the resolved `relay` section.
 * @param credentials - credential reader for the gateway.
 * @param shared - `{ version, bindHost }` from lib/index.js.
 * @param logger - cordis logger.
 * @returns the web-server route handler.
 */
function createHandler(config, credentials, shared, logger) {
  const delivery = { target: config.target, headers: config.headers, credentials, logger };

  return function handleRelay(req, res) {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && method !== "POST") {
      respond(res, 405, { ok: false, reason: "method-not-allowed" });
      return;
    }
    // The gate covers every verb, the read-only probe included: the path of
    // this route is a capability, so an ungated probe would tell anyone who
    // guessed it that the guess was right. The allow-list is the one shared by
    // the bridge route and the health probe — one list of public names, not one
    // per route.
    const refusal = gateRequest(req, { bindHost: shared?.bindHost, allowedOrigins: shared?.allowedOrigins });
    if (refusal !== null) {
      respond(res, 403, { ok: false, reason: refusal });
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
 */
export function mountRelay(ctx, config, shared) {
  // Nothing is registered without a path that can be an exact route and a
  // reachable gateway: a half-configured relay would answer 502 on every POST,
  // which is harder to diagnose than no route at all.
  if (typeof config.path !== "string" || !config.path.startsWith("/")) {
    ctx.logger?.warn?.("dsh-notify-me: relay.enabled is true but relay.path is not an absolute path, nothing registered");
    return;
  }
  if (typeof config.target !== "string" || config.target.length === 0) {
    ctx.logger?.warn?.("dsh-notify-me: relay.enabled is true but no relay.target and no gateway.target, nothing registered");
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
          handler: createHandler(config, credentials, shared, ctx.logger),
        }),
      "dsh-notify-me: same-origin relay route",
    );
    ctx.logger?.info?.(`dsh-notify-me: relay route registered at ${config.path}`);
  });
}