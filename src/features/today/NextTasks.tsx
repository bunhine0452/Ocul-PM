import { ListTodo, ArrowRight, Loader } from "@/components/Icons";
import type { NextTask } from "./useTodayBrief";
import { useT } from "@/i18n";

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
  const { t } = useT();
  return (
    <div className="card">
      <div className="panel-head">
        <ListTodo size={16} color="var(--text-2)" />
        <h3>{t("today.next.title")}</h3>
        <button
          className="btn ghost sm right"
          onClick={onOpenPlanner}
          aria-label={t("today.next.open")}
        >
          Planner <ArrowRight size={13} />
        </button>
      </div>
      <div className="panel-body">
        {tasks == null ? (
          <div className="empty-hint" style={{ padding: "24px 16px" }}>
            {t("common.loading")}
          </div>
        ) : tasks.length === 0 ? (
          <div className="empty-hint" style={{ padding: "24px 16px" }}>
            {t("today.next.empty")}
          </div>
        ) : (
          tasks.map((task) => (
            <button
              type="button"
              className="next-item"
              key={task.id}
              onClick={onOpenPlanner}
            >
              <span className={"next-check" + (task.active ? " active" : "")}>
                {task.active ? <Loader size={11} color="var(--accent)" /> : null}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="next-title">{task.title}</div>
                <div className="next-goal">{task.goalTitle}</div>
              </div>
              {task.active ? <span className="sub-active-pill">{t("today.next.active")}</span> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
