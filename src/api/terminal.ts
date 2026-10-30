// 앱 안 터미널 (4.0) — 세션 손잡이. 세션은 앱 프로세스 안에 살고 창이 닫히면 끝난다
// (src-tauri/src/terminal.rs).
import { Channel } from "@tauri-apps/api/core";
import {
  commands,
  events,
  type TermCloseAsked,
  type TermEvent,
  type TermImage,
  type TermInfo,
  type TermStatus,
} from "@/lib/bindings";
import { call, subscribe, subscribeHere } from "./invoke";

export type { TermCloseAsked, TermEvent, TermInfo, TermStatus };

export const terminalApi = {
  /**
   * 프로젝트 루트에서 로그인 셸을 연다. `prompt` 가 있으면 그것으로 `claude` 를 바로 실행.
   * `cwd` 는 이 프로젝트의 레인(worktree 여럿에서)일 때만 — 백엔드가 아니면 거절한다.
   */
  open: (
    projectId: number,
    cols: number,
    rows: number,
    prompt: string | null,
    onEvent: (ev: TermEvent) => void,
    cwd: string | null = null,
  ) => {
    const channel = new Channel<TermEvent>();
    channel.onmessage = onEvent;
    return call("term_open", commands.termOpen(projectId, cols, rows, prompt, cwd, channel));
  },
  write: (id: number, data: string) => call("term_write", commands.termWrite(id, data)),
  resize: (id: number, cols: number, rows: number) => call("term_resize", commands.termResize(id, cols, rows)),
  close: (id: number): Promise<void> => commands.termClose(id),
  list: (): Promise<TermInfo[]> => commands.termList(),
  /** 모든 창의 세션 — 프로젝트 목록 · 시작 창이 프로젝트별로 센다. */
  overview: (): Promise<TermInfo[]> => commands.termOverview(),
  /** 이 창의 세션을 모두 끝낸다 — 닫기 확인에서 「닫기」를 고른 뒤. */
  endWindow: (): Promise<void> => commands.termEndWindow(),
  /** 어느 창에서든 세션이 열리거나 · 끝나거나 · 안의 프로그램 상태가 바뀌었다. */
  /** 터미널에 찍힌 이미지 경로의 그림 — 그림 시그니처 · 16MB 를 백엔드가 본다(`commands/term_image.rs`). */
  imagePreview: (path: string): Promise<TermImage> =>
    call("terminal_image_preview", commands.terminalImagePreview(path)),
  onSessionsChanged: (cb: () => void) => subscribe(events.termSessionsChanged, () => cb()),
  /** 이 창을 닫거나(`quit` 이면 앱을 끄기) 전에 묻는다 — 백엔드가 **이 창에만** 보낸다(`subscribeHere`). */
  onCloseAsked: (cb: (ask: TermCloseAsked) => void) => subscribeHere(events.termCloseAsked, cb),
};
