/**
 * macOS native notifications for DSH Desktop.
 *
 * The desktop page's `new Notification()` does not reliably reach the macOS
 * Notification Center, so on macOS the page posts its alert here and the host
 * spawns the small helper app built from macos/DSHNotify.swift, which posts a
 * real UNUserNotification. A click on that notification opens `dsh://open`
 * (raising the DSH window) and writes the session id to a click file; the page
 * collects it on focus through GET and switches to that conversation.
 *
 * A posted notification is addressed by the identifier the page sends (`id`),
 * which is also the toast tag the page tracks: POST `{ remove: id }` withdraws
 * it again from Notification Center, so "back at the page" and the auto-dismiss
 * timer behave the same here as on the browser path.
 */

import { spawn, execFile } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { guardRequest, readBody, respond } from "./page-bridge.js";

export const MAC_NOTIFY_ROUTE = "/__dsh-notify-me/mac-notify";
const HEADER = "x-dsh-notify-me-mac";
const HEADER_VALUE = "notify";
const DEFAULT_APP = fileURLToPath(new URL("../macos/DSH Notify.app", import.meta.url));
const DEFAULT_CLICK_FILE = join(tmpdir(), "dsh-notify-me-click.json");
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

function binaryOf(appPath) {
  return join(appPath, "Contents", "MacOS", "dsh-notify");
}

function str(value, limit) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

/**
 * Split a page alert body into the notification's subtitle and body.
 *
 * lib/client.js writes the conversation name on the first line and the detail
 * after it: `<label>` alone, `<label>\n<snippet>`, or — for an alert with no
 * conversation, such as an approval on a cold page — a single detail line.
 * macOS draws a `subtitle` between the title and the body, so the label belongs
 * there; left in the body it renders as one thin line under the title, which is
 * all a completion without a snippet used to say.
 *
 * Only a body with a non-empty first line *and* a non-empty remainder is split.
 * A one-line body is kept whole on purpose: an approval alert is written as a
 * single `"<label>: <content>"` line, and cutting it would mangle both halves
 * for no gain. Everything else — an empty body, a leading blank line, a bare
 * trailing newline — falls back to the unsplit body rather than inventing a
 * subtitle, and never duplicates the title (that would need the title here, and
 * this function deliberately does not take one).
 *
 * @param raw - the alert body as the page sent it.
 * @returns `{ subtitle, body }`; `subtitle` is "" when the body cannot be split.
 */
export function splitNotificationBody(raw) {
  const text = typeof raw === "string" ? raw : "";
  const cut = text.indexOf("\n");
  if (cut < 0) return { subtitle: "", body: text };
  const subtitle = text.slice(0, cut).trim();
  const body = text.slice(cut + 1).trim();
  if (subtitle.length === 0 || body.length === 0) return { subtitle: "", body: text };
  return { subtitle, body };
}

/**
 * Spawn the helper and wait for its one-line verdict.
 * @param spawnFn - child_process.spawn (injectable so the smoke test runs on
 *   any platform: the helper binary cannot be executed from a Windows host).
 * @param appPath - bundle whose `Contents/MacOS/dsh-notify` is spawned.
 * @param args - helper argv.
 * @returns `{ ok, detail }`; never rejects.
 */
function runHelper(spawnFn, appPath, args) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawnFn(binaryOf(appPath), args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch (error) {
      resolve({ ok: false, detail: "spawn-failed: " + String(error?.message ?? error) });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ ok: false, detail: "timeout" });
    }, 25000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: "spawn-error: " + String(error?.message ?? error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, detail: out.trim().slice(0, 200) || `exit-${code}` });
    });
  });
}

function postNotification(spawnFn, appPath, note, clickFile) {
  // An explicit subtitle wins: the page knows when a body is only a label and
  // has already lifted it (a completion with no snippet). Otherwise the split
  // happens here, before the 1000-character cap applies, so that cap bounds the
  // detail actually drawn rather than the detail plus the label taken out of
  // it. Either half gets its own bound.
  const parts = str(note.subtitle, 200)
    ? { subtitle: str(note.subtitle, 200), body: note.body }
    : splitNotificationBody(note.body);
  const args = ["--title", note.title, "--body", str(parts.body, 1000), "--click-file", clickFile];
  if (parts.subtitle) args.push("--subtitle", str(parts.subtitle, 200));
  if (note.sessionId) args.push("--session", note.sessionId);
  if (note.id) args.push("--id", note.id);
  if (note.sound) args.push("--sound");
  return runHelper(spawnFn, appPath, args);
}

function removeNotification(spawnFn, appPath, id) {
  return runHelper(spawnFn, appPath, ["--remove", id]);
}

