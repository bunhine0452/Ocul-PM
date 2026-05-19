import { useState, useEffect, useCallback } from "react";
import { commands, type Goal, type Subtask } from "@/lib/bindings";

export function useGoals(projectId: number | null, statusFilter: string | null) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await commands.goalList(
      projectId ?? null,
      statusFilter ?? null,
    );
    if (res.status === "ok") setGoals(res.data);
    setLoading(false);
  }, [projectId, statusFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { goals, loading, refresh };
}

export function useSubtasks(goalId: number | null) {
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);

  const refresh = useCallback(async () => {
    if (goalId == null) {
      setSubtasks([]);
      return;
    }
    const res = await commands.subtaskList(goalId);
    if (res.status === "ok") setSubtasks(res.data);
  }, [goalId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { subtasks, refresh };
}
