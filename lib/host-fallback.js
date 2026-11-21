/**
 * dsh-notify-me — host-side fallback for the alerts the page cannot send.
 *
 * The plugin lives in the browser: its triggers, its timers and its external
 * forwarding all run inside the page's client runtime, so closing the tab (or
 * the whole window) stops every alert. That is the one hole the page cannot
 * close from inside, and this module closes it from the host's session event
 * feed: `turn/end` and `approval/asked` are delivered straight from the host
 * process, where the browser is irrelevant.
 *
 * Two delivery paths for the same events would send everything twice while a
 * page is open, so this module yields to the page's online lease
 * (lib/page-bridge.js `createPresence`): a fresh heartbeat means the page is
 * already sending, an expired or explicitly released lease means it is not.
 * The lease also carries the page's language, which is how this module ends up
 * speaking the language the user is reading. It carries the page's explicit
 * forward switches too (the master switch and the two per-kind ones): those are
 * values the user wrote into the config, and this module pushes to the very
 * endpoint they describe. A page that says "no external alerts" must silence
 * the fallback as well, or the switch only closes the page-side door and the
 * alert still arrives once the tab is closed. What it does not carry is the
 * page's delivery heuristics — visibility, idle, the current-session rule —
 * because those depend on a page the host cannot see.
 *
 * Noise control, all per session: subagent sessions are skipped by default,
 * `turn/end` is throttled, and repeated approvals are deduplicated by id. A
 * fallback that is louder than the page would be worse than no fallback.
 */

import {
  createCredentialReader,
  createPresence,
  copyFor,
  deliverNote,
  guardRequest,
  pickLanguage,
  sessionName,
  clip,
  respond,
} from "./page-bridge.js";

/** Probe answering "is this process pushing, and what did it push last". */
export const DEFAULT_HEALTH_PATH = "/__dsh-notify-me/host-fallback";

/** Events handled when the config names none. */
const DEFAULT_EVENTS = ["turn/end", "approval/asked"];

/** Window that collapses a burst of turns in one session into one alert. */
const DEFAULT_THROTTLE_MS = 15000;

/** Per-session caches are bounded so a long-lived host cannot grow forever. */
const CACHE_LIMIT = 500;

/** Approval reasons are quoted, not reproduced: the tool name is the signal. */
const APPROVAL_REASON_LIMIT = 120;

/**
 * Normalize the `turn/end` reason.
 *
 * The host appends `reason` as `{ kind: 'completed' | 'aborted' | 'blocked' |
 * 'error' | 'max-tokens' | 'interrupted' | 'forked', … }`, not as a string:
 * reading it as a string — as the standalone notify-host plugin did — is
 * always false and silently swallows every abnormal end. Older logs and
 * hand-written test events do carry a plain string, so both shapes are
 * accepted; only the kind is ever quoted.
 * @param reason - the raw `event.data.reason` value.
 * @returns the reason kind, or an empty string when there is none.
 */
function turnEndReason(reason) {
  if (typeof reason === "string") return reason;
  if (reason !== null && typeof reason === "object" && typeof reason.kind === "string") return reason.kind;
  return "";
}

/**
 * Remember one value in a bounded per-session cache.
 * @param cache - the Map to write to.
 * @param key - session id.
 * @param value - value to remember.
 */
