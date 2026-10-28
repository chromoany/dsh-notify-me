/**
 * dsh-notify-me — host half.
 *
 * The browser half (lib/client.js) raises the window when a notification is
 * clicked. In a browser tab `window.focus()` is all that exists; inside the
 * desktop shell it is not enough, because the shell exposes no focus IPC and
 * Chromium only honours `window.focus()` for a window the OS already treats as
 * foreground. This module therefore owns one loopback route on the host web
 * server: on Windows the notification click posts to it and the host activates
 * the Electron window through Win32 (lib/focus-window.ps1) from the process
 * that is allowed to do so. Every other desktop never posts here — its page
 * fires the shell's own `dsh://open` deep link instead, and this route answers
 * 501.
 *
 * The route is reachable from the desktop page because the shell forwards every
 * non-static `dsh-app://app` path verbatim to the host web server, host cookie
 * attached — so a plain same-origin relative `fetch` behaves exactly as it does
 * in a browser tab.
 *
 * Two optional patch modules hang off the same entry (`hostFallback`,
 * `relay`), both off by default:
 *
 *   - lib/host-fallback.js pushes "needs you" / "reply finished" from the
 *     host's session feed, so alerts still arrive when no page is open;
 *   - lib/relay.js lets the page reach an authenticated gateway that the
 *     browser cannot talk to.
 *
 * The page and the host must agree on who delivers, so this module also owns
 * the small page-bridge route through which the page renews its online lease.
 * With both modules disabled — the default, and what a bare install gets — no
 * extra route is registered, nothing is subscribed to, and the only route is
 * {@link FOCUS_ROUTE}, exactly as before they existed.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BRIDGE_HEADER,
  BRIDGE_HEADER_VALUE,
  BRIDGE_ROUTE,
  bindHostOf,
  createPresence,
  gateRequest,
  pickLanguage,
  readBody,
  respond,
} from "./page-bridge.js";
import { mountHostFallback } from "./host-fallback.js";
import { mountRelay } from "./relay.js";

/** Route that carries "bring the desktop window to the front". */
export const FOCUS_ROUTE = "/__dsh-notify-me/focus-window";

/**
 * Request header proving the caller is page code, sent by the notification
 * click. It is an intent marker, not the security boundary: a DNS-rebinding
 * page is same-origin with the address it resolved, so it can send any custom
 * header without a CORS preflight. The gate is {@link gateRequest}.
 */
const RAISE_HEADER = "x-dsh-notify-me-focus";

/** Marker value the page sends in {@link RAISE_HEADER}. */
const RAISE_HEADER_VALUE = "focus";

/** Activation script, resolved next to this module. */
const SCRIPT_URL = new URL("./focus-window.ps1", import.meta.url);

/** An activation that has not answered by then is abandoned; the user moved on. */
const RAISE_TIMEOUT_MS = 8000;

/** Two clicks inside this window share one activation instead of flashing twice. */
const RAISE_COALESCE_MS = 400;

/** Longest script output retained for the diagnostic line. */
const OUTPUT_LIMIT = 4096;

/** A heartbeat carrying more than this is a mistake, not a lease renewal. */
const BRIDGE_BODY_LIMIT = 16 * 1024;

/** Plugin identity for cordis.yml rows. */
export const name = "dsh-notify-me";

/**
 * Package version, reported by the status and health probes so a running host
 * can be proven to serve the build it claims to: a stale cached module and a
 * hot-reloaded one answer the same shapes, and only the version tells them
 * apart.
 */
export const VERSION = packageVersion();

/**
 * Defaults for every config key this entry reads.
 *
 * They are repeated from the bundled cordis.patch.yml on purpose. A profile
 * patch layer replaces an entry's `config` wholesale instead of deep-merging
 * it, so a profile that only wants `hostFallback.enabled: true` wipes the
 * gateway and relay blocks the YAML shipped. Normalizing here — from the same
 * values — is what keeps such a minimal override working instead of quietly
 * losing the gateway target.
 */
