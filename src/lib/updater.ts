import { useCallback, useState } from "react";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { windowApi } from "@/api/window";
import { installKindApi } from "@/api/installKind";
import { terminalApi } from "@/api/terminal";
import { t } from "@/i18n";
import { busyReason, onBusyChange } from "./busyGuard";
import { getPlatform } from "./platform";
import { oculpmLog } from "./oculpmLog";
import { statusAfterCheck, statusBeforeCheck, type CheckOutcome, type UpdaterStatus } from "./updaterRoute";

// Shared self-update plumbing (benchmarked from the uvws/PySpace setup). The
// Tauri updater plugin checks the GitHub `latest.json` endpoint and verifies the
// build's signature against the pubkey embedded in tauri.conf.json. Both the
// launch-time UpdateBanner and the Settings → 데이터 "업데이트" section drive the
// same hook so the check / download / install / relaunch behaviour stays in one
// place. Requires the repo releases to be PUBLIC (the endpoint is
// unauthenticated); offline / no-update / private-repo all surface as `uptodate`
// or `error` and never crash.
//
// 설치 형식을 먼저 본다 (크로스플랫폼 L-UPD): deb 설치본은 묻지 않고 패키지 관리자
// 안내로, 최신 릴리스에 이 OS 의 빌드가 없으면(「대상 없음」) 오류가 아니라 중립
// 상태로 — 판정은 `updaterRoute.ts` 의 순수 함수다. 상태가 바뀔 때마다 앱 로그
// (`oculpm::frontend::updater`)에 한 줄 남긴다 — Windows·Linux 사용자의 「업데이트가
// 안 돼요」 를 로그 파일 하나로 읽으려고, 그리고 CI 업데이트 스모크가 그 줄을 본다.

export type { UpdaterStatus };

