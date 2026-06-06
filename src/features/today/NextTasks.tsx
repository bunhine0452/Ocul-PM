import { ListTodo, ArrowRight, Loader } from "@/components/Icons";
import type { NextTask } from "./useNextTasks";

// Final UI Update (ui_v2) — "다음 할 일" panel. PR-R1 (A1): wired to Planner
// subtasks via useNextTasks (the PR-UI 2 placeholder is now real data). Shows
// up to 5 incomplete subtasks across open/in-progress goals; falls back to the
// empty hint + Planner link when there's nothing to do. Mockup .next-item tone.

export function NextTasks({
  tasks,
  onOpenPlanner,
}: {
  tasks: NextTask[] | null;
  onOpenPlanner: () => void;
}) {
  return (
    <div className="card">
      <div className="panel-head">
        <ListTodo size={16} color="var(--text-2)" />
        <h3>다음 할 일</h3>
        <button
          className="btn ghost sm right"
          onClick={onOpenPlanner}
          aria-label="Planner 열기"
        >
          Planner <ArrowRight size={13} />
        </button>
      </div>
      <div className="panel-body">
        {tasks == null ? (
          <div className="empty-hint" style={{ padding: "24px 16px" }}>
            불러오는 중…
          </div>
        ) : tasks.length === 0 ? (
          <div className="empty-hint" style={{ padding: "24px 16px" }}>
            Planner에서 목표와 다음 할 일을 관리하세요.
          </div>
        ) : (
          tasks.map((t) => (
            <button
              type="button"
              className="next-item"
              key={t.id}
              onClick={onOpenPlanner}
            >
              <span className={"next-check" + (t.active ? " active" : "")}>
                {t.active ? <Loader size={11} color="var(--accent)" /> : null}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="next-title">{t.title}</div>
                <div className="next-goal">{t.goalTitle}</div>
              </div>
              {t.active ? <span className="sub-active-pill">진행중</span> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
