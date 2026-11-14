/**
 * 「Claude 에게 보내기」 (ocul-next #send-to-claude) — 일지 · 계획 항목 · 변경 파일을 맥락으로 붙여
 * 지금 이 창에서 도는 claude 세션에 말을 넣는다. 세션이 없으면 그 말로 새 세션을 연다.
 *
 * 화면 어디서든 `requestSendToClaude(맥락)` 만 부르고, 대화상자는 창마다 하나(`SendToClaudeHost`).
 * xterm 을 들이지 않는다 — 넣는 일은 백엔드(`term_write`)가 한다.
 */
import { terminalApi, type TermInfo, type TermStatus } from "@/api/terminal";
import { t, type I18nKey, type TVars } from "@/i18n";
import { createIntentSlot, createStore } from "@/lib/createStore";
import { toast } from "@/lib/toast";
import { sanitizePaste } from "./pasteSafe";

export interface SendContext {
  kind: "journal" | "plan" | "file" | "notes" | "terminal";
  /** 사람이 읽는 이름 — 일지 제목 · 항목 제목 · 파일 경로 · 고른 줄 수. */
  label: string;
  /** Claude 가 찾아 읽을 자리 — `.oculpm/journal/…md` · `plan-id#item` · 파일 경로. */
  ref: string;
  /** 맥락에 덧붙일 상태 한 마디(「검증 없음」 등). */
  note?: string;
  /** 할 말 칸을 미리 채운다 — 변경 줄 메모 묶음. 보내기 전에 고칠 수 있다. */
  prefill?: string;
  /** 터미널에서 고른 출력(`terminal` 만) — 맥락 머리 뒤에 코드 울타리로 붙는다. */
  body?: string;
  /** 보낸 뒤 — 변경 메모는 보내면 비운다. */
  onSent?: () => void;
}

const slot = createIntentSlot<SendContext>("oculpm:send-to-claude");
export const requestSendToClaude = (ctx: SendContext) => slot.request(ctx);
export const onSendToClaude = (fn: (ctx: SendContext) => void) => slot.subscribe(fn);

/**
 * 터미널에서 고른 출력을 Claude 에게 (⌘L, 업그레이드 라운드 TI-08) — 셸 칸의 실패 출력을 같은 창의
 * Claude 에게 넘기는 데 복사 → 대화상자 → 붙여넣기가 들었다. 이제 고르고 한 키.
 *
 * 상한(`BODY_MAX`)을 넘으면 끝 쪽만 가니 이름에 그 사실을 적는다 — 「300줄」만 보이면 긴 로그를 고른
 * 사람은 전부 간다고 믿는다.
 */
export function requestSendSelection(text: string) {
  const n = text.split("\n").length;
  const label = outputBody(text).cut
    ? t("send.ctx.terminalCut", { n, max: BODY_MAX.toLocaleString("en-US") })
    : t("send.ctx.terminal", { n });
  requestSendToClaude({ kind: "terminal", label, ref: "", body: text });
}

type Tr = (key: I18nKey, vars?: TVars) => string;

const HEAD: Record<SendContext["kind"], I18nKey> = {
  journal: "send.msg.journal",
  plan: "send.msg.plan",
  file: "send.msg.file",
  notes: "send.msg.notes",
  terminal: "send.msg.terminal",
};

/** 고른 출력의 상한 — 넘으면 끝 쪽을 남긴다(실패한 명령은 끝에 요약과 오류가 있다). */
export const BODY_MAX = 4000;

/** 고른 출력에서 실제로 갈 글 — 거르고, 끝 줄바꿈을 떼고, 상한을 넘으면 「…」 뒤에 끝 쪽만. */
function outputBody(body: string): { text: string; cut: boolean } {
  const text = sanitizePaste(body).replace(/\n+$/, "");
  if (text.length <= BODY_MAX) return { text, cut: false };
  let tail = text.slice(-BODY_MAX);
  // 잘린 자리가 서로게이트 쌍 가운데면 반쪽을 버린다.
  const first = tail.charCodeAt(0);
  if (first >= 0xdc00 && first <= 0xdfff) tail = tail.slice(1);
  return { text: `\u{2026}\n${tail}`, cut: true };
}

