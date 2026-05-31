import { ListTodo, ArrowRight } from "@/components/Icons";

// Final UI Update (ui_v2) — "다음 할 일" panel. PR-UI 2 decision (§0.8): the
// Planner subtask wiring lands in PR-UI 5, so this block shows an empty hint +
// a link to the Planner screen rather than fabricating tasks. The structure
// (.panel-head + .panel-body) matches the mockup so PR-UI 5 can drop real
// next-items in without a layout change.

export function NextTasks({ onOpenPlanner }: { onOpenPlanner: () => void }) {
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
        <div className="empty-hint" style={{ padding: "24px 16px" }}>
          Planner에서 목표와 다음 할 일을 관리하세요.
        </div>
      </div>
    </div>
  );
}
