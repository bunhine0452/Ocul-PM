// 디스패치를 **어디에, 무엇으로** 꽂을지 (2026-08-23).
//
// 예전 동작은 한 가지뿐이었다: 터미널 화면으로 데려간 뒤 셸 프롬프트에
// `claude "$(cat '…')"` 를 프리필. 도그푸딩에서 두 군데가 걸렸다.
//
//  ① **도크를 열어 두고 일하던 사람의 화면을 빼앗는다.** ⌘J 로 터미널을 이미
//     띄워 놨는데 ▶실행이 플래너를 걷어내고 터미널 화면으로 점프한다. 셸은
//     이미 눈앞에 있었다.
//  ② **돌고 있던 Claude Code 세션을 무시한다.** 대화 중인 세션에 한 줄 명령을
//     밀어 넣으면 그건 프롬프트로 전송돼 버리거나(에이전트가 텍스트로 받음),
//     사용자가 먼저 세션을 끝내고 `claude` 를 새로 띄워야 한다는 뜻이다.
//     맥락을 쌓아 둔 세션을 버리는 게 디스패치의 대가일 이유가 없다.
//
// 그래서 대상 페인의 **포그라운드 프로세스**를 보고 고른다. 에이전트가 돌고
// 있으면 프롬프트 본문을 붙여넣고, 셸이 놀고 있으면 종전처럼 한 줄 명령을 쓴다.
// 어느 쪽이든 **실행(Enter)은 사용자가 한다** — 이 계약은 그대로다.

import { commands } from "@/lib/bindings";
import { detectAgent, type AgentRun } from "./agentDetect";
import { activeSid } from "./activePane";
import { setPendingDispatch, type PendingDispatch } from "./dispatchBus";
import type { TerminalTab } from "@/contexts/WorkspaceContext";

export type HandoffResult =
  /** 돌고 있던 에이전트에 프롬프트 본문을 붙여넣었다. */
  | { kind: "pasted"; agent: string }
  /** 셸 프롬프트에 한 줄 명령을 프리필했다. */
  | { kind: "typed" }
  /** 아직 살아있는 셸이 없다 — 터미널이 뜨는 대로 들어간다 (dispatchBus). */
  | { kind: "queued" };

/**
 * 대상에 실제로 써 넣을 바이트를 고른다 (순수 함수).
 *
 * @param foreground 대상 페인의 포그라운드 명령줄 (`pty_foreground_command`).
 *   모르면 `null` — 그럼 셸이라고 보고 한 줄 명령으로 간다.
 */
export function choosePayload(
  pending: PendingDispatch,
  foreground: string | null,
): { data: string; agent: AgentRun | null } {
  const agent = pending.prompt ? detectAgent(foreground ?? "") : null;
  return agent && pending.prompt
    ? { data: bracketedPaste(pending.prompt), agent }
    : { data: pending.command, agent: null };
}

/**
 * 붙여넣기 시퀀스(`ESC[200~` … `ESC[201~`)로 감싼다.
 *
 * 개행이 든 본문을 그냥 쓰면 줄마다 Enter 로 읽혀 프롬프트가 조각난 채 전송된다.
 * 실제 터미널이 붙여넣기를 실어 보내는 방식 그대로 감싸면 에이전트는 이걸 **한
 * 덩어리 입력**으로 받고, 보낼지 말지는 사용자에게 남는다.
 */
export function bracketedPaste(text: string): string {
  return `\x1b[200~${sanitizeForPaste(text)}\x1b[201~`;
}

/**
 * 붙여넣기 본문 정제. 프롬프트에는 **일지 발췌**가 섞여 들어온다 — 남의 파일에서
 * 온 바이트다. ESC 를 비롯한 제어문자를 걷어내 붙여넣기가 조기 종료되거나 커서
 * 제어로 둔갑하는 길을 막는다 (개행·탭만 남긴다).
 */
export function sanitizeForPaste(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .replace(/\s+$/, "")
  );
}

/**
 * 이 창에서 터미널이 **이미 보이고 있는가**. 보이고 있으면 디스패치가 화면을
 * 빼앗을 이유가 없다 — 프리필은 눈앞의 셸에 그대로 꽂힌다.
 *
 * 분리 창에 떼어 놓은 경우도 "보이는" 쪽이다: 셸은 저쪽 창에 떠 있으니 이쪽
 * 화면을 터미널로 바꿔봐야 자리표시자만 나온다.
 */
export function terminalOnScreen(s: {
  terminalDockOpen: boolean;
  terminalDetached: boolean;
  uiV2View: string;
}): boolean {
  return s.terminalDetached || s.terminalDockOpen || s.uiV2View === "terminal";
}

/**
 * 세션 하나에 디스패치를 써 넣는다. 세션이 살아있지 않으면 `null` — 호출측이
 * 재시도하거나 대기열로 넘긴다.
 *
 * `pty_foreground_command` 는 미지의 세션에 에러를 돌려주므로 **생존 확인을
 * 겸한다** (쓰기 전에 한 번 물어보는 값이라 왕복이 늘지 않는다).
 */
export async function writeDispatchTo(
  sid: string,
  pending: PendingDispatch,
): Promise<HandoffResult | null> {
  const fg = await commands.ptyForegroundCommand(sid);
  if (fg.status !== "ok") return null;
  const { data, agent } = choosePayload(pending, fg.data);
  const written = await commands.writeToPty(sid, data);
  if (written.status !== "ok") return null;
  return agent ? { kind: "pasted", agent: agent.label } : { kind: "typed" };
}

/**
 * 디스패치를 터미널로 넘긴다.
 *
 * 살아있는 셸이 있으면 **그 자리에** 꽂는다 — 도크로 쓰든 터미널 화면에 있든
 * 분리 창에 떼어 놨든, PTY 는 Rust 에 하나뿐이라 sid 만 알면 닿는다. 없으면
 * 대기열에 넣고(`dispatchBus`), 터미널 면이 뜨는 대로 들어간다.
 */
export async function handoffDispatch(
  pending: PendingDispatch,
  tabs: readonly TerminalTab[],
  activeId: string | null,
): Promise<HandoffResult> {
  const sid = activeSid(tabs, activeId);
  const done = sid ? await writeDispatchTo(sid, pending) : null;
  if (done) return done;
  setPendingDispatch(pending);
  return { kind: "queued" };
}
