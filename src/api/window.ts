/**
 * `windowApi` — 창 커맨드의 단일 래퍼 (창 하나 = 프로젝트 하나, 4.0).
 *
 * 봉투(`{status}`)를 풀어 값을 돌려주고 실패는 `ApiError` 하나로 접는다
 * (완성도 라운드 `#error-convention`). 새 파일은 `bindings.ts` 를 직접 부르지
 * 않는다 — `lint:bindings` 가 그 규율을 지킨다.
 */

import { call, subscribe } from "@/api/invoke";
import { commands, events, type WindowProjectChanged } from "@/lib/bindings";

export const windowApi = {
  /**
   * 지금 열려 있는 창을 저장한다. **업데이트 재시작 직전에만** 부른다 — 새로 뜬
   * 프로세스가 이 스냅숏을 보고 창을 되살린다 (`commands/window/session.rs`).
   */
  saveSession: () => call<null>("save_window_session", commands.saveWindowSession()),

  /**
   * 프로젝트의 창을 연다 — 이미 어느 창에 열려 있으면 **그 창을 앞으로** 가져온다
   * (I1, `commands/window/projects.rs`).
   */
  openProjectWindow: (projectId: number) =>
    call<null>("open_project_window", commands.openProjectWindow(projectId)),

  /**
   * 시작 창이 프로젝트를 고른다 — 이 창이 그 프로젝트가 되면 `true`. 이미 다른 창에
   * 열려 있으면 그 창이 앞으로 오고 `false` (이 창은 시작 창 그대로).
   */
  adoptProject: (projectId: number) =>
    call<boolean>("set_window_project", commands.setWindowProject(projectId)),

  /** 이 창의 프로젝트 (`null` = 시작 창). 마운트 직후 한 번 — 이후는 `onProjectChanged`. */
  projectOf: (label: string) => call<number | null>("get_window_project", commands.getWindowProject(label)),

  /** 어디든 창이 떠 있는 프로젝트 id. */
  openProjectIds: () => call<number[]>("list_open_project_ids", commands.listOpenProjectIds()),

  /** 이 창을 닫는다 — Windows·Linux 의 Ctrl+W (맥은 앱 메뉴의 ⌘W). */
  closeThisWindow: () => call<null>("close_window", commands.closeWindow()),

  /**
   * 새 시작 창 — macOS 앱 메뉴의 「새 창」과 같은 생성 함수다
   * (`commands/new_window.rs`). Windows·Linux 의 Ctrl+Shift+N 이 부른다 ({#os-new-window}).
   */
  newWindow: () => call<null>("new_window", commands.newWindow()),

  /** 창의 프로젝트가 바뀌었다 — 페이로드의 `window` 가 자기 라벨일 때만 반응할 것. */
  onProjectChanged: (cb: (payload: WindowProjectChanged) => void) =>
    subscribe(events.windowProjectChanged, cb),

  /** 열린 프로젝트 집합이 바뀌었다 (「열림」 표시). */
  onOpenProjectsChanged: (cb: (open: number[]) => void) =>
    subscribe(events.projectWindowsChanged, (p) => cb(p.open)),

  /** macOS 도움말 › 처음 쓰는 법 — 포커스된 이 창에만 온다 (`menu.rs` TourRequested). */
  onTourRequested: (cb: () => void) => subscribe(events.tourRequested, () => cb()),
};
