// 팝오버가 프로젝트 하나를 그리는 데 필요한 스냅숏 — 상태·세션·일지·활성 플랜.
// `TrayPopover` 에서 떼어 낸 이유는 파일 크기 래칫이지만, 순수 데이터 조립이라
// 화면과 따로 있는 편이 읽기에도 맞다.

import { oculpmApi } from "@/api/oculpm";
import { planApi } from "@/api/plan";
import type { JournalEntrySummary, PlanSummary, Session } from "@/lib/bindings";

/** 한 조각의 실패는 그 조각만 비운다 — 팝오버는 나머지로 계속 답한다. */
const orElse = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

export interface ActivePlan {
  summary: PlanSummary;
  /** 진행중 우선, 없으면 첫 todo — "다음 할 일" 1줄. */
  next: string | null;
}

export interface ProjectSnapshot {
  id: number;
  name: string;
  rootPath: string;
  workday: string | null;
  sessions: Session[];
  entries: JournalEntrySummary[];
  plans: ActivePlan[];
}

export async function loadProject(p: {
  id: number;
  name: string;
  root_path: string;
}): Promise<ProjectSnapshot> {
  const [status, sessions, entries, plans] = await Promise.all([
    orElse(oculpmApi.getStatus(p.id), null),
    orElse(oculpmApi.listSessions(p.id), []),
    orElse(oculpmApi.listJournalEntries(p.id), []),
    orElse(planApi.list(p.id), []),
  ]);
  // 활성 플랜(표시 상한 2)은 항목까지 당겨 "다음 할 일"을 계산한다.
  const active = plans.filter((x) => x.status === "active");
  const enriched: ActivePlan[] = await Promise.all(
    active.slice(0, 2).map(async (summary) => {
      const d = await orElse(planApi.get(p.id, summary.plan_id), null);
      let next: string | null = null;
      if (d) {
        const items = [...d.items].sort((a, b) => a.order_idx - b.order_idx);
        next =
          (items.find((i) => i.status === "in_progress") ??
            items.find((i) => i.status === "todo"))?.title ?? null;
      }
      return { summary, next };
    }),
  );
  return {
    id: p.id,
    name: p.name,
    rootPath: p.root_path,
    workday: status?.current_workday ?? null,
    sessions,
    entries,
    plans: enriched,
  };
}