/** 고른 출력 → 코드 울타리. 글 안의 가장 긴 ``` 보다 긴 울타리를 쓴다 — 글이 울타리를 닫지 못하게. */
function fenced(body: string): string {
  const { text } = outputBody(body);
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

/** Claude 에게 갈 글 — 맥락 한 줄, (고른 출력), 빈 줄, 사람이 쓴 말. */
export function composeMessage(tr: Tr, ctx: SendContext, text: string): string {
  const head = tr(HEAD[ctx.kind], { ref: ctx.ref, label: ctx.label });
  const note = ctx.note ? ` (${ctx.note})` : "";
  const body = ctx.body ? `\n\n${fenced(ctx.body)}` : "";
  return `${head}${note}${body}\n\n${text.trim()}`;
}

/**
 * 안의 프로그램이 Claude 인가 — 엔진이 알린 이름(`status.app`, OSC 7501)이 있으면 그것으로 가린다.
 * 상태 신호만 보면 Codex 세션도 끼어 Claude 에게 쓴 지시가 Codex 로 갈 수 있었다. 이름을 안 알리는
 * 프로그램(엔진 합류 전 · 옛 판)은 예전처럼 믿는다. 규칙은 엔진의 `runs_claude` 와 같은 모양이다 —
 * 엔진이 소문자로 다듬은 이름이 `claude`(· `claude-code`)로 시작하면 Claude.
 */
function isClaudeApp(s: TermInfo): boolean {
  const app = (s.status as (TermStatus & { app?: string | null }) | null)?.app;
  return app == null || app.startsWith("claude");
}

/** 받을 수 있는 세션 — 셸 위에서 claude 가 돈다(상태 신호를 보냈거나 「다음」으로 띄운 것). */
export function receiversOf(list: readonly TermInfo[]): TermInfo[] {
  return list.filter((s) => s.alive && s.busy && (s.status != null || s.label === "claude") && isClaudeApp(s));
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
 * 잠깐 뒤 Enter. 쉬는지는 보지 않는다 — 부르는 쪽이 `sendOrQueue` 로 가린다.
 *
 * 넣기 전에 거른다(`pasteSafe`) — 일지 · 계획 제목은 동료가 커밋한 글이라 `ESC[201~` 이 들어 있으면
 * 붙여넣기가 일찍 닫히고 뒤의 `!명령` 이 셸 모드로 돈다. 줄 세운 말(`flushQueue`) · 「끝까지」(/goal)도
 * 모두 여기를 지난다.
 */
export async function deliverToSession(id: number, message: string, settleMs = 60): Promise<void> {
  await terminalApi.write(id, PASTE_START + sanitizePaste(message) + PASTE_END);
  await new Promise((r) => setTimeout(r, settleMs));
  await terminalApi.write(id, "\r");
}

// ── 보낼 말 줄 세우기 (11-05, Orca 의 follow-up queue) ─────────────────────────────────────────
//
// 일하는 중에 넣으면 Claude Code 가 그 말을 **도는 턴 한가운데** 끼워 넣는다. 묻는 중(권한 · 질문)에
// 넣으면 더 나쁘다 — 붙여넣기 뒤의 Enter 가 떠 있는 선택지를 눌러 버린다. 그래서 쉬지 않는 세션에
// 보내는 말은 이 창의 줄에 세웠다가, 그 세션이 손을 놓으면(OSC 7501 idle · done · error) 넣는다.
// 줄은 창의 웹뷰에 산다 — 세션도 창과 함께 죽으니 같은 수명이다.

export type Readiness = "ready" | "working" | "blocked";

/** 지금 넣어도 되는가 — 상태를 안 알리는 옛 claude(`null`)는 알 길이 없어 예전처럼 바로 넣는다. */
export function readinessOf(status: TermInfo["status"] | undefined): Readiness {
  if (status?.state === "working") return "working";
  if (status?.state === "blocked") return "blocked";
  return "ready";
}

export interface Queued {
  key: number;
  sessionId: number;
  message: string;
  onDelivered?: () => void;
}

const queue = createStore<readonly Queued[]>([]);
let seq = 0;
export const queuedStore = queue;

export function enqueue(sessionId: number, message: string, onDelivered?: () => void): number {
  const key = ++seq;
  queue.set([...queue.get(), { key, sessionId, message, onDelivered }]);
  return key;
}

/** 줄에서 뺀다 — 이미 넣었으면 `false`. */
export function cancelQueued(key: number): boolean {
  const cur = queue.get();
  if (!cur.some((q) => q.key === key)) return false;
  queue.set(cur.filter((q) => q.key !== key));
  return true;
}

export interface FlushResult {
  delivered: Queued[];
  /** 세션이 끝나 넣을 곳이 없어진 말. */
  dropped: Queued[];
}

/**
 * 쉬게 된 세션에 그 세션 몫을 **한 번에** 넣는다 — 하나씩 넣으면 첫 말에 claude 가 다시 일하는 사이
 * 나머지가 또 턴 중간에 끼므로, Claude Code 가 제 줄을 합치듯 빈 줄로 이어 한 턴으로 보낸다.
 * 넣기 전에 줄에서 먼저 빼서, 사건이 겹쳐 두 번 불려도 같은 말이 두 번 가지 않는다.
 */
export async function flushQueue(
  list: readonly TermInfo[],
  deliver: (id: number, message: string) => Promise<void> = deliverToSession,
): Promise<FlushResult> {
  const cur = queue.get();
  if (cur.length === 0) return { delivered: [], dropped: [] };
  const byId = new Map(list.map((s) => [s.id, s]));
  const dropped = cur.filter((q) => !byId.get(q.sessionId)?.alive);
  const ready = cur.filter((q) => {
    const s = byId.get(q.sessionId);
    return s?.alive && readinessOf(s.status) === "ready";
  });
  if (dropped.length === 0 && ready.length === 0) return { delivered: [], dropped: [] };
  const taken = new Set([...dropped, ...ready]);
  queue.set(cur.filter((q) => !taken.has(q)));

  const delivered: Queued[] = [];
  const sessions = [...new Set(ready.map((q) => q.sessionId))];
  for (const id of sessions) {
    const mine = ready.filter((q) => q.sessionId === id);
    try {
      await deliver(id, mine.map((q) => q.message).join("\n\n"));
      delivered.push(...mine);
      for (const q of mine) q.onDelivered?.();
    } catch {
      dropped.push(...mine);
    }
  }
  return { delivered, dropped };
}

export type SendOutcome = { outcome: "sent" } | { outcome: "queued"; key: number; readiness: Readiness };

/**
 * 세션에 보내거나 줄에 세운다. 상태는 보내는 순간 다시 읽는다 — 대화상자를 연 뒤 권한 질문이 떴을 수 있다.
 * `now` 는 「지금 끼워 넣기」: 일하는 중이면 바로 넣지만, 묻는 중에는 Enter 가 선택지를 누르니 그래도 줄에 세운다.
 */
export async function sendOrQueue(
  id: number,
  message: string,
  opts: { now?: boolean; onDelivered?: () => void } = {},
): Promise<SendOutcome> {
  const all = await terminalApi.list().catch(() => []);
  const info = (Array.isArray(all) ? all : []).find((s) => s.id === id);
  const readiness = readinessOf(info?.status);
  if (readiness === "ready" || (opts.now && readiness === "working")) {
    await deliverToSession(id, message);
    opts.onDelivered?.();
    return { outcome: "sent" };
  }
  return { outcome: "queued", key: enqueue(id, message, opts.onDelivered), readiness };
}

/**
 * 대화상자 없이 바로 맡긴다 — 이 창에서 쉬는 claude 세션이 있으면 거기에(쉬는 세션이 없으면 첫 세션의
 * 줄에), 세션이 없으면 그 글로 새 세션을. 변경 화면의 「Claude 에게 맡기기」(일지 없는 변경의 기록 요청)가
 * 쓴다. 넣은 세션의 순번(1부터)과 결과를 돌려주고, 새 세션이면 `null`.
 */
export async function sendOrRun(
  projectId: number,
  message: string,
): Promise<{ n: number; outcome: SendOutcome } | null> {
  const all = await terminalApi.list().catch(() => []);
  const list = receiversOf(Array.isArray(all) ? all : []);
  const target = defaultReceiver(list);
  if (target) {
    const outcome = await sendOrQueue(target.id, message);
    return { n: list.indexOf(target) + 1, outcome };
  }
  const { runPromptInTerminal } = await import("./runPrompt");
  await runPromptInTerminal(projectId, message);
  return null;
}

/** 줄에 세웠다는 알림 — 「취소」로 뺄 수 있다. 변경 화면의 「Claude 에게 맡기기」도 쓴다. */
export function toastQueued(t: Tr, n: number, key: number) {
  toast.info(t("send.queued", { n }), {
    actions: [
      {
        label: t("common.cancel"),
        onClick: () => {
          if (cancelQueued(key)) toast.info(t("send.queueCancelled"));
        },
      },
    ],
  });
}
