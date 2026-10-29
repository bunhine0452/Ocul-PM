/**
 * 오늘 화면의 판정 — React 없이, 같은 입력이면 같은 답 (4.0 `{#ui-today}`).
 *
 * 원칙은 하나다: **예외만 보여 준다.** 화면의 크기는 에이전트가 한 양이 아니라 사람이 볼
 * 것에 비례한다. 하루 60건이든 3건이든 같은 규칙이 돌고, 모드는 없다.
 *
 * 「확인할 것」의 종류와 순서(심각도)는 여기서만 정한다 — 화면과 사이드바 배지가 같은
 * 목록을 센다 (`useTodayExceptions`).
 */

import type {
  DigestItem,
  DigestPlan,
  JournalEntrySummary,
  JournalMissingSignal,
  PlanVerdict,
  TermInfo,
  TodayDigest,
} from "@/lib/bindings";

/** 검증 칸 증거 등급 「명령」 — `oculpm::evidence::COMMAND`. 이 등급이어야 바깥 심판이다. */
export const EVIDENCE_COMMAND = 2;

/** 증거를 요구하는 종류 — 백엔드 `JournalScore`(증거 비율의 분모)와 같은 셋. */
const JUDGED_TYPES = new Set<string>(["bug", "feature", "refactor"]);

/**
 * 일지 하나의 증거 상태.
 * - `command`  검증 칸에 돌린 명령의 흔적이 있다 (바깥 심판).
 * - `verified` 사람이 「확인함」을 눌렀고 그 뒤 본문이 안 바뀌었다.
 * - `missing`  증거를 요구하는 종류인데 둘 다 없다 → 확인할 것.
 * - `none`     증거를 요구하지 않는 종류(에러 사이클·잡일)에 증거가 없다 — 예외가 아니다.
 */
export type EvidenceState = "command" | "verified" | "missing" | "none";

export function evidenceOf(e: JournalEntrySummary): EvidenceState {
  if (e.evidence >= EVIDENCE_COMMAND) return "command";
  // 확인 뒤 본문이 바뀐 일지는 더는 확인된 것으로 세지 않는다 (백엔드 `verified_stale`).
  if (e.verified_by_user && !e.verified_stale) return "verified";
  return JUDGED_TYPES.has(e.type) ? "missing" : "none";
}

/** 「확인할 것」 한 행. 심각도 순서는 `EXCEPTION_ORDER`. */
export type TodayException =
  | { kind: "waiting"; key: string; session: TermInfo }
  | { kind: "verdict"; key: string; plan: DigestPlan; verdict: PlanVerdict }
  | { kind: "evidence"; key: string; entry: JournalEntrySummary }
  | { kind: "unrecorded"; key: string; files: string[] }
  | { kind: "silent"; key: string; signals: JournalMissingSignal[] }
  | { kind: "blocked"; key: string; planId: string; planTitle: string; items: DigestItem[] }
  | { kind: "decision"; key: string; planId: string; planTitle: string; items: DigestItem[] }
  | { kind: "plugin"; key: string; installed: string; bundled: string };

export type ExceptionKind = TodayException["kind"];

/** 심각도 — 내 손을 기다리는 Claude 가 맨 위(지금 멈춰 있다), 플러그인 새 판이 맨 아래. */
export const EXCEPTION_ORDER: readonly ExceptionKind[] = [
  "waiting",
  "verdict",
  "evidence",
  "unrecorded",
  "silent",
  "blocked",
  "decision",
  "plugin",
];

export interface ExceptionInput {
  /** 오늘 일지, 최신 먼저. */
  entries: readonly JournalEntrySummary[];
  digest: TodayDigest;
  /** 오늘 바뀌었는데 어느 일지에도 없는 파일. `null` = 모름(못 읽음). */
  unrecorded: readonly string[] | null;
  /** 오늘 일지 없이 끝난 대화 신호. `null` = 모름. */
  silent: readonly JournalMissingSignal[] | null;
  /** 깔린 플러그인이 앱의 판보다 낮을 때만. */
  plugin: { installed: string; bundled: string } | null;
  /** 방금 「확인함」을 눌러 응답을 기다리는 일지 — 다시 읽기 전에 목록에서 뺀다. */
  verifiedLocally?: ReadonlySet<string>;
  /** 이 창의 터미널 세션 — 안의 프로그램이 내 손을 기다리는 것만 줄이 된다(OSC 7501 blocked). */
  terms?: readonly TermInfo[];
}

