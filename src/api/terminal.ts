// 앱 안 터미널 (4.0) — 세션 손잡이. 세션은 앱 프로세스 안에 살고 창이 닫히면 끝난다
// (src-tauri/src/terminal.rs).
import { Channel } from "@tauri-apps/api/core";
import {
  commands,
  events,
  type TermBusy,
  type TermCheck,
  type TermCloseAsked,
  type TermEvent,
  type TermImage,
  type TermInfo,
  type TermResume,
  type TermStatus,
} from "@/lib/bindings";
import { call, subscribe, subscribeHere } from "./invoke";

export type { TermBusy, TermCheck, TermCloseAsked, TermEvent, TermInfo, TermResume, TermStatus };

export const terminalApi = {
  /**
   * 프로젝트 루트에서 로그인 셸을 연다. `prompt` 가 있으면 그것으로 `claude` 를 바로 실행.
   * `cwd` 는 이 프로젝트의 레인(worktree 여럿에서)일 때만 — 백엔드가 아니면 거절한다.
   * `check` 는 계획의 확인 명령 한 줄 — 사람이 확인 창에서 누른 뒤에만(`features/terminal/runCheck.ts`).
   */
  open: (
    projectId: number,
    cols: number,
    rows: number,
    prompt: string | null,
    onEvent: (ev: TermEvent) => void,
    cwd: string | null = null,
    resume = false,
    check: TermCheck | null = null,
  ) => {
    const channel = new Channel<TermEvent>();
    channel.onmessage = onEvent;
    return call("term_open", commands.termOpen(projectId, cols, rows, prompt, cwd, resume, check, channel));
  },
  write: (id: number, data: string) => call("term_write", commands.termWrite(id, data)),
  /** 클립보드에 복사해 둔 파일의 경로들(macOS · Windows) — 파일이 아니면 빈 목록(`terminal_clipboard.rs`). */
  clipboardFiles: (): Promise<string[]> => call("term_clipboard_files", commands.termClipboardFiles()),
  /** OSC 52 의 복사를 OS 클립보드에 — 앱이 쓰지 않는 OS(Linux)면 `false`(웹뷰가 쓴다). */
  clipboardWrite: (text: string): Promise<boolean> => call("term_clipboard_write", commands.termClipboardWrite(text)),
  /**
   * 웹뷰가 그 세션의 출력을 `bytes` 만큼 그렸다 — 백엔드가 그만큼 더 읽는다(출력 흐름 제어,
   * `src-tauri/src/terminal_io.rs`). 알림을 잃어도 백엔드는 2초 뒤 스스로 푼다.
   */
  ack: (id: number, bytes: number): Promise<void> => commands.termAck(id, bytes),
  resize: (id: number, cols: number, rows: number) => call("term_resize", commands.termResize(id, cols, rows)),
  close: (id: number): Promise<void> => commands.termClose(id),
  list: (): Promise<TermInfo[]> => commands.termList(),
  /** 모든 창의 세션 — 프로젝트 목록 · 시작 창이 프로젝트별로 센다. */
  overview: (): Promise<TermInfo[]> => commands.termOverview(),
  /** 앱 전체에서 도는 세션 수와 그중 claude — 업데이트가 재시작 전에 묻는다. */
  busyAll: (): Promise<TermBusy> => commands.termBusyAll(),
  /** 업데이트 재시작 뒤 이 창이 이을 claude 세션 — 한 번만 받는다(`resumeAfterUpdate.ts`). */
  takeResume: (): Promise<TermResume[]> => commands.termTakeResume(),
  /** 이 창의 세션을 모두 끝낸다 — 닫기 확인에서 「닫기」를 고른 뒤. */
  endWindow: (): Promise<void> => commands.termEndWindow(),
  /** 어느 창에서든 세션이 열리거나 · 끝나거나 · 안의 프로그램 상태가 바뀌었다. */
  /** 터미널에 찍힌 이미지 경로의 그림 — 그림 시그니처 · 16MB 를 백엔드가 본다(`commands/term_image.rs`). */
  imagePreview: (path: string): Promise<TermImage> =>
    call("terminal_image_preview", commands.terminalImagePreview(path)),
  /** 터미널의 이미지 경로를 파일 탐색기(Finder)에서 선택된 채로 연다 — 그림 파일만(`term_image.rs`). */
  imageReveal: (path: string): Promise<null> => call("terminal_image_reveal", commands.terminalImageReveal(path)),
  onSessionsChanged: (cb: () => void) => subscribe(events.termSessionsChanged, () => cb()),
  /**
   * 다른 창의 세션으로 — 그 창을 앞으로 가져오고 그 창이 그 세션을 고르게 한다(⌘K · ⌘J). 세션이 그 사이 끝났으면
   * `false`(부른 쪽이 창만 연다). 못 부르면 `false` — 키가 예외를 던지면 안 된다.
   */
  focusSession: (id: number): Promise<boolean> =>
    Promise.resolve()
      .then(() => commands.termFocusSession(id))
      .then((ok) => ok === true)
      .catch(() => false),
  /** 다른 창이 이 창의 세션을 골랐다 — 백엔드가 **이 창에만** 보낸다(`subscribeHere`). */
  onFocusAsked: (cb: (id: number) => void) => subscribeHere(events.termFocusAsked, (p) => cb(p.id)),
  /** 이 창을 닫거나(`quit` 이면 앱을 끄기) 전에 묻는다 — 백엔드가 **이 창에만** 보낸다(`subscribeHere`). */
  onCloseAsked: (cb: (ask: TermCloseAsked) => void) => subscribeHere(events.termCloseAsked, cb),
};
