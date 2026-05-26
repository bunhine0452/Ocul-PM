/**
 * Frontend → backend log bridge for ocul-pm.
 *
 * Why: the 3-step "load project → external LLM edits code → user sees a clean
 * summary" flow spans backend (`oculpm_init` / watcher / cache) AND frontend
 * (event listeners, refetch, render). When it breaks, the user wants a single
 * file to send back. This module forwards every relevant call into the
 * backend's `tracing` layer (which writes to
 * `<app_data>/logs/oculpm.log.YYYY-MM-DD`).
 *
 * Usage:
 * - `oculpmLog.flow("step 4 — TimelineView refetch triggered", { ... })` for
 *   the named flow steps the user will grep for (`[FLOW]` prefix).
 * - `oculpmLog.warn("...")` / `.error("...")` for unexpected paths.
 * - `installConsoleBridge()` (called once from App.tsx) monkey-patches
 *   `console.warn` + `console.error` so any third-party warning we missed
 *   still lands in the file.
 *
 * The bridge is fire-and-forget — we never block UI on a log call, and we
 * swallow `invoke` failures (the DevTools original console line is still
 * visible, so the worst case is a single log not reaching the file).
 */

import { commands } from "@/lib/bindings";

type Level = "info" | "warn" | "error" | "debug";

function send(level: Level, target: string, message: string) {
  // `void` — never await, never throw. Backend command is `Result<()>` and we
  // intentionally drop the result; logging must never fault.
  void commands.oculpmLog(level, target, message).catch(() => {});
}

function format(message: string, ctx?: Record<string, unknown>): string {
  if (!ctx || Object.keys(ctx).length === 0) return message;
  try {
    return `${message} | ${JSON.stringify(ctx)}`;
  } catch {
    return message;
  }
}

export const oculpmLog = {
  /** Named happy-path step. Always prefixed `[FLOW]` so a single grep filters
   *  the log to the 3-step pipeline. */
  flow(message: string, ctx?: Record<string, unknown>) {
    send("info", "flow", `[FLOW] ${format(message, ctx)}`);
    // Mirror to DevTools too so live debugging doesn't need to tail the file.
    // eslint-disable-next-line no-console
    console.log(`[oculpm][FLOW] ${format(message, ctx)}`);
  },
  info(target: string, message: string, ctx?: Record<string, unknown>) {
    send("info", target, format(message, ctx));
  },
  warn(target: string, message: string, ctx?: Record<string, unknown>) {
    send("warn", target, format(message, ctx));
    // eslint-disable-next-line no-console
    console.warn(`[oculpm][${target}] ${format(message, ctx)}`);
  },
  error(target: string, message: string, ctx?: Record<string, unknown>) {
    send("error", target, format(message, ctx));
    // eslint-disable-next-line no-console
    console.error(`[oculpm][${target}] ${format(message, ctx)}`);
  },
};

let installed = false;

/**
 * Monkey-patch `console.warn` + `console.error` so any uncategorised warning
 * we missed also lands in `oculpm.log`. Safe to call multiple times — the
 * second call is a no-op (`installed` guard).
 *
 * Does NOT patch `console.log` to avoid drowning the log in debug noise from
 * third-party libraries; use `oculpmLog.flow()` explicitly when you want
 * something in the file.
 */
export function installConsoleBridge() {
  if (installed) return;
  installed = true;
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    try {
      send("warn", "console", args.map(stringifyArg).join(" "));
    } catch {
      // swallow — we already emitted to DevTools
    }
  };
  console.error = (...args: unknown[]) => {
    origError(...args);
    try {
      send("error", "console", args.map(stringifyArg).join(" "));
    } catch {
      // swallow
    }
  };
}

function stringifyArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ""}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}