/** 같은 계획의 항목끼리 — 사람 몫이 열 개여도 계획마다 한 행이다. 순서는 처음 본 순서. */
function byPlan(items: readonly DigestItem[]): DigestItem[][] {
  const map = new Map<string, DigestItem[]>();
  for (const it of items) {
    const list = map.get(it.plan_id);
    if (list) list.push(it);
    else map.set(it.plan_id, [it]);
  }
  return [...map.values()];
}

export function buildExceptions(input: ExceptionInput): TodayException[] {
  const out: TodayException[] = [];
  for (const session of input.terms ?? []) {
    if (session.alive && session.status?.state === "blocked") {
      out.push({ kind: "waiting", key: `waiting:${session.id}`, session });
    }
  }
  for (const plan of input.digest.plans) {
    if (plan.last_verdict && !plan.last_verdict.passed) {
      out.push({ kind: "verdict", key: `verdict:${plan.plan_id}`, plan, verdict: plan.last_verdict });
    }
  }
  for (const entry of input.entries) {
    if (input.verifiedLocally?.has(entry.relative_path)) continue;
    if (evidenceOf(entry) === "missing") {
      out.push({ kind: "evidence", key: `evidence:${entry.relative_path}`, entry });
    }
  }
  if (input.unrecorded && input.unrecorded.length > 0) {
    out.push({ kind: "unrecorded", key: "unrecorded", files: [...input.unrecorded] });
  }
  if (input.silent && input.silent.length > 0) {
    out.push({ kind: "silent", key: "silent", signals: [...input.silent] });
  }
  for (const items of byPlan(input.digest.blocked)) {
    const first = items[0];
    out.push({ kind: "blocked", key: `blocked:${first.plan_id}`, planId: first.plan_id, planTitle: first.plan_title, items });
  }
  for (const items of byPlan(input.digest.needs_user)) {
    const first = items[0];
    out.push({ kind: "decision", key: `decision:${first.plan_id}`, planId: first.plan_id, planTitle: first.plan_title, items });
  }
  if (input.plugin) {
    out.push({ kind: "plugin", key: "plugin", installed: input.plugin.installed, bundled: input.plugin.bundled });
  }
  return out;
}

type ExceptionOf<K extends ExceptionKind> = Extract<TodayException, { kind: K }>;

/**
 * 오늘 화면의 세 자리 (화면 검사 {#today-split} · {#today-mine}).
 * - `first`  먼저 볼 것 — 지금 손댈 것(실패 · 일지 없는 변경 · 일지 없이 끝난 대화 · 막힘 · 플러그인).
 * - `unread` 검증 없이 끝난 일지 — 한 묶음, 읽음 버튼 하나.
 * - `mine`   내 차례 — 계획에 적힌 사람 몫. 날마다 바뀌는 일이 아니라 한 줄 링크로만 선다.
 * `rows` 는 화면에 보이는 순서(first → unread)다 — j/k 이동이 따른다. 배지는 `first` 만 센다.
 */
export interface TodaySplit {
  first: TodayException[];
  unread: ExceptionOf<"evidence">[];
  mine: ExceptionOf<"decision">[];
  rows: TodayException[];
}

export function splitExceptions(list: readonly TodayException[]): TodaySplit {
  const first: TodayException[] = [];
  const unread: ExceptionOf<"evidence">[] = [];
  const mine: ExceptionOf<"decision">[] = [];
  for (const ex of list) {
    if (ex.kind === "evidence") unread.push(ex);
    else if (ex.kind === "decision") mine.push(ex);
    else first.push(ex);
  }
  return { first, unread, mine, rows: [...first, ...unread] };
}

