/**
 * macOS native notifications for DSH Desktop.
 *
 * The desktop page's `new Notification()` does not reliably reach the macOS
 * Notification Center, so on macOS the page posts its alert here and the host
 * spawns the small helper app built from macos/DSHNotify.swift, which posts a
 * real UNUserNotification. A click on that notification opens `dsh://open`
 * (raising the DSH window) and writes the session id to a click file; the page
 * collects it on focus through GET and switches to that conversation.
 */

import { spawn, execFile } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { gateRequest, readBody, respond } from "./page-bridge.js";

export const MAC_NOTIFY_ROUTE = "/__dsh-notify-me/mac-notify";
const HEADER = "x-dsh-notify-me-mac";
const HEADER_VALUE = "notify";
const DEFAULT_APP = fileURLToPath(new URL("../macos/DSH Notify.app", import.meta.url));
const CLICK_FILE = join(tmpdir(), "dsh-notify-me-click.json");
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

function binaryOf(appPath) {
  return join(appPath, "Contents", "MacOS", "dsh-notify");
}

function postNotification(appPath, note) {
  return new Promise((resolve) => {
    const args = ["--title", note.title, "--body", note.body, "--click-file", CLICK_FILE];
    if (note.sessionId) args.push("--session", note.sessionId);
    if (note.sound) args.push("--sound");
    let out = "";
    let child;
    try {
      child = spawn(binaryOf(appPath), args, { stdio: ["ignore", "pipe", "ignore"] });
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

function takeClick() {
  try {
    const parsed = JSON.parse(readFileSync(CLICK_FILE, "utf8"));
    unlinkSync(CLICK_FILE);
    return parsed && typeof parsed.sessionId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function str(value, limit) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

/**
 * Register the route — only on the macOS desktop host (the Electron binary).
 * Without the helper app GET reports `enabled: false` and the page keeps its
 * own toasts.
 * @param webCtx - cordis context holding `webServer`.
 * @param config - `{ enabled, appPath }`.
 * @param shared - `{ bindHost, allowedOrigins }`.
 * @param logger - cordis logger.
 */
export function mountMacNotify(webCtx, config, shared, logger) {
  if (process.platform !== "darwin" || typeof process.versions.electron !== "string") return;
  const appPath = config.appPath || DEFAULT_APP;
  const available = config.enabled !== false && existsSync(binaryOf(appPath));
  if (config.enabled !== false && !available) {
    logger?.warn?.(`dsh-notify-me: macOS helper not found at ${appPath}, run macos/build.sh`);
  }
  // LaunchServices must know the bundle so a notification click can relaunch it.
  if (available) execFile(LSREGISTER, ["-f", appPath], () => {});

  const handler = (req, res) => {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "POST") {
      respond(res, 405, { ok: false, reason: "method-not-allowed" });
      return;
    }
    const refusal = gateRequest(req, { bindHost: shared.bindHost, allowedOrigins: shared.allowedOrigins });
    if (refusal !== null) {
      respond(res, 403, { ok: false, reason: refusal });
      return;
    }
    if (method === "GET") {
      respond(res, 200, { ok: true, enabled: available, click: available ? takeClick() : null });
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
      if (!note || typeof note.title !== "string") {
        respond(res, 400, { ok: false, reason: "invalid-json" });
        return;
      }
      const result = await postNotification(appPath, {
        title: str(note.title, 200),
        body: str(note.body, 1000),
        sessionId: str(note.sessionId, 200),
        sound: note.sound === true,
      });
      respond(res, result.ok ? 200 : 502, result);
    }).catch(() => {});
  };

  webCtx.effect(
    () => webCtx.webServer.register({ kind: "exact", path: MAC_NOTIFY_ROUTE, handler }),
    "dsh-notify-me: macOS notification route",
  );
}
