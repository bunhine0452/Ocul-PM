import { useCallback, useEffect, useState } from "react";
import { commands } from "@/lib/bindings";

// Today "다음 할 일" block. S1 / planner-unify (2026-06-22): now reads the
// FILE-BASED plan (`.oculpm/planner/*.md` via plan_list/plan_get) — the same
// SSOT the Planner screen uses — instead of the retired SQLite goals/subtasks
// sink. Collects up to N incomplete items from active plans (in-progress
// first). Best-effort: a planner read error never breaks Today.

export interface NextTask {
  /** Stable React key: `<plan_id>:<item_id>` (item ids only unique per plan). */
  id: string;
  title: string;
  /** The item's phase, else its plan title — context for the row. */
  goalTitle: string;
  /** Item is in progress (drives the spinner + 진행중 pill). */
  active: boolean;
}

const MAX_TASKS = 5;

export function useNextTasks(projectId: number) {
  const [tasks, setTasks] = useState<NextTask[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const pl = await commands.planList(projectId);
      if (pl.status === "error") {
        setTasks([]);
        return;
      }
      // Active plans with remaining work, mirroring the Planner screen's SSOT.
      const plans = pl.data.filter(
        (p) => p.status === "active" && p.done_count < p.item_count,
      );
      const collected: NextTask[] = [];
      for (const p of plans) {
        if (collected.length >= MAX_TASKS) break;
        const dr = await commands.planGet(projectId, p.plan_id);
        if (dr.status !== "ok" || !dr.data) continue;
        const items = dr.data.items
          .filter((it) => it.status !== "done")
          .sort(
            (a, b) =>
              (b.status === "in_progress" ? 1 : 0) -
                (a.status === "in_progress" ? 1 : 0) ||
              a.order_idx - b.order_idx,
          );
        for (const it of items) {
          if (collected.length >= MAX_TASKS) break;
          collected.push({
            id: `${p.plan_id}:${it.item_id}`,
            title: it.title,
            goalTitle: it.phase ?? p.title,
            active: it.status === "in_progress",
          });
        }
      }
      setTasks(collected);
    } catch {
      // Planner backend absence/error must not break Today (best-effort).
      setTasks([]);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { tasks, refresh };
}
