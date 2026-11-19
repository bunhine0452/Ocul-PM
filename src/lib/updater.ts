import { useCallback, useState } from "react";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { windowApi } from "@/api/window";
import { installKindApi, updateExitApi, updateGateApi } from "@/api/installKind";
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

/**
 * 「다시 여는 중」 을 그릴 틈. Windows 는 다음 줄에서 프로세스가 끝나므로(설치 파일이 이어받는다)
 * 이 틈이 없으면 창이 말없이 사라진다 — 상태 한 줄을 칠할 만큼만 기다린다.
 */
const PAINT_MS = 350;

function paint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, PAINT_MS));
}

/** 받는 중 진척 — 전체 길이를 모르면(서버가 안 알려 줌) null. */
export function downloadPercent(received: number, total: number): number | null {
  if (!(total > 0)) return null;
  return Math.min(100, Math.floor((received / total) * 100));
}

async function saveWindows(): Promise<void> {
  try {
    await windowApi.saveSession();
  } catch {
    // 창 구성만 잃는다 — 업데이트 자체는 이어간다.
  }
}

async function restartRestoringWindows(): Promise<void> {
  await saveWindows();
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
    // 다른 창의 자동 확인이 이 결과를 쓴다 (`update_gate.rs`).
    updateGateApi.report(outcome.kind === "found" ? "found" : outcome.kind === "none" ? "none" : "failed");
    const next = statusAfterCheck(install, outcome);
    setUpdate(upd);
    setStatus(next);
    logStatus(next);
    return upd;
  }, []);

  /**
   * 받아 둔 새 버전으로 **지금** 바꾼다 — 끊으면 안 되는 일은 이미 확인했거나 사용자가 넘기기로 했다.
   *
   * - macOS · Linux: 번들은 이미 깔렸다(`install` 에서) — 창 구성을 적고 다시 띄운다.
   * - Windows: 설치 파일(NSIS /P /UPDATE /R)이 이어받고 이 프로세스는 `install()` 안에서 끝난다
   *   (플러그인의 `process::exit`). 그 길은 앱의 종료 정리를 지나지 않으므로 창 구성을 적은 뒤
   *   백엔드에 정리(세션 마감 · 터미널)를 먼저 시킨다 — 예전엔 업데이트마다 세션이 크래시로 적혔다.
   *   정리 뒤 설치 파일을 못 띄우면 앱을 다시 띄운다 — 정리된 채로 계속 쓸 수는 없다.
   */
  const apply = useCallback(async (upd: Update) => {
    setStatus({ kind: "restarting" });
    if (getPlatform() !== "windows") {
      await restartRestoringWindows();
      return;
    }
    await saveWindows();
    await paint();
    await updateExitApi.prepare();
    try {
      await upd.install();
    } catch (e) {
      oculpmLog.warn("updater", "apply -> error, relaunching", { version: upd.version, message: errMessage(e) });
      await relaunch();
    }
  }, []);

  /**
   * 새 버전을 받아 깔고 다시 띄운다. 대기 중인 업데이트가 없으면 아무 일도 안 한다.
   *
   * 받기(진척을 보인다) → 바쁨 확인 → 바꾸기. **바꾸기만 미룬다.** 도는 프로세스는 메모리의
   * 옛 코드를 계속 쓰므로 받는 것은 언제 해도 안전하고, macOS · Linux 는 번들을 디스크에 까는
   * 것까지 그렇다. 위험한 것은 재시작이다: 우리가 띄운 터미널 세션이 같이 끝나고, 그때 돌던
   * claude 의 턴은 끊긴다. 그래서 무언가 돌면 받아만 두고 기다린다(「지금 재시작」 이면 claude 는
   * 다시 뜰 때 잇는다). Windows 는 설치 자체가 앱을 끝내므로 깔기도 그때 한다 — 받은 바이트는
   * 백엔드가 들고 있다. 서명은 받은 바이트를 앱에 박힌 공개 키로 플러그인이 검증한다.
   */
  const install = useCallback(async () => {
    if (!update) return;
    setStatus({ kind: "downloading", percent: null });
    oculpmLog.info("updater", "install -> start", { version: update.version });
    try {
      let total = 0;
      let received = 0;
      let shown: number | null = null;
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          const percent = downloadPercent(received, total);
          if (percent !== shown) {
            shown = percent;
            setStatus({ kind: "downloading", percent });
          }
        }
      });
      if (getPlatform() !== "windows") {
        setStatus({ kind: "installing" });
        await update.install();
      }
    } catch (e) {
      const message = errMessage(e);
      oculpmLog.warn("updater", "install -> error", { version: update.version, message });
      setStatus({ kind: "error", message });
      return;
    }
    // 줄 이름은 스모크가 읽는다(updater-smoke-*.sh·ps1) — Windows 에선 「받았고 서명이 맞다」 까지다.
    oculpmLog.info("updater", "install -> installed", { version: update.version });

    const why = await waitReason();
    if (!why) {
      await apply(update);
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
      void apply(update);
    };
    const off = onBusyChange(() => void recheck());
    const offTerm = terminalApi.onSessionsChanged(() => void recheck());
    const timer = setInterval(() => void recheck(), RECHECK_MS);
  }, [update, apply]);

  /** 기다리지 않고 **지금** 바꾼다 (사용자가 그러기로 했을 때). */
  const restartNow = useCallback(async () => {
    if (update) await apply(update);
    else await restartRestoringWindows();
  }, [update, apply]);

  return { status, update, check, install, restartNow };
}
