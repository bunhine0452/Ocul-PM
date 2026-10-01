// 터미널(PTY)·분리 터미널 창 커맨드 래퍼 (2026-10-01 `{#api-facades}`).
//
// PTY 는 호스트 프로세스(`--pty-host`)가 소유한다 — 앱이 업데이트로 재시작해도
// 셸이 산다. 여기서는 세션 하나를 열고·붙고·크기를 바꾸고·죽이는 것까지.
import { commands, type PtySessionInfo } from "@/lib/bindings";
import { call } from "./invoke";

export const ptyApi = {
  /**
   * 원시 쓰기 — **봉투 그대로** 돌려준다. 키 입력은 반드시
   * `features/terminal/dispatchTarget.ts` 의 `writePty`(세션별 직렬 줄)를 지난다.
   * 이것은 그 줄의 끝에서 실제로 보내는 함수다 (`ptyWrite.ts` 의 `PtySend`).
   */
  send: (sessionId: string, data: string) => commands.writeToPty(sessionId, data),

  /** 새 셸. 호스트가 셸 통합(OSC 133) nonce 를 발급한다. */
  start: (sessionId: string, cwd: string, rows: number, cols: number): Promise<PtySessionInfo> =>
    call("start_pty_session", commands.startPtySession(sessionId, cwd, rows, cols)),

  /** 살아 있는 세션에 다시 붙는다 — 없으면 `null` (그때는 `start`). */
  attach: (sessionId: string) => call("attach_pty_session", commands.attachPtySession(sessionId)),

  resize: (sessionId: string, rows: number, cols: number): Promise<null> =>
    call("resize_pty", commands.resizePty(sessionId, rows, cols)),

  kill: (sessionId: string): Promise<null> => call("kill_pty_session", commands.killPtySession(sessionId)),

  /** 지금 전경에서 도는 명령 이름 (셸 자신이면 `null`). */
  foregroundCommand: (sessionId: string): Promise<string | null> =>
    call("pty_foreground_command", commands.ptyForegroundCommand(sessionId)),
};

export const terminalWindowApi = {
  /** 프로젝트의 터미널을 분리 창으로 떼어 낸다. */
  open: (projectId: number): Promise<null> => call("open_terminal_window", commands.openTerminalWindow(projectId)),
  /** 분리 창을 닫고 터미널을 앱 안으로 되돌린다. */
  close: (projectId: number): Promise<null> =>
    call("close_terminal_window", commands.closeTerminalWindow(projectId)),
};
