import { useCallback, useState } from "react";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { busyReason, onBusyChange } from "./busyGuard";

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
  /** 새 버전은 깔렸고, **끊으면 안 되는 일**이 끝나기를 기다리는 중. */
  | { kind: "awaiting"; reason: string }
  | { kind: "error"; message: string };

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Pull just the "✨ What's new" section out of a GitHub release body so the
 *  in-app updater shows the changelog as markdown — not the whole release page
 *  (the Downloads table + macOS notarization note are page boilerplate that
 *  doesn't apply to an in-place auto-update). Returns the section between the
 *  "What's new" heading and the next `###` heading; falls back to the full body
 *  (sans the leading `## <title>`) when that heading isn't present. */
/**
 * 릴리스 목록 (최신 먼저). 설정 → 업데이트의 패치노트와 Today 의 What's-new
 * 카드가 같은 주소를 쓴다 — 공개 저장소라 CORS 가 열려 있고, 오프라인이면
 * 그냥 빈 상태로 떨어진다.
 */
export const RELEASES_API = "https://api.github.com/repos/bunhine0452/Ocul-PM/releases?per_page=20";

export function releaseHighlights(notes: string | null | undefined): string {
  if (!notes) return "";
  const text = notes.replace(/\r\n/g, "\n");
  const start = text.search(/^###\s+.*what'?s new.*$/im);
  if (start === -1) {
    // Unknown format — drop a leading "## <title>" line, keep the rest as-is.
    return text.replace(/^\s*##\s+.*$/m, "").trim();
  }
  const afterHeading = text.slice(start).replace(/^.*\n/, ""); // drop heading line
  const next = afterHeading.search(/^###\s/m);
  return (next === -1 ? afterHeading : afterHeading.slice(0, next)).trim();
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

  /**
   * 새 버전을 깔고 다시 띄운다. 대기 중인 업데이트가 없으면 아무 일도 안 한다.
   *
   * **재시작만 미룬다.** 번들을 디스크에 까는 것은 언제 해도 안전하다 — 도는
   * 프로세스는 메모리의 옛 코드를 계속 쓴다. 위험한 것은 재시작이다: 우리가
   * 띄운 ACP 어댑터가 같이 죽고, 그때 흐르던 답변은 아직 디스크에 없어 그대로
   * 사라진다. 그래서 끊으면 안 되는 일이 있으면 깔아만 두고 기다린다.
   */
  const install = useCallback(async () => {
    if (!update) return;
    setStatus({ kind: "installing" });
    try {
      await update.downloadAndInstall();
    } catch (e) {
      setStatus({ kind: "error", message: errMessage(e) });
      return;
    }

    const why = busyReason();
    if (!why) {
      await relaunch();
      return;
    }

    setStatus({ kind: "awaiting", reason: why });
    // 일이 끝나는 순간 띄운다. 구독을 안 걸고 폴링하면 끝난 뒤에도 최대 한
    // 주기만큼 멍하니 기다리게 된다.
    const off = onBusyChange(() => {
      const still = busyReason();
      if (still) {
        setStatus({ kind: "awaiting", reason: still });
        return;
      }
      off();
      void relaunch();
    });
  }, [update]);

  /** 기다리지 않고 **지금** 띄운다 (사용자가 그러기로 했을 때). */
  const restartNow = useCallback(async () => {
    await relaunch();
  }, []);

  return { status, update, check, install, restartNow };
}