function remember(cache, key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

/**
 * The durable goal phase a `goal/change` payload leaves behind.
 *
 * Every lifecycle operation (`create` / `pause` / `resume` / `block` /
 * `complete` / `clear`) writes the whole snapshot, so the payload is the phase
 * in force from that event onward. `edit` keeps the phase and a clear leaves a
 * tombstone (`{ cleared: true }`) instead of a snapshot, which is why null is
 * the answer for "no goal is current" rather than "unknown".
 * @param data - the event's `data`.
 * @returns the phase, or `null` when the session has no current goal.
 */
function goalPhaseOf(data) {
  if (data?.cleared === true) return null;
  const phase = data?.goal?.phase;
  return typeof phase === "string" ? phase : null;
}

/**
 * The goal phase a restarted host never saw written.
 *
 * A goal outlives the host process: the desktop can be reopened in the middle
 * of one, and the `goal/change` events that created it then only exist in the
 * session log. The last lifecycle change (`edit` aside) is the phase the round
 * driver resumes from, so the log is walked backwards once per session instead
 * of trusting an empty cache to mean "no goal".
 * @param session - the host session (`seq` is the next free sequence number).
 * @returns the phase, or `null` when the log holds no lifecycle change.
 */
function loggedGoalPhase(session) {
  const end = session?.seq;
  if (!Number.isSafeInteger(end) || typeof session.eventAt !== "function") return null;
  for (let seq = end - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(seq);
    if (event?.type !== "goal/change") continue;
    if (event.data?.operation === "edit") continue;
    return goalPhaseOf(event.data);
  }
  return null;
}

/**
 * Subscribe to the host's session feed and push the two fallback alerts.
 *
 * Mounted by lib/index.js only when `hostFallback.enabled` is true, so the
 * default composition subscribes to nothing at all.
 * @param ctx - host cordis context.
 * @param config - the resolved `hostFallback` section (gateway defaults already
 *   merged in by the loader entry).
 * @param shared - `{ version, presence, bindHost, allowedOrigins }`; `version`
 *   is reported by the probe, `presence` is the lease the page bridge renews,
 *   and the bind address / allow-list feed the gate the probe sits behind.
 *   Without a shared presence this module assumes no page can ever check in and
 *   always pushes.
 */
export function mountHostFallback(ctx, config, shared) {
  // A pusher with nowhere to push is not mounted at all: subscribing would
  // only fail every delivery, and a warn once is easier to act on than a
  // silent stream of gateway errors.
  if (typeof config.target !== "string" || config.target.length === 0) {
    ctx.logger?.warn?.("dsh-notify-me: hostFallback.enabled is true but no hostFallback.target and no gateway.target, nothing subscribed");
    return;
  }
  const events = new Set(Array.isArray(config.events) && config.events.length > 0 ? config.events : DEFAULT_EVENTS);
  const includeSubagents = config.includeSubagents === true;
  const throttleMs = Number.isFinite(config.turnEndThrottleMs) ? Math.max(0, config.turnEndThrottleMs) : DEFAULT_THROTTLE_MS;
  const prefix = typeof config.titlePrefix === "string" && config.titlePrefix.length > 0 ? config.titlePrefix : "DSH";
  const healthPath =
    typeof config.healthPath === "string" && config.healthPath.startsWith("/") ? config.healthPath : DEFAULT_HEALTH_PATH;
  const presence = shared?.presence ?? createPresence({ leaseMs: 0 });

  const credentials = createCredentialReader(config.credentialsFile, ctx.logger);
  const delivery = { target: config.target, headers: config.headers, credentials, logger: ctx.logger };

  /** Generated or user-set title per session, preferred over the cwd name. */
  const titles = new Map();
  /** Session id -> timestamp of the last `turn/end` push. */
  const lastTurnAt = new Map();
  /** Session id -> durable goal phase (`active`, `paused`, `blocked`, `complete`, null). */
  const goalPhases = new Map();
  /** Approval ids already alerted on, so a re-ask after a reload is not news. */
  const seenApprovals = new Set();

  /** Last delivery verdict, surfaced by the probe for live diagnosis. */
  let lastDelivery = null;

  const keyOf = (session) => String(session?.header?.id ?? "unknown");

  /**
   * The phase the session's goal is in right now.
   *
   * Cached per session after the first look, because the answer only changes
   * on a `goal/change` event this module also sees.
   * @param session - the host session.
   * @param key - its cache key.
   * @returns the phase, or `null` when no goal is current.
   */
  const goalPhase = (session, key) => {
    const known = goalPhases.get(key);
    if (known !== undefined) return known;
    const phase = loggedGoalPhase(session);
    remember(goalPhases, key, phase);
    return phase;
  };

  /**
   * @param session - the session the event belongs to.
   * @param key - its cache key.
   * @returns the name to use in an alert body.
   */
  const describe = (session, key) => sessionName({ title: titles.get(key), cwd: session?.header?.cwd, id: key });

  /**
   * @returns the wording for the language in force right now: the configured
   *   language when it is explicit, otherwise whatever the page last reported.
   */
  const copy = () => copyFor(pickLanguage(config.language, presence.snapshot().language));

  /**
   * Push one note and remember how it went.
   * @param note - `{ title, body, type }`.
   */
  const push = async (note) => {
    const result = await deliverNote(delivery, note);
    lastDelivery = { at: new Date().toISOString(), ok: result.ok === true, status: result.status };
    return result;
  };

  /**
   * Drop everything remembered about one session.
   * @param session - the disposed session.
   */
  const forget = (session) => {
    const key = keyOf(session);
    titles.delete(key);
    lastTurnAt.delete(key);
    goalPhases.delete(key);
  };

  /**
   * Handle one session event. Wrapped by the caller so a malformed event can
   * never take the host's event feed down with it.
   * @param session - the session the event belongs to.
   * @param event - `{ type, data }`.
   */
  const handle = (session, event) => {
    if (session?.header?.origin === "subagent" && !includeSubagents) return;
    const key = keyOf(session);
    const type = event?.type;
    // A session muted from the sidebar stays silent here too: the switch has to
    // survive the tab closing, otherwise the fallback fires exactly the alert
    // the user asked not to get. Titles are still remembered below, so lifting
    // the mute does not leave the session nameless.
    const quiet = presence.isMuted(key);

    if (type === "session/title") {
      const title = typeof event.data?.title === "string" ? event.data.title : "";
      if (title.length > 0) remember(titles, key, title);
      return;
    }
    if (type === "goal/change") {
      // Tracked even while the session is muted: muting silences alerts, it
      // does not change which goal is still running.
      remember(goalPhases, key, goalPhaseOf(event.data));
      return;
    }
    if (quiet) return;
    if (type === "approval/asked") {
      if (!events.has("approval/asked")) return;
      // The page's master switch or its 「需要你」 switch says this alert goes
      // nowhere outside the machine. Checked before the dedupe cache for the
      // same reason as the lease: an alert held back by a switch must not burn
      // the id, or turning the switch back on would never deliver that ask.
      if (!presence.externalAllowed("attention")) return;
      // An open page raised its own approval alert; pushing here would be the
      // second notification for one event. Checked before the dedupe cache, so
      // a skipped approval does not burn the id and the host can still report
      // a later ask for it.
      if (presence.isAlive()) return;
      const id = String(event.data?.id ?? "");
      if (id.length > 0) {
        if (seenApprovals.has(id)) return;
        seenApprovals.add(id);
        if (seenApprovals.size > CACHE_LIMIT) seenApprovals.delete(seenApprovals.values().next().value);
      }
      const words = copy();
      const tool = typeof event.data?.toolName === "string" && event.data.toolName.length > 0 ? event.data.toolName : "tool";
      const reason = clip(typeof event.data?.reason === "string" ? event.data.reason : "", APPROVAL_REASON_LIMIT);
      // Exactly what the page's toast says for an approval: the tool, then its
      // reason, joined by ` · ` inside the body — the tool alone ("pwsh") is
      // not a sentence anyone can act on.
      void push({
        title: `${prefix}${words.separator}${words.approval}`,
        body: `${describe(session, key)}${words.bodySeparator}${tool}${reason.length > 0 ? `${words.detailJoiner}${reason}` : ""}`,
        type: "warning",
      });
      return;
    }
    if (type === "turn/end") {
      if (!events.has("turn/end")) return;
      // Same gate as the approval branch, before the throttle so a turn held
      // back by a switch does not spend this session's window either.
      if (!presence.externalAllowed("done")) return;
      // The lease is checked before the throttle so a turn the page delivered
      // does not consume this session's window: the window exists to keep the
      // host's own alerts apart, and it is only spent when one is sent.
      if (presence.isAlive()) return;
      // A Goal turn is one round of a longer job, not an answer. The round
      // driver queues the next round as soon as the agent goes idle, and an
      // intermediate round usually writes no `goal/change` at all (the round
      // prompt tells the model to leave the goal active), so phase `active`
      // here means "more work is coming". Only the round that takes the goal
      // out of `active` (complete / blocked / paused) is news worth waking up
      // for — and it is exactly the round whose phase is no longer active.
      if (goalPhase(session, key) === "active") return;
      const now = Date.now();
      const reason = turnEndReason(event.data?.reason);
      // Only a normal finish is throttled. The window exists to keep a burst of
      // completed turns from becoming a burst of alerts; an abnormal end is
      // exactly the alert worth interrupting for, and it is rare by nature —
      // swallowing it because the previous turn finished 15 s ago loses the one
      // notification the user had to act on.
      if (reason === "completed" && now - (lastTurnAt.get(key) ?? 0) < throttleMs) return;
      lastTurnAt.set(key, now);

      const words = copy();
      // The page's "reply finished" toast is the session label and nothing
      // else; the only addition here is the parenthetical naming an abnormal
      // end, which is the one fact the page cannot show once it is closed.
      const suffix = reason.length > 0 && reason !== "completed" ? words.reason(reason) : "";
      void push({
        title: `${prefix}${words.separator}${words.done}`,
        body: `${describe(session, key)}${suffix}`,
        type: "info",
      });
    }
  };

  ctx.effect(
    () => {
      const offEvent = ctx.on("session/event", (session, event) => {
        try {
          handle(session, event);
        } catch (error) {
          ctx.logger?.warn?.(`dsh-notify-me: host fallback handler failed: ${error?.message ?? String(error)}`);
        }
      });
      // Disposal is a context event of its own, not a session log entry
      // (`SessionEventMap` has no such type), so it takes its own subscription:
      // without it a host that opens and closes many sessions leaks one cache
      // entry per closed session for the lifetime of the process.
      const offDisposed = ctx.on("session/disposed", (session) => {
        try {
          forget(session);
        } catch {}
      });
      return () => {
        offEvent?.();
        offDisposed?.();
      };
    },
    "dsh-notify-me: host fallback subscription",
  );

  // Read-only probe, registered after the subscription so a 200 here proves
  // this process both mounted the pusher and wired its event feed. It carries
  // no credential, but it does disclose that this machine runs DSH with the
  // fallback on and when it last delivered, so it goes through the same gate as
  // every other entry point rather than being a second, ungated window. A
  // tunnel-fronted host still answers it, because the allow-list derives the
  // public `Host` it arrives with.
  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: "exact",
          path: healthPath,
          handler: (req, res) => {
            const method = req.method ?? "GET";
            if (method !== "GET" && method !== "HEAD") {
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
            const page = presence.snapshot();
            respond(res, 200, {
              ok: true,
              version: shared?.version ?? null,
              enabled: true,
              events: Array.from(events),
              includeSubagents,
              pageAlive: page.alive,
              // What the page last said about external forwarding: the first
              // thing to look at when someone asks why the fallback went quiet
              // with a page it cannot see.
              pageExternal: page.external,
              lastDelivery,
            });
          },
        }),
      "dsh-notify-me: host fallback health probe",
    );
  });
}