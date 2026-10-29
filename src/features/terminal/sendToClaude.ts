/**
 * 「Claude 에게 보내기」 (ocul-next #send-to-claude) — 일지 · 계획 항목 · 변경 파일을 맥락으로 붙여
 * 지금 이 창에서 도는 claude 세션에 말을 넣는다. 세션이 없으면 그 말로 새 세션을 연다.
 *
 * 화면 어디서든 `requestSendToClaude(맥락)` 만 부르고, 대화상자는 창마다 하나(`SendToClaudeHost`).
 * xterm 을 들이지 않는다 — 넣는 일은 백엔드(`term_write`)가 한다.
 */
import { terminalApi, type TermInfo } from "@/api/terminal";
import type { I18nKey, TVars } from "@/i18n";
import { createIntentSlot } from "@/lib/createStore";

export interface SendContext {
  kind: "journal" | "plan" | "file";
  /** 사람이 읽는 이름 — 일지 제목 · 항목 제목 · 파일 경로. */
  label: string;
  /** Claude 가 찾아 읽을 자리 — `.oculpm/journal/…md` · `plan-id#item` · 파일 경로. */
  ref: string;
  /** 맥락에 덧붙일 상태 한 마디(「검증 없음」 등). */
  note?: string;
}

const slot = createIntentSlot<SendContext>("oculpm:send-to-claude");
export const requestSendToClaude = (ctx: SendContext) => slot.request(ctx);
export const onSendToClaude = (fn: (ctx: SendContext) => void) => slot.subscribe(fn);

type Tr = (key: I18nKey, vars?: TVars) => string;

const HEAD: Record<SendContext["kind"], I18nKey> = {
  journal: "send.msg.journal",
  plan: "send.msg.plan",
  file: "send.msg.file",
};

/** Claude 에게 갈 글 — 맥락 한 줄, 빈 줄, 사람이 쓴 말. */
export function composeMessage(tr: Tr, ctx: SendContext, text: string): string {
  const head = tr(HEAD[ctx.kind], { ref: ctx.ref, label: ctx.label });
  const note = ctx.note ? ` (${ctx.note})` : "";
  return `${head}${note}\n\n${text.trim()}`;
}

/** 받을 수 있는 세션 — 셸 위에서 claude 가 돈다(상태 신호를 보냈거나 「다음」으로 띄운 것). */
export function receiversOf(list: readonly TermInfo[]): TermInfo[] {
  return list.filter((s) => s.alive && s.busy && (s.status != null || s.label === "claude"));
}

/** 먼저 고를 받는 곳 — 쉬는(입력 대기 · 끝냄) 세션, 없으면 첫 세션. */
export function defaultReceiver(list: readonly TermInfo[]): TermInfo | null {
  const ready = list.find((s) => s.status?.state === "idle" || s.status?.state === "done");
  return ready ?? list[0] ?? null;
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * 도는 세션에 넣는다 — 붙여넣기(bracketed paste)로 감싸 여러 줄이 한 번에 입력칸에 들어가게 하고,
 * 잠깐 뒤 Enter. 일하는 중이면 Claude Code 가 다음 턴으로 줄을 세운다.
 */
export async function deliverToSession(id: number, message: string, settleMs = 60): Promise<void> {
  await terminalApi.write(id, PASTE_START + message + PASTE_END);
  await new Promise((r) => setTimeout(r, settleMs));
  await terminalApi.write(id, "\r");
}
