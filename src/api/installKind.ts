// 설치 형식 (크로스플랫폼 L-UPD `#upd-target-missing`) — `install_kind` 커맨드의 창구.
//
// 봉투 없이 값을 그대로 돌려주는 커맨드라 `call` 규약 밖이다. 실패는 `null`(모름)로
// 접는다 — 업데이터는 모르면 예전처럼 확인한다.
import { commands, type InstallKind } from "@/lib/bindings";

export type { InstallKind };

export const installKindApi = {
  get: (): Promise<InstallKind | null> =>
    Promise.resolve()
      .then(() => commands.installKind())
      .catch(() => null),
};

/**
 * 업데이트 확인 관문 (11-05, `commands/update_gate.rs`) — 창이 여럿이어도 앱이 한 번 묻는다.
 * 같은 업데이터 창구라 여기 둔다. 커맨드를 못 부르면(웹뷰 밖 · 낡은 다리) 예전처럼 묻는다.
 */
export const updateGateApi = {
  claim: (urgent: boolean): Promise<boolean> =>
    Promise.resolve()
      .then(() => commands.updateCheckClaim(urgent))
      .then((ok) => ok !== false)
      .catch(() => true),
  report: (outcome: "none" | "found" | "failed"): void =>
    void Promise.resolve()
      .then(() => commands.updateCheckReport(outcome))
      .catch(() => {}),
};

/**
 * Windows 업데이트 직전의 종료 정리 (11-19, `update_prepare_exit`) — 설치 파일이 앱을 `process::exit`
 * 로 끝내 `ExitRequested` 를 지나지 않으므로, 세션 마감 · 터미널 정리를 먼저 시킨다. 못 불러도
 * 업데이트는 막지 않는다 — 다음 기동의 복구가 닫는다(예전과 같다).
 */
export const updateExitApi = {
  prepare: (): Promise<void> =>
    Promise.resolve()
      .then(() => commands.updatePrepareExit())
      .then(() => undefined)
      .catch(() => undefined),
};
