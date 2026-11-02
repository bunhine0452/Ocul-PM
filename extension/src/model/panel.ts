// 사이드바 「Ocul」 패널의 줄 — 순수 모델 (0.3.0). 위에서 아래로 급한 순서:
//   Claude 가 기다려요 — 질문 · 허락 · 입력 기다림 (없으면 칸째 숨는다)
//   지금 볼 것        — 실패한 확인 명령 · 돌린 명령이 없는 오늘 일지 · 어느 일지에도 없는 변경
//                       (없으면 「볼 것이 없어요」 한 줄 — 비었다는 것도 답이다)
//   다음 할 일        — 살아 있는 계획마다 다음 항목 (앱 오늘 화면 · `/oculpm:next` 와 같은 규칙)
//   최근 일지         — 새것부터 몇 건
// 예외만 보여 준다는 원칙은 위 두 칸이 지킨다. 아래 두 칸은 「다음에 뭘 하지」 와 「방금 뭘 했지」 의 자리다.

import type { Journal } from "./journal";
import { livePlans, type Overview, type PlanVerdict } from "./overview";
import type { Plan } from "./plan";
import type { Question, Waiting } from "./waiting";

export type Row =
  | { kind: "question"; q: Question }
  | { kind: "waiting"; w: Waiting }
  | { kind: "failing"; v: PlanVerdict }
  | { kind: "unproven"; j: Journal }
  | { kind: "unrecorded"; path: string }
  | { kind: "allClear"; latest: PlanVerdict | null }
  | { kind: "next"; plan: Plan }
  | { kind: "journal"; j: Journal };

export type SectionKey = "claude" | "eyes" | "next" | "recent";

export interface Section {
  key: SectionKey;
  rows: Row[];
}

export interface PanelInput {
  overview: Overview;
  waiting: readonly Waiting[];
  questions: readonly Question[];
  plans: readonly Plan[];
  journals: readonly Journal[];
}

export const RECENT_JOURNALS = 8;

export function panelSections(input: PanelInput, recent = RECENT_JOURNALS): Section[] {
  const out: Section[] = [];
  const claude: Row[] = [
    ...input.questions.map((q): Row => ({ kind: "question", q })),
    ...input.waiting.map((w): Row => ({ kind: "waiting", w })),
  ];
  if (claude.length > 0) out.push({ key: "claude", rows: claude });

  const o = input.overview;
  const eyes: Row[] = [
    ...o.failing.map((v): Row => ({ kind: "failing", v })),
    ...o.unproven.map((j): Row => ({ kind: "unproven", j })),
    ...o.unrecorded.map((path): Row => ({ kind: "unrecorded", path })),
  ];
  out.push({ key: "eyes", rows: eyes.length > 0 ? eyes : [{ kind: "allClear", latest: o.latest }] });

  const next = livePlans(input.plans)
    .filter((p) => p.next !== null)
    .sort((a, b) => lastTouched(b).localeCompare(lastTouched(a)))
    .map((plan): Row => ({ kind: "next", plan }));
  if (next.length > 0) out.push({ key: "next", rows: next });

  const journals = [...input.journals]
    .sort((a, b) => (b.createdAt || b.path).localeCompare(a.createdAt || a.path))
    .slice(0, recent)
    .map((j): Row => ({ kind: "journal", j }));
  if (journals.length > 0) out.push({ key: "recent", rows: journals });
  return out;
}

/** 계획이 마지막으로 움직인 때 — 방금 손댄 계획의 다음 항목이 위로 온다. */
function lastTouched(p: Plan): string {
  return p.updates.reduce((m, u) => (u.ts > m ? u.ts : m), "");
}

/** 패널 배지 — 사람이 지금 손대야 하는 것: Claude 의 질문 · 기다림 · 실패한 확인 명령. */
export function attentionCount(input: Pick<PanelInput, "overview" | "waiting" | "questions">): number {
  return input.questions.length + input.waiting.length + input.overview.failing.length;
}

/** 알림 열쇠 — 같은 기다림에 두 번 울리지 않게. 세션이 다시 기다리면(시각이 바뀌면) 새 열쇠다. */
export type Arrival = { kind: "question"; q: Question } | { kind: "waiting"; w: Waiting };

export function arrivalKey(x: Arrival): string {
  return x.kind === "question" ? `q:${x.q.id}` : `w:${x.w.sessionId}:${x.w.since}`;
}

/**
 * 새로 도착한 기다림 — `seen` 에 없던 것. `seen` 은 지금 것으로 바꿔 돌려준다(사라진 것은 잊는다).
 * 처음 부를 때(`seen === null`)는 아무것도 새것으로 치지 않는다 — 창을 열자마자 묵은 기다림에 울리지 않게.
 */
export function arrivals(
  seen: ReadonlySet<string> | null,
  waiting: readonly Waiting[],
  questions: readonly Question[],
): { fresh: Arrival[]; seen: Set<string> } {
  const all: Arrival[] = [
    ...questions.map((q) => ({ kind: "question" as const, q })),
    ...waiting.map((w) => ({ kind: "waiting" as const, w })),
  ];
  const keys = new Set(all.map(arrivalKey));
  if (seen === null) return { fresh: [], seen: keys };
  return { fresh: all.filter((x) => !seen.has(arrivalKey(x))), seen: keys };
}