function takeClick(clickFile) {
  try {
    const parsed = JSON.parse(readFileSync(clickFile, "utf8"));
    unlinkSync(clickFile);
    return parsed && typeof parsed.sessionId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Pull the last reply's text out of a `ctx.sessionQuery.readSession()` event log.
 *
 * The page cannot read conversation text on hosts whose snapshot carries
 * sequence numbers rather than message nodes, so a completion alert reaches the
 * host with an empty body and the conversation name as its subtitle. The host
 * has the log, so it fills that empty body with a short, single-line excerpt of
 * the final assistant message: the one thing a notification should say.
 *
 * Only committed `assistant/message` events are considered, and only their text
 * blocks — reasoning, tool calls and attachments are skipped. The walk goes
 * backwards so the answer is the most recent reply, and whitespace is collapsed
 * because a notification body is one or two lines at most.
 *
 * @param events - the event log, oldest first, as `readSession` returns it.
 * @param limit - maximum excerpt length; longer text is cut and ellipsised.
 * @returns the excerpt, or "" when the log holds no assistant text.
 */
export function lastReplySnippet(events, limit = 80) {
  if (!Array.isArray(events)) return "";
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || event.type !== "assistant/message") continue;
    const content = event.data?.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((block) => block && block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
    if (text) return text.length > limit ? text.slice(0, limit) + "\u2026" : text;
  }
  return "";
}

/**
 * Register the route — only on the macOS desktop host (the Electron binary).
 * Without the helper app GET reports `enabled: false` and the page keeps its
 * own toasts.
 * @param webCtx - cordis context holding `webServer`.
 * @param config - `{ enabled, appPath }`.
 * @param shared - `{ bindHost, allowedOrigins }`.
 * @param logger - cordis logger.
 * @param deps - test seams: `{ spawn, execFile, clickFile, readSnippet }`, where
 *   `readSnippet(sessionId)` resolves the last reply's excerpt for a completion
 *   whose body is empty (see `lastReplySnippet`).
 */
export function mountMacNotify(webCtx, config, shared, logger, deps = {}) {
  if (process.platform !== "darwin" || typeof process.versions.electron !== "string") return;
  const spawnFn = typeof deps.spawn === "function" ? deps.spawn : spawn;
  const execFileFn = typeof deps.execFile === "function" ? deps.execFile : execFile;
  const clickFile = typeof deps.clickFile === "string" && deps.clickFile.length > 0 ? deps.clickFile : DEFAULT_CLICK_FILE;
  const appPath = config.appPath || DEFAULT_APP;
  const available = config.enabled !== false && existsSync(binaryOf(appPath));
  if (config.enabled !== false && !available) {
    logger?.warn?.(`dsh-notify-me: macOS helper not found at ${appPath}, run macos/build.sh`);
  }
  // LaunchServices must know the bundle so a notification click can relaunch it.
  if (available) execFileFn(LSREGISTER, ["-f", appPath], () => {});

  const handler = (req, res) => {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "POST") {
      respond(res, 405, { ok: false, reason: "method-not-allowed" });
      return;
    }
    const guard = guardRequest(req, {
      bindHost: shared.bindHost,
      allowedOrigins: shared.allowedOrigins,
      connection: shared.connection,
    });
    if (guard !== null) {
      respond(res, guard.status, { ok: false, reason: guard.reason });
      return;
    }
    if (method === "GET") {
      respond(res, 200, { ok: true, enabled: available, click: available ? takeClick(clickFile) : null });
      return;
    }
    if (!available) {
      respond(res, 501, { ok: false, reason: "unavailable" });
      return;
    }
    if (req.headers[HEADER] !== HEADER_VALUE) {
      respond(res, 403, { ok: false, reason: "forbidden" });
      return;
    }
    void readBody(req, 16 * 1024).then(async (body) => {
      let note;
      try { note = JSON.parse(body.ok ? body.text : ""); } catch { note = null; }
      if (!note || Array.isArray(note) || typeof note !== "object") {
        respond(res, 400, { ok: false, reason: "invalid-json" });
        return;
      }
      const id = str(note.id, 200);
      // Withdraw one already-posted notification; the page does this when the
      // user is back or the auto-dismiss timer fires, exactly as it closes a
      // page notification's handle.
      if (typeof note.remove === "string" && note.remove.length > 0) {
        const removed = await removeNotification(spawnFn, appPath, str(note.remove, 200));
        respond(res, removed.ok ? 200 : 502, removed);
        return;
      }
      if (typeof note.title !== "string") {
        respond(res, 400, { ok: false, reason: "invalid-json" });
        return;
      }
      // A completion the page could not caption arrives with an empty body and
      // the conversation name as its subtitle. The reply text lives in the
      // session log, which only the host can read, so fill the body here.
      let caption = str(note.body, 8000);
      if (caption === "" && str(note.kind, 40) === "done" && typeof deps.readSnippet === "function") {
        try {
          caption = str(await deps.readSnippet(str(note.sessionId, 200)), 1000);
        } catch {
          caption = "";
        }
      }
      const result = await postNotification(spawnFn, appPath, {
        title: str(note.title, 200),
        // Bounded again per half inside postNotification, after the split.
        body: caption,
        subtitle: str(note.subtitle, 200),
        sessionId: str(note.sessionId, 200),
        id,
        sound: note.sound === true,
      }, clickFile);
      respond(res, result.ok ? 200 : 502, result);
    }).catch(() => {});
  };

  webCtx.effect(
    () => webCtx.webServer.register({ kind: "exact", path: MAC_NOTIFY_ROUTE, handler }),
    "dsh-notify-me: macOS notification route",
  );
}
