// 예외만 — 상태 표시줄과 「지금 볼 것」이 쓰는 순수 모델 (앱의 「예외만 보여 준다」와 같은 원칙).

import { COMMAND } from "./evidence";
import type { Journal } from "./journal";
import type { Plan, Verdict } from "./plan";

export type PlanVerdict = Verdict & { plan: Plan };

export interface Overview {
  /** 살아 있는 계획들 중 가장 새 판정. */
  latest: PlanVerdict | null;
  /** 마지막 판정이 ✗ 인 계획 — 새것이 위. */
  failing: PlanVerdict[];
  /** 지금 바뀐 파일 중 어느 일지에도 없는 것. */
  unrecorded: string[];
  /** 오늘 일지 중 검증 칸에 돌린 명령이 없는 것. */
  unproven: Journal[];
}

const CLOSED = new Set(["done", "archived", "dropped"]);

export function livePlans(plans: readonly Plan[]): Plan[] {
  return plans.filter((p) => !CLOSED.has(p.status));
}

/** 바뀐 파일 중 어느 일지의 `files_touched` 에도 없는 것 — 기록 폴더 자신은 뺀다 (`git::receipt`). */
export function unrecordedOf(changed: readonly string[], journals: readonly Journal[]): string[] {
  const recorded = new Set(journals.flatMap((j) => j.files));
  return changed.filter((p) => !p.startsWith(".oculpm/") && !recorded.has(p));
}

/** 이 파일을 건드린 일지 — 새것이 위. */
export function journalsForFile(path: string, journals: readonly Journal[]): Journal[] {
  return journals.filter((j) => j.files.includes(path)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 일지의 날짜 폴더(`20261102/…`)가 오늘인가 — 작업일은 폴더가 정한다. */
export function isOn(journal: Journal, day: string): boolean {
  return journal.path.startsWith(`${day}/`);
}

export function overview(
  plans: readonly Plan[],
  journals: readonly Journal[],
  changed: readonly string[],
  today: string,
): Overview {
  const judged: PlanVerdict[] = livePlans(plans)
    .filter((p) => p.verdict !== null)
    .map((p) => ({ ...(p.verdict as Verdict), plan: p }))
    .sort((a, b) => b.ts.localeCompare(a.ts));
  return {
    latest: judged[0] ?? null,
    failing: judged.filter((v) => !v.passed),
    unrecorded: unrecordedOf(changed, journals),
    unproven: journals.filter((j) => isOn(j, today) && j.evidence < COMMAND),
  };
}

/** `YYYYMMDD` — 로컬 달력 (일지 폴더와 같은 형식). */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