/** plan-log 의 일지 열(`.oculpm/` 기준)을 일지 화면의 경로(일지 루트 기준)로. */
export function normalizeJournalRef(ref: string): string {
  return ref.replace(/^\.oculpm\//, "").replace(/^journal\//, "");
}

export interface EvidenceCounts {
  command: number;
  verified: number;
  missing: number;
  none: number;
}

function countEvidence(entries: readonly JournalEntrySummary[]): EvidenceCounts {
  const c: EvidenceCounts = { command: 0, verified: 0, missing: 0, none: 0 };
  for (const e of entries) c[evidenceOf(e)] += 1;
  return c;
}

export interface WorkGroup {
  /** 계획 id, 계획 밖이면 `OUTSIDE`. */
  key: string;
  planId: string | null;
  /** `null` = 「계획 밖」. */
  title: string | null;
  entries: JournalEntrySummary[];
  counts: EvidenceCounts;
}

export const OUTSIDE = "__outside__";

/**
 * 오늘 일지를 계획별로. 열쇠는 plan-log 의 일지 열(`digest.journal_plan`)이고, 한 일지가
 * 계획 둘에 걸리면 먼저 나온(최근 갱신) 계획에 둔다. 묶음 순서는 계획 순서, 「계획 밖」은 끝.
 */
export function groupByPlan(entries: readonly JournalEntrySummary[], digest: TodayDigest): WorkGroup[] {
  const planOf = new Map<string, { id: string; title: string }>();
  for (const link of digest.journal_plan) {
    const path = normalizeJournalRef(link.journal_ref);
    if (!planOf.has(path)) planOf.set(path, { id: link.plan_id, title: link.plan_title });
  }
  const groups = new Map<string, WorkGroup>();
  const order = digest.plans.map((p) => p.plan_id);
  for (const e of entries) {
    const plan = planOf.get(e.relative_path);
    const key = plan ? plan.id : OUTSIDE;
    let g = groups.get(key);
    if (!g) {
      g = { key, planId: plan?.id ?? null, title: plan?.title ?? null, entries: [], counts: { command: 0, verified: 0, missing: 0, none: 0 } };
      groups.set(key, g);
    }
    g.entries.push(e);
  }
  for (const g of groups.values()) g.counts = countEvidence(g.entries);
  const rank = (k: string) => (k === OUTSIDE ? Number.MAX_SAFE_INTEGER : order.indexOf(k) < 0 ? order.length : order.indexOf(k));
  return [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key));
}

/**
 * 이만큼 이하면 다 보여 준다 — 3건 쓰는 사람에게 접힘은 클릭 하나를 더 시킬 뿐이다.
 * 이보다 많으면 묶음은 머리 한 줄로 접힌다. 검증 없는 일지는 위 「검증 없이 끝난 일지」 칸이
 * 이미 보여 주므로 여기서 다시 펼치지 않는다 — 같은 행이 두 번 섰다 (화면 검사 {#today-split}).
 */
export const FOLD_MIN = 8;

/** 묶음의 처음 모양 — 다 보임 / 머리 한 줄. */
export type GroupFold = "open" | "closed";

export function initialFold(totalToday: number): GroupFold {
  return totalToday <= FOLD_MIN ? "open" : "closed";
}

/** 다음에 잡을 것 — 최근 갱신된 계획부터 첫 `next`. */
export function firstNext(digest: TodayDigest | null): { plan: DigestPlan; item: DigestItem } | null {
  for (const plan of digest?.plans ?? []) {
    if (plan.next) return { plan, item: plan.next };
  }
  return null;
}

/** 워크데이(YYYYMMDD)의 로컬 자정 — 「오늘」 신호를 거르는 바닥. */
export function workdayStartMs(workday: string): number {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6)) - 1;
  const d = Number(workday.slice(6, 8));
  return new Date(y, m, d).getTime();
}
