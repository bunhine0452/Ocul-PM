/**
 * `windowApi` — 창·탭 커맨드의 단일 래퍼.
 *
 * 봉투(`{status}`)를 풀어 값을 돌려주고 실패는 `ApiError` 하나로 접는다
 * (완성도 라운드 `#error-convention`). 새 파일은 `bindings.ts` 를 직접 부르지
 * 않는다 — `lint:bindings` 가 그 규율을 지킨다.
 *
 * 탭 스트립은 아직 `bindings.ts` 를 직접 쓴다 (allowlist) — 여기로 옮기는 것은
 * 그 파일들을 손볼 때다.
 */

import { call } from "@/api/invoke";
import { commands } from "@/lib/bindings";

export const windowApi = {
  /**
   * 에이전트 주의 알림 (감사 라운드 2026-09-11 C3) — 창이 뒤에 있을 때만
   * 부른다. 설정(`tray.notify_agent`)·스로틀은 백엔드가 본다.
   */
  notifyAgentAttention: (kind: "permission" | "done" | "failed", project: string, detail: string) =>
    call<null>("notify_agent_attention", commands.notifyAgentAttention(kind, project, detail)),

  /**
   * 지금 열려 있는 창·탭을 저장한다. **업데이트 재시작 직전에만** 부른다 —
   * 새로 뜬 프로세스가 이 스냅숏을 보고 창을 되살린다
   * (`src-tauri/src/commands/window.rs::SESSION_KEY`).
   */
  saveSession: () => call<null>("save_window_session", commands.saveWindowSession()),

  /**
   * 프로젝트를 탭으로 연다 — 이미 어딘가 열려 있으면 **그 창을 포커스하고 그
   * 탭을 활성화**한다 (I1, `commands/window/tabs.rs`). `window` 는 아직 열려
   * 있지 않을 때 붙일 창 — 활성화만 바라면 `null`.
   */
  openProjectTab: (projectId: number, window: string | null) =>
    call<null>("open_project_tab", commands.openProjectTab(projectId, window)),
};
