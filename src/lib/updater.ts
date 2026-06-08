import { useCallback, useState } from "react";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Shared self-update plumbing (benchmarked from the uvws/PySpace setup). The
// Tauri updater plugin checks the GitHub `latest.json` endpoint and verifies the
// build's signature against the pubkey embedded in tauri.conf.json. Both the
// launch-time UpdateBanner and the Settings → 데이터 "업데이트" section drive the
// same hook so the check / download / install / relaunch behaviour stays in one
// place. Requires the repo releases to be PUBLIC (the endpoint is
// unauthenticated); offline / no-update / private-repo all surface as `uptodate`
// or `error` and never crash.

export type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "installing" }
  | { kind: "error"; message: string };

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>({ kind: "idle" });
  const [update, setUpdate] = useState<Update | null>(null);

  /** Ask the endpoint whether a newer signed build exists. Returns the Update
   *  when one is available, else null. Failures (offline / private repo / no
   *  endpoint) resolve to null with status `error` — callers decide whether to
   *  surface them (Settings does; the silent launch banner does not). */
  const check = useCallback(async (): Promise<Update | null> => {
    setStatus({ kind: "checking" });
    try {
      const upd = await checkForUpdate();
      if (upd) {
        setUpdate(upd);
        setStatus({ kind: "available", version: upd.version, notes: upd.body ?? null });
        return upd;
      }
      setUpdate(null);
      setStatus({ kind: "uptodate" });
      return null;
    } catch (e) {
      setUpdate(null);
      setStatus({ kind: "error", message: errMessage(e) });
      return null;
    }
  }, []);

  /** Download + install the pending update in place, then relaunch. No-op if no
   *  update is pending. */
  const install = useCallback(async () => {
    if (!update) return;
    setStatus({ kind: "installing" });
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setStatus({ kind: "error", message: errMessage(e) });
    }
  }, [update]);

  return { status, update, check, install };
}