/** 상태를 로그 한 줄로 (문장은 grep 용 영어 — 화면 문장은 i18n). */
function logStatus(status: UpdaterStatus): void {
  const ctx: Record<string, unknown> = { ...status };
  delete ctx.kind;
  delete ctx.notes; // 릴리스 본문은 로그에 안 싣는다 — 판 번호면 된다.
  if (status.kind === "error") oculpmLog.warn("updater", `check -> ${status.kind}`, ctx);
  else oculpmLog.info("updater", `check -> ${status.kind}`, ctx);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Pull just the "✨ What's new" section out of a GitHub release body so the
 *  in-app updater shows the changelog as markdown — not the whole release page
 *  (the Downloads table + macOS notarization note are page boilerplate that
 *  doesn't apply to an in-place auto-update). Returns the section between the
 *  "What's new" heading and the next `###` heading; falls back to the full body
 *  (sans the leading `## <title>`) when that heading isn't present. */
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

/**
 * 창·탭을 저장하고 다시 띄운다.
 *
 * 업데이트 재시작은 **우리가 끼워 넣은 중단**이다 — 사용자가 끈 것이 아니므로
 * 열어 두었던 프로젝트 창들을 그대로 돌려놓는다. 백엔드가 스냅숏을 남기고,
 * 새로 뜬 프로세스가 그것을 보고 창·탭을 되살린다 (`window.rs::SESSION_KEY`).
 *
 * 저장이 실패해도 재시작은 막지 않는다 — 새 버전으로 가는 것이 먼저고, 복원은
 * 그 위의 편의다.
 */
/**
 * 앱 안 터미널에서 무언가 도는가 — 모든 창의 세션을 백엔드가 센다(창을 닫을 때의 확인과 같은 기준).
 * 재시작은 그 세션을 끝낸다. claude 는 다시 뜨면 같은 폴더에서 `claude --continue` 로 잇지만,
 * 도는 중인 턴은 끊기므로 묻는다(4.0 터미널이 이 등록을 빠뜨려 업데이트가 묻지 않고 끊었다, 10-31).
 */
async function terminalReason(): Promise<string | null> {
  try {
    const { busy, claude } = await terminalApi.busyAll();
    if (!busy) return null;
    return claude > 0 ? t("update.busyClaude", { n: busy }) : t("update.busyTerminal", { n: busy });
  } catch {
    return null;
  }
}

async function waitReason(): Promise<string | null> {
  return busyReason() ?? (await terminalReason());
}

/** 바쁨이 풀렸는지 다시 볼 간격 — 셸 위의 프로그램이 끝나는 것(포그라운드 그룹)은 사건이 없다. */
const RECHECK_MS = 10_000;

async function restartRestoringWindows(): Promise<void> {
  try {
    await windowApi.saveSession();
  } catch {
    // 창 구성만 잃는다 — 업데이트 자체는 이어간다.
  }
  await relaunch();
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
    const install = await installKindApi.get();
    // deb 설치본은 업데이터에 묻지도 않는다 — 네트워크 0.
    const early = statusBeforeCheck(install);
    if (early) {
      setUpdate(null);
      setStatus(early);
      logStatus(early);
      return null;
    }
    let upd: Update | null = null;
    let outcome: CheckOutcome;
    try {
      upd = await checkForUpdate();
      outcome = upd ? { kind: "found", version: upd.version, notes: upd.body ?? null } : { kind: "none" };
    } catch (e) {
      outcome = { kind: "failed", message: errMessage(e) };
    }
    const next = statusAfterCheck(install, outcome);
    setUpdate(upd);
    setStatus(next);
    logStatus(next);
    return upd;
  }, []);

  /**
   * 새 버전을 깔고 다시 띄운다. 대기 중인 업데이트가 없으면 아무 일도 안 한다.
   *
   * **재시작만 미룬다.** 번들을 디스크에 까는 것은 언제 해도 안전하다 — 도는
   * 프로세스는 메모리의 옛 코드를 계속 쓴다. 위험한 것은 재시작이다: 우리가
   * 띄운 터미널 세션이 같이 끝나고, 그때 돌던 claude 의 턴은 끊긴다. 그래서 무언가
   * 돌면 깔아만 두고 기다린다(「지금 재시작」 이면 claude 는 다시 뜰 때 잇는다).
   */
  const install = useCallback(async () => {
    if (!update) return;
    setStatus({ kind: "installing" });
    oculpmLog.info("updater", "install -> start", { version: update.version });
    try {
      // 받은 바이트의 서명을 앱에 박힌 공개 키로 검증한 뒤에만 깐다 (플러그인). Windows 는
      // 여기서 설치 파일(NSIS /P /R /UPDATE)을 띄우고 프로세스가 끝난다 — 아래는 안 돈다. 그래서
      // 창 구성(과 이을 claude 세션)을 먼저 적어 둔다. 묻기는 그 OS 에서 아직 못 한다.
      if (getPlatform() === "windows") await windowApi.saveSession().catch(() => {});
      await update.downloadAndInstall();
    } catch (e) {
      const message = errMessage(e);
      oculpmLog.warn("updater", "install -> error", { version: update.version, message });
      setStatus({ kind: "error", message });
      return;
    }
    oculpmLog.info("updater", "install -> installed", { version: update.version });

    const why = await waitReason();
    if (!why) {
      await restartRestoringWindows();
      return;
    }

    setStatus({ kind: "awaiting", reason: why });
    // 일이 끝나는 순간 띄운다 — 등록소 · 터미널 사건을 구독하고, 사건이 없는 변화(셸 위 프로그램이
    // 끝남)는 짧은 간격으로 다시 본다.
    let done = false;
    const recheck = async () => {
      if (done) return;
      const still = await waitReason();
      if (done) return;
      if (still) {
        setStatus({ kind: "awaiting", reason: still });
        return;
      }
      done = true;
      off();
      clearInterval(timer);
      void offTerm.then((u) => u());
      void restartRestoringWindows();
    };
    const off = onBusyChange(() => void recheck());
    const offTerm = terminalApi.onSessionsChanged(() => void recheck());
    const timer = setInterval(() => void recheck(), RECHECK_MS);
  }, [update]);

  /** 기다리지 않고 **지금** 띄운다 (사용자가 그러기로 했을 때). */
  const restartNow = useCallback(async () => {
    await restartRestoringWindows();
  }, []);

  return { status, update, check, install, restartNow };
}
