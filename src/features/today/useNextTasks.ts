import { useCallback, useEffect, useState } from "react";
import { commands } from "@/lib/bindings";

// PR-R1 (A1) — Today "다음 할 일" 블록의 실데이터.
//
// 직전 라운드(PR-UI 2 §0.8)는 이 블록을 빈 placeholder 로 두고 "Planner subtask
// 연결은 PR-UI 5 에서" 로 미뤘으나 그 연결이 누락됐다. 여기서 기존 backend
// (goalList / subtaskList — Decision F, 신규 command 없음) 로 *진행 가능한* 미완료
// subtask 상위 N 개를 프론트에서 집계한다. Planner backend 가 흔들려도 Today 가
// 깨지면 안 되므로 best-effort (실패 시 빈 목록).

export interface NextTask {
  id: number;
  title: string;
  goalTitle: string;
  /** 부모 goal 이 진행중이면 true (목업의 next-check.active + 진행중 pill). */
  active: boolean;
}

const MAX_TASKS = 5;

/** goal 이 "진행중" (subtask 가 지금 할 일) — Planner 의 isActive 와 구분: 여기선
 *  in_progress/active 만 active 로, 단순 open(예정)은 active 아님. */
function goalActive(status: string): boolean {
  return status === "in_progress" || status === "active";
}
/** goal 이 아직 열려 있어 next work 를 가짐 (완료/취소 goal 의 subtask 는 제외). */
function goalOpen(status: string): boolean {
  return status === "open" || goalActive(status);
}

export function useNextTasks(projectId: number) {
  const [tasks, setTasks] = useState<NextTask[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const gr = await commands.goalList(projectId, null);
      if (gr.status === "error") {
        setTasks([]);
        return;
      }
      // 진행중 goal 먼저 (그 안의 subtask 가 가장 임박한 할 일). 그 외 backend
      // 순서 보존 (Array.sort 는 V8 에서 stable).
      const goals = gr.data
        .filter((g) => goalOpen(g.status))
        .sort((a, b) => (goalActive(b.status) ? 1 : 0) - (goalActive(a.status) ? 1 : 0));

      const collected: NextTask[] = [];
      for (const g of goals) {
        if (collected.length >= MAX_TASKS) break;
        const sr = await commands.subtaskList(g.id);
        if (sr.status !== "ok") continue;
        const incomplete = [...sr.data]
          .filter((s) => !s.done)
          .sort((a, b) => a.sort_order - b.sort_order);
        for (const s of incomplete) {
          if (collected.length >= MAX_TASKS) break;
          collected.push({
            id: s.id,
            title: s.title,
            goalTitle: g.title,
            active: goalActive(g.status),
          });
        }
      }
      setTasks(collected);
    } catch {
      // Planner backend 부재/오류는 Today 를 깨지 않는다 (best-effort).
      setTasks([]);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { tasks, refresh };
}