const DEFAULTS = {
  allowedOrigins: [],
  gateway: { target: "", credentialsFile: "", headers: {} },
  hostFallback: {
    enabled: false,
    target: "",
    credentialsFile: "",
    headers: null,
    events: ["turn/end", "approval/asked"],
    includeSubagents: false,
    turnEndThrottleMs: 15000,
    titlePrefix: "DSH",
    language: "auto",
    pageLeaseMs: 60000,
    healthPath: "/__dsh-notify-me/host-fallback",
  },
  relay: {
    enabled: false,
    path: "",
    target: "",
    credentialsFile: "",
    headers: null,
  },
};

/**
 * @returns the version from the package manifest, or `"0.0.0"` when the
 *   manifest is not next to this module (a copied file, a broken pack).
 */
function packageVersion() {
  try {
    const parsed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * @param value - any config value.
 * @returns it as a plain object, or an empty object for anything else.
 */
function section(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * @param value - any config value.
 * @param fallback - value to use when it is not a non-empty string.
 * @returns the trimmed string.
 */
function text(value, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * @param value - any config value.
 * @param fallback - value to use when it is not a finite, non-negative number.
 * @returns the number.
 */
function count(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * @param value - any config value.
 * @param fallback - value to use when it is not an object of string values.
 * @returns the header bag, with every non-string entry dropped.
 */
function headerBag(value, fallback) {
  const source = section(value);
  const headers = {};
  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry === "string" && entry.length > 0) headers[key] = entry;
  }
  return Object.keys(headers).length > 0 ? headers : fallback;
}

/**
 * @param value - any config value.
 * @param fallback - value to use when the list is empty or unusable.
 * @returns the non-empty strings it contains.
 */
function stringList(value, fallback) {
  const list = Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.length > 0) : [];
  return list.length > 0 ? list : fallback;
}

/**
 * Paths this plugin registers itself, and therefore cannot hand to a module.
 *
 * Registering two routes on the same `(kind, path)` throws inside the web
 * server, and a throw while mounting takes the whole plugin down with it —
 * including {@link FOCUS_ROUTE}, which is what a notification click depends on.
 * A configured path that collides is dropped with a warning instead.
 */
const RESERVED_PATHS = new Set([FOCUS_ROUTE, BRIDGE_ROUTE]);

/**
 * @param label - the config key being read, for the warning.
 * @param value - the configured path.
 * @param logger - cordis logger.
 * @returns the path, or an empty string when it collides with a fixed route.
 */
function freePath(label, value, logger) {
  if (value.length === 0 || !RESERVED_PATHS.has(value)) return value;
  logger?.warn?.(`dsh-notify-me: ${label} "${value}" is a route this plugin already registers, that route is left unregistered`);
  return "";
}

/**
 * Resolve the loader entry's config into the shape every route and module
 * reads.
 *
 * Everything is validated here rather than at the point of use: a value that
 * cannot work (a path that is not a path, a lease of `NaN`) falls back to the
 * default, and a gateway target left empty simply leaves its consumer
 * unregistered. Callers therefore never have to re-check types, and a
 * half-written profile override degrades to the shipped defaults instead of
 * throwing inside an event handler.
 *
 * Almost nothing is logged here: a value of the wrong type is a defaulted
 * value, not an incident, and a warning per key on every boot would train the
 * operator to ignore the logger. The exceptions are the conditions the caller
 * could not otherwise see — a module enabled without a target, a route path
 * that collides with a fixed one — and those are reported by whoever cannot act
 * on them.
 * @param config - the raw loader-entry config, or `undefined` for a bare entry.
 * @param logger - cordis logger, for the collision warning.
 * @returns the normalized sections plus the derived `features` list.
 */
function normalizeConfig(config, logger) {
  const raw = section(config);
  const gateway = section(raw.gateway);
  const hostFallback = section(raw.hostFallback);
  const relay = section(raw.relay);

  const gatewayTarget = text(gateway.target, DEFAULTS.gateway.target);
  const gatewayCredentials = text(gateway.credentialsFile, DEFAULTS.gateway.credentialsFile);
  const gatewayHeaders = headerBag(gateway.headers, {});
  const language = hostFallback.language;
  // One key for one concept, shared by all three gated routes. Behind a tunnel
  // or reverse proxy the `Host` a request carries is the *public* name, so this
  // list is both the `Origin` allow-list and the source of the public host
  // names the gate accepts — which is why it is not nested under whichever
  // module a deployment happens to enable.
  const allowedOrigins = stringList(raw.allowedOrigins, DEFAULTS.allowedOrigins);

  const host = {
    enabled: hostFallback.enabled === true,
    target: text(hostFallback.target, gatewayTarget),
    credentialsFile: text(hostFallback.credentialsFile, gatewayCredentials),
    // Not documented as its own key: a host alert goes to the same gateway the
    // page's relay does, so it inherits that gateway's headers unless the
    // section overrides them.
    headers: headerBag(hostFallback.headers, gatewayHeaders),
    events: stringList(hostFallback.events, DEFAULTS.hostFallback.events),
    includeSubagents: hostFallback.includeSubagents === true,
    turnEndThrottleMs: count(hostFallback.turnEndThrottleMs, DEFAULTS.hostFallback.turnEndThrottleMs),
    titlePrefix: text(hostFallback.titlePrefix, DEFAULTS.hostFallback.titlePrefix),
    language: language === "zh" || language === "en" ? language : DEFAULTS.hostFallback.language,
    pageLeaseMs: count(hostFallback.pageLeaseMs, DEFAULTS.hostFallback.pageLeaseMs),
    healthPath: text(hostFallback.healthPath, DEFAULTS.hostFallback.healthPath),
  };

  const relayConfig = {
    enabled: relay.enabled === true,
    path: text(relay.path, DEFAULTS.relay.path),
    target: text(relay.target, gatewayTarget),
    credentialsFile: text(relay.credentialsFile, gatewayCredentials),
    headers: headerBag(relay.headers, gatewayHeaders),
  };

  const features = ["page-bridge"];
  if (host.enabled) features.push("host-fallback");
  if (relayConfig.enabled) features.push("relay");

  host.healthPath = freePath("hostFallback.healthPath", host.healthPath, logger);
  relayConfig.path = freePath("relay.path", relayConfig.path, logger);

  return { hostFallback: host, relay: relayConfig, allowedOrigins, features };
}

/**
 * True when this host process runs on the Windows Electron binary, i.e. inside
 * the desktop shell whose window this route can activate through Win32. Other
 * desktop platforms raise through the page's `dsh://open` deep link instead and
 * never reach this route. `process.versions.electron` is the only trustworthy
 * signal: the shell also exports `ELECTRON_RUN_AS_NODE=1` into the host's
 * environment, and every child of the host inherits it, so keying on the
 * variable reports "desktop" from a plain Node test process.
 * @returns whether native window activation is worth attempting here.
 */
function isDesktopHost() {
  if (process.platform !== "win32") return false;
  return typeof process.versions.electron === "string";
}

/**
 * Stand-in script for the smoke tests; also the only way to force the desktop
 * path on from a plain Node process.
 * @returns the override path, or `undefined` when unset.
 */
function scriptOverride() {
  const override = process.env.DSH_NOTIFY_ME_FOCUS_SCRIPT;
  return typeof override === "string" && override.length > 0 ? override : undefined;
}

/**
 * @returns whether a POST to {@link FOCUS_ROUTE} can do anything.
 */
function focusAvailable() {
  return isDesktopHost() || scriptOverride() !== undefined;
}

/**
 * @returns the PowerShell script that performs the activation.
 */
function focusScriptPath() {
  return scriptOverride() ?? fileURLToPath(SCRIPT_URL);
}

/**
 * Where `powershell.exe` lives. The shell hands the host a PATH that appends its
 * own launcher directory in front of the inherited one, so a named lookup would
 * normally do; the absolute path just keeps a curated PATH from breaking raising.
 * @returns the interpreter to spawn.
 */
function powershellPath() {
  const root = process.env.SystemRoot;
  const candidate = `${typeof root === "string" && root.length > 0 ? root : "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  return existsSync(candidate) ? candidate : "powershell.exe";
}

/**
 * @returns the process whose window is activated: the Electron shell by
 *   default (the host is its direct child), or an explicit test stand-in.
 */
function focusTargetPid() {
  const override = Number.parseInt(process.env.DSH_NOTIFY_ME_FOCUS_PID ?? "", 10);
  return Number.isInteger(override) && override >= 0 ? override : process.ppid;
}

/**
 * Last `FOCUSED=<0|1>` line the script printed.
 * @param output - captured stdout.
 * @returns 1, 0, or `undefined` when the script printed no verdict.
 */
function lastVerdict(output) {
  const matches = output.match(/^FOCUSED=([01])$/gm);
  if (matches === null || matches.length === 0) return undefined;
  return Number.parseInt(matches[matches.length - 1].slice("FOCUSED=".length), 10);
}

/**
 * Most informative `DETAIL:` / `DETAIL=` line the script printed. The last one
 * is the elapsed-time line, which says nothing a caller cares about, so it is
 * skipped: what remains is either where activation succeeded or why it did not.
 * @param output - captured stdout.
 * @returns the diagnostic text (bounded), or `null`.
 */
function detailLine(output) {
  const matches = output.match(/^DETAIL[:=][ \t]*(.+)$/gm);
  if (matches === null) return null;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const text = matches[index].replace(/^DETAIL[:=][ \t]*/, "").trim();
    if (text.length > 0 && !text.startsWith("elapsed_ms=")) return text.slice(0, 200);
  }
  return null;
}

/**
 * Run the activation script once.
 * @returns a result carrying `focused` and a short `detail` tag.
 */
function runFocusScript() {
  return new Promise((resolve) => {
    let output = "";
    let timer;
    let settled = false;
    /** Resolve exactly once and drop the watchdog. */
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };

    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      focusScriptPath(),
      "-ProcessId",
      String(focusTargetPid()),
    ];

    let child;
    try {
      child = spawn(powershellPath(), args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      settle({ focused: false, detail: "spawn-failed: " + String(error?.message ?? error) });
      return;
    }

    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      settle({ focused: false, detail: "timeout" });
    }, RAISE_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (output.length < OUTPUT_LIMIT) output += chunk;
    });
    child.stderr.on("data", () => {});
    child.on("error", (error) => {
      settle({ focused: false, detail: "spawn-error: " + String(error?.message ?? error) });
    });
    child.on("close", (code) => {
      const verdict = lastVerdict(output);
      settle({
        focused: verdict === 1,
        detail: detailLine(output) ?? (verdict === undefined ? "no-verdict" : null),
        exitCode: code ?? null,
      });
    });
  });
}

let pendingRaise = null;
let lastRaiseAt = 0;

/**
 * Bring the desktop window to the front, coalescing rapid clicks.
 * @returns a result carrying `focused` and a short `detail` tag.
 */
function raiseWindow() {
  if (pendingRaise !== null) return pendingRaise;
  const now = Date.now();
  if (now - lastRaiseAt < RAISE_COALESCE_MS) return Promise.resolve({ focused: false, detail: "coalesced" });
  lastRaiseAt = now;
  pendingRaise = runFocusScript().finally(() => {
    pendingRaise = null;
  });
  return pendingRaise;
}

/**
 * Build the focus-route handler. The GET form is a probe the page may use to
 * find out whether activation is available at all; only the POST form touches
 * the OS.
 * @param bindHost - the listener's configured bind address, when known.
 * @returns the web-server route handler.
 */
function createHandler(bindHost) {
  return function handleFocus(req, res) {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && method !== "POST") {
      respond(res, 405, { ok: false, reason: "method-not-allowed" });
      return;
    }
    const refusal = gateRequest(req, { bindHost });
    if (refusal !== null) {
      respond(res, 403, { ok: false, reason: refusal });
      return;
    }
    if (method === "GET" || method === "HEAD") {
      respond(res, 200, {
        ok: true,
        route: FOCUS_ROUTE,
        enabled: focusAvailable(),
        desktop: isDesktopHost(),
        platform: process.platform,
      });
      return;
    }
    if (!focusAvailable()) {
      respond(res, 501, { ok: false, reason: "unsupported-host", platform: process.platform });
      return;
    }
    if (req.headers[RAISE_HEADER] !== RAISE_HEADER_VALUE) {
      respond(res, 403, { ok: false, reason: "forbidden" });
      return;
    }
    req.resume();
    raiseWindow().then(
      (result) => {
        respond(res, result.focused ? 200 : 202, {
          ok: true,
          focused: result.focused === true,
          platform: process.platform,
          detail: result.detail ?? null,
        });
      },
      () => {
        respond(res, 202, { ok: true, focused: false, platform: process.platform, detail: "error" });
      },
    );
  };
}

/**
 * The host part of an absolute URL, lowercased, without userinfo or port.
 *
 * Used only to publish *which* gateway the relay forwards to, so the page can
 * recognise a target that names that same gateway. Deliberately not `new
 * URL()`: this also runs where a malformed value would throw and take the
 * whole status reply down with it.
 * @param value - a configured URL.
 * @returns the bare hostname, or `""` when there is none.
 */
function hostOf(value) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(value ?? ""));
  if (!m) return "";
  return m[1].split("@").pop().split(":")[0].toLowerCase();
}

/**
 * What the page needs to know before it decides how to behave.
 *
 * The page uses this both as a liveness probe and as its feature discovery: it
 * only starts heartbeating when `hostFallback.enabled` is true, and it only
 * offers the relay URL in its settings when `relay.path` is present. Reporting
 * `features` and the package `version` alongside is what lets an operator
 * confirm from a terminal that the running host is the build they installed.
 * @param state - normalized config.
 * @param shared - `{ version, presence }`.
 * @returns the GET body.
 */
function bridgeStatus(state, shared) {
  const page = shared.presence.snapshot();
  return {
    ok: true,
    version: shared.version,
    features: state.features,
    hostFallback: { enabled: state.hostFallback.enabled, leaseMs: state.hostFallback.pageLeaseMs },
    relay: {
      enabled: state.relay.enabled,
      path: state.relay.enabled ? state.relay.path : null,
      // The gateway the relay forwards to, published only as its host. The page
      // needs it to recognise a target that names that same gateway: such a
      // request can never succeed from the browser (Basic auth means a
      // preflight the gateway answers without CORS headers, and the opaque
      // fallback is a cross-site POST the gateway refuses), so the page folds
      // it onto the relay route instead of reporting an unconfirmable delivery.
      // The host is not a secret; the credential and the path token stay out.
      upstreamHost: state.relay.enabled ? hostOf(state.relay.target) : null,
    },
    language: pickLanguage(state.hostFallback.language, page.language),
    page: { alive: page.alive, ageMs: page.ageMs },
  };
}

/**
 * Build the page-bridge handler: a read-only status GET and the heartbeat POST
 * that renews the page's online lease.
 *
 * The POST carries no payload the host trusts for anything but coordination —
 * it cannot name a session, a target or a credential — so the gate plus the
 * intent header is the whole authorization story. That is also why the POST
 * takes no further action than moving the lease: a route reachable by any web
 * page that guesses its name must not be able to do more than make the host
 * believe a page is open.
 * @param state - normalized config.
 * @param shared - `{ version, bindHost, presence }`.
 * @returns the web-server route handler.
 */
function createBridgeHandler(state, shared) {
  return function handleBridge(req, res) {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && method !== "POST") {
      respond(res, 405, { ok: false, reason: "method-not-allowed" });
      return;
    }
    const refusal = gateRequest(req, { bindHost: shared.bindHost, allowedOrigins: shared.allowedOrigins });
    if (refusal !== null) {
      respond(res, 403, { ok: false, reason: refusal });
      return;
    }
    if (method === "GET" || method === "HEAD") {
      respond(res, 200, bridgeStatus(state, shared));
      return;
    }
    if (req.headers[BRIDGE_HEADER] !== BRIDGE_HEADER_VALUE) {
      respond(res, 403, { ok: false, reason: "forbidden" });
      return;
    }

    void readBody(req, BRIDGE_BODY_LIMIT).then((body) => {
      if (body.ok === false) {
        respond(res, body.reason === "body-too-large" ? 413 : 400, {
          ok: false,
          reason: body.reason === "body-too-large" ? "body-too-large" : "invalid-json",
        });
        return;
      }
      // Every heartbeat field is optional, so an empty body is a legitimate
      // bare "I am here" — and it is what a `keepalive` beacon on pagehide
      // degrades to if its body is dropped.
      const raw = body.text.trim();
      let beat = {};
      if (raw.length > 0) {
        try {
          beat = JSON.parse(raw);
        } catch {
          respond(res, 400, { ok: false, reason: "invalid-json" });
          return;
        }
      }
      if (beat === null || typeof beat !== "object" || Array.isArray(beat)) {
        respond(res, 400, { ok: false, reason: "invalid-json" });
        return;
      }
      respond(res, 200, { ok: true, leaseUntil: shared.presence.touch(beat) });
    }).catch(() => {
      // A client that hung up mid-body leaves nothing to answer; failing to
      // write the reply again here would surface as an unhandled rejection in
      // the host process, which is worse than a lost heartbeat.
    });
  };
}

/**
 * Host loader entry.
 *
 * With neither patch module enabled — the default — this registers exactly one
 * route and subscribes to nothing, which is what makes the new capabilities
 * opt-in: an existing install behaves, and behaves identically, after the
 * upgrade. With either module enabled it adds the page-bridge route (the page
 * cannot coordinate with a host it cannot reach) and mounts the module.
 * @param ctx - host cordis context.
 * @param config - loader-entry config; see the bundled cordis.patch.yml. Every
 *   key has a default here as well, because a profile override replaces the
 *   whole `config` object instead of merging into it.
 */
export function apply(ctx, config) {
  const state = normalizeConfig(config, ctx.logger);
  const bridgeEnabled = state.hostFallback.enabled || state.relay.enabled;
  const shared = {
    version: VERSION,
    bindHost: undefined,
    allowedOrigins: state.allowedOrigins,
    presence: createPresence({ leaseMs: state.hostFallback.pageLeaseMs }),
  };

  if (state.hostFallback.enabled) mountHostFallback(ctx, state.hostFallback, shared);
  if (state.relay.enabled) mountRelay(ctx, state.relay, shared);

  ctx.inject(["webServer"], (webCtx) => {
    // The listener may be bound to one concrete LAN interface; read it so the
    // gate can accept the self-addressed request the shell makes in that setup.
    // The bridge and relay handlers read it from `shared` at request time, so
    // one read serves every route that was mounted before this callback ran.
    shared.bindHost = bindHostOf(webCtx.webServer);

    webCtx.effect(
      () => webCtx.webServer.register({ kind: "exact", path: FOCUS_ROUTE, handler: createHandler(shared.bindHost) }),
      "dsh-notify-me: window focus route",
    );

    if (bridgeEnabled) {
      webCtx.effect(
        () => webCtx.webServer.register({ kind: "exact", path: BRIDGE_ROUTE, handler: createBridgeHandler(state, shared) }),
        "dsh-notify-me: page bridge route",
      );
    }
  });
}