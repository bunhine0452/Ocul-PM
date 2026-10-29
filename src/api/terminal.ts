// 앱 안 터미널 (4.0) — 세션 손잡이. 세션은 앱 프로세스 안에 살고 창이 닫히면 끝난다
// (src-tauri/src/terminal.rs).
import { Channel } from "@tauri-apps/api/core";
import { commands, type TermEvent, type TermInfo } from "@/lib/bindings";
import { call } from "./invoke";

export type { TermEvent, TermInfo };

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
};
