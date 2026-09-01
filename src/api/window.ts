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
   * 지금 열려 있는 창·탭을 저장한다. **업데이트 재시작 직전에만** 부른다 —
   * 새로 뜬 프로세스가 이 스냅숏을 보고 창을 되살린다
   * (`src-tauri/src/commands/window.rs::SESSION_KEY`).
   */
  saveSession: () => call<null>("save_window_session", commands.saveWindowSession()),
};
