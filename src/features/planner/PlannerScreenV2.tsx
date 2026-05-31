import { useCallback, useEffect, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  TargetIcon,
  Calendar,
  ChevronDown,
  ChevronRight,
  Plus,
  Filter,
  CheckMark,
  NotebookText,
  TriangleAlert,
} from "@/components/Icons";
import { commands, type Goal, type Subtask } from "@/lib/bindings";
import { useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { toast } from "@/lib/toast";

// Final UI Update (ui_v2) — Planner 화면 (02-screen-specs §4). Real data via the
// existing goalList / subtaskList / subtaskToggle commands (Decision F — no new
// backend). Mockup .goal-card / .subtask visuals. flag-off PlannerPanel
// untouched. goal expand state persists in WorkspaceContext.plannerOpen.

function dueLabel(due: number | null): string | null {
  if (due == null) return null;
  // due_date is a unix day or seconds; render as a local date.
  const d = new Date(due > 1e11 ? due : due * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

interface PlannerScreenV2Props {
  projectId: number;
  onNavigate: (view: UiV2View) => void;
}

export function PlannerScreenV2({ projectId, onNavigate }: PlannerScreenV2Props) {
  const { state, setState } = useWorkspace();
  const open = state.plannerOpen;

  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [subtasks, setSubtasks] = useState<Record<number, Subtask[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    const res = await commands.goalList(projectId, null);
    if (res.status === "error") {
      setError(res.error);
      setGoals([]);
      return;
    }
    setGoals(res.data);
    // Load subtasks for each goal (small N — one project's goals).
    const entries = await Promise.all(
      res.data.map(async (g) => {
        const sr = await commands.subtaskList(g.id);
        return [g.id, sr.status === "ok" ? sr.data : []] as const;
      }),
    );
    setSubtasks(Object.fromEntries(entries));
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleOpen = (goalId: number) =>
    setState((prev) => ({
      ...prev,
      plannerOpen: { ...prev.plannerOpen, [goalId]: !prev.plannerOpen[goalId] },
    }));

  const onToggleSubtask = async (subtaskId: number) => {
    // Optimistic flip, resync on failure.
    setSubtasks((prev) => {
      const next: Record<number, Subtask[]> = {};
      for (const [gid, list] of Object.entries(prev)) {
        next[Number(gid)] = list.map((s) =>
          s.id === subtaskId ? { ...s, done: !s.done } : s,
        );
      }
      return next;
    });
    const res = await commands.subtaskToggle(subtaskId);
    if (res.status === "error") {
      toast.destructive(`서브태스크 갱신 실패: ${res.error}`);
      void refresh();
    }
  };

  const isActive = (g: Goal) =>
    g.status === "open" || g.status === "in_progress" || g.status === "active";
  const visibleGoals = (goals ?? []).filter((g) => !activeOnly || isActive(g));

  return (
    <>
      <Toolbar title="Planner" sub="goal → subtask → 작업 일지로 자동 연결">
        <button
          type="button"
          className={"scope-chip" + (activeOnly ? " on" : "")}
          style={{ height: 30 }}
          onClick={() => setActiveOnly((v) => !v)}
        >
          <Filter size={13} /> 진행중
        </button>
        <button className="btn primary" disabled title="새 목표 (PR-UI 6 모달)">
          <Plus size={15} /> 새 목표
        </button>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in" style={{ maxWidth: 880 }}>
          {error ? (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div className="stat-top" style={{ color: "var(--t-bug)" }}>
                <TriangleAlert size={14} /> 목표를 불러오지 못했어요
              </div>
              <div className="today-date" style={{ marginTop: 8 }}>{error}</div>
              <button className="btn sm" style={{ marginTop: 12 }} onClick={() => void refresh()}>
                다시 시도
              </button>
            </div>
          ) : null}

          {goals == null ? (
            <div className="empty-hint">불러오는 중…</div>
          ) : visibleGoals.length === 0 ? (
            <div className="empty-hint">
              {activeOnly ? "진행중인 목표가 없어요." : "첫 목표를 만들어보세요."}
            </div>
          ) : (
            visibleGoals.map((g) => {
              const subs = subtasks[g.id] ?? [];
              const doneCount = subs.filter((s) => s.done).length;
              const isOpen = open[g.id] ?? isActive(g);
              const progress =
                g.progress != null
                  ? Math.round(g.progress * 100)
                  : subs.length > 0
                    ? Math.round((doneCount / subs.length) * 100)
                    : 0;
              const due = dueLabel(g.due_date);
              return (
                <div className="card goal-card" key={g.id}>
                  <button
                    type="button"
                    className="goal-head"
                    onClick={() => toggleOpen(g.id)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? (
                      <ChevronDown size={16} color="var(--text-3)" />
                    ) : (
                      <ChevronRight size={16} color="var(--text-3)" />
                    )}
                    <TargetIcon
                      size={17}
                      color={isActive(g) ? "var(--accent)" : "var(--text-3)"}
                    />
                    <div>
                      <div className="goal-title">{g.title}</div>
                      <div className="goal-due" style={{ marginTop: 3 }}>
                        {due ? (
                          <>
                            <Calendar size={12} /> 마감 {due}
                            <span className="dotsep">·</span>
                          </>
                        ) : null}
                        {doneCount}/{subs.length} 완료
                      </div>
                    </div>
                    <div className="goal-prog-wrap">
                      <span className={"goal-status " + (isActive(g) ? "active" : "planned")}>
                        {isActive(g) ? "진행중" : "예정"}
                      </span>
                      <div className="prog-track">
                        <i style={{ width: `${progress}%` }} />
                      </div>
                      <span className="prog-pct">{progress}%</span>
                    </div>
                  </button>

                  {isOpen
                    ? subs.map((s) => (
                        <button
                          type="button"
                          className="subtask"
                          key={s.id}
                          onClick={() => void onToggleSubtask(s.id)}
                        >
                          <span className={"sub-check" + (s.done ? " done" : "")}>
                            {s.done ? <CheckMark size={12} strokeWidth={3} /> : null}
                          </span>
                          <span className={"sub-title" + (s.done ? " done" : "")}>
                            {s.title}
                          </span>
                          <span
                            className="sub-entries"
                            title="연결된 작업 일지"
                            onClick={(e) => {
                              e.stopPropagation();
                              onNavigate("journal");
                            }}
                          >
                            <NotebookText size={13} /> 일지
                          </span>
                        </button>
                      ))
                    : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
