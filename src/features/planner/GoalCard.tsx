import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { commands, type Goal, type Project } from "@/lib/bindings";
import { SubtaskList } from "./SubtaskList";

const STATUS_META: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  open: { label: "열림", variant: "outline" },
  in_progress: { label: "진행 중", variant: "default" },
  done: { label: "완료", variant: "secondary" },
  cancelled: { label: "취소", variant: "destructive" },
};

const PRIORITY_LABEL: Record<number, string> = {
  0: "",
  1: "🔺 높음",
  2: "🔥 긴급",
};

function formatDate(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
}

function isOverdue(goal: Goal): boolean {
  if (!goal.due_date) return false;
  if (goal.status === "done" || goal.status === "cancelled") return false;
  const now = Math.floor(Date.now() / 1000);
  return goal.due_date < now;
}

interface GoalCardProps {
  goal: Goal;
  projects: Project[];
  onEdit: (goal: Goal) => void;
  onRefresh: () => void;
}

export function GoalCard({ goal, projects, onEdit, onRefresh }: GoalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState(goal.progress ?? 0);
  const meta = STATUS_META[goal.status] ?? STATUS_META.open;
  const project = projects.find((p) => p.id === goal.project_id);
  const overdue = isOverdue(goal);

  async function quickStatus(status: string) {
    const p = status === "done" ? 1.0 : status === "cancelled" ? 0 : null;
    await commands.goalUpdate(goal.id, null, null, status, null, null, p);
    onRefresh();
  }

  async function handleDelete() {
    if (!confirm(`"${goal.title}" 목표를 삭제할까요?`)) return;
    await commands.goalDelete(goal.id);
    onRefresh();
  }

  function handleSubtaskProgress(done: number, total: number) {
    if (total === 0) return;
    const p = done / total;
    if (Math.abs(p - (progress ?? 0)) > 0.01) {
      setProgress(p);
      commands.goalUpdate(goal.id, null, null, null, null, null, p);
    }
  }

  return (
    <div
      className={`rounded-lg border bg-card p-4 space-y-3 transition-all hover:shadow-md ${
        overdue ? "border-destructive/50" : ""
      } ${goal.status === "done" ? "opacity-70" : ""}`}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className={`font-semibold text-sm leading-snug ${
                goal.status === "done" ? "line-through text-muted-foreground" : ""
              }`}
            >
              {goal.title}
            </h3>
            <Badge variant={meta.variant} className="text-[10px] h-5">
              {meta.label}
            </Badge>
            {PRIORITY_LABEL[goal.priority] && (
              <span className="text-[11px]">
                {PRIORITY_LABEL[goal.priority]}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
            {project && (
              <span className="font-mono truncate max-w-32">
                📁 {project.name}
              </span>
            )}
            {goal.due_date && (
              <span className={overdue ? "text-destructive font-medium" : ""}>
                📅 {formatDate(goal.due_date)}
                {overdue && " (지남)"}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "접기" : "펼치기"}
          >
            {expanded ? "▲" : "▼"}
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <Progress value={(progress ?? 0) * 100} className="h-1.5" />

      {/* Description */}
      {goal.description && !expanded && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {goal.description}
        </p>
      )}

      {/* Expanded section */}
      {expanded && (
        <div className="space-y-3 pt-1">
          {goal.description && (
            <p className="text-sm text-foreground/80 whitespace-pre-wrap">
              {goal.description}
            </p>
          )}

          <SubtaskList
            goalId={goal.id}
            onProgressChange={handleSubtaskProgress}
          />

          {/* Quick actions */}
          <div className="flex flex-wrap gap-1.5 pt-1 border-t">
            {goal.status !== "in_progress" && goal.status !== "done" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => quickStatus("in_progress")}
              >
                ▶ 시작
              </Button>
            )}
            {goal.status !== "done" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => quickStatus("done")}
              >
                ✓ 완료
              </Button>
            )}
            {goal.status === "done" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => quickStatus("open")}
              >
                ↩ 재개
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onEdit(goal)}
            >
              ✏️ 수정
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              🗑 삭제
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
