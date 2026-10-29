// 앱 안 터미널 (4.0) — 세션 손잡이. 세션은 앱 프로세스 안에 살고 창이 닫히면 끝난다
// (src-tauri/src/terminal.rs).
import { Channel } from "@tauri-apps/api/core";
import { commands, events, type TermCloseAsked, type TermEvent, type TermInfo, type TermStatus } from "@/lib/bindings";
import { call, subscribe } from "./invoke";

export type { TermCloseAsked, TermEvent, TermInfo, TermStatus };

export const terminalApi = {
  /** 프로젝트 루트에서 로그인 셸을 연다. `prompt` 가 있으면 그것으로 `claude` 를 바로 실행. */
  open: (projectId: number, cols: number, rows: number, prompt: string | null, onEvent: (ev: TermEvent) => void) => {
    const channel = new Channel<TermEvent>();
    channel.onmessage = onEvent;
    return call("term_open", commands.termOpen(projectId, cols, rows, prompt, channel));
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
  onSessionsChanged: (cb: () => void) => subscribe(events.termSessionsChanged, () => cb()),
  /** 실행 중인 세션이 있는 이 창(`quit` 이면 앱)을 닫으려 했다 — 백엔드가 멈추고 묻게 한다. */
  onCloseAsked: (cb: (ask: TermCloseAsked) => void) => subscribe(events.termCloseAsked, cb),
};
