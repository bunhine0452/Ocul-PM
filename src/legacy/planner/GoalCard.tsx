import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { commands, type Goal, type Project } from "@/lib/bindings";
import { SubtaskList } from "./SubtaskList";
import {
  Play,
  Check,
  Undo,
  Pencil,
  Trash2,
  Folder,
  Calendar,
  ChevronDown,
  ChevronUpIcon,
  ArrowUp,
  Flame
} from "@/components/Icons";

const STATUS_META: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  open: { label: "열림", variant: "outline" },
  in_progress: { label: "진행 중", variant: "default" },
  done: { label: "완료", variant: "secondary" },
  cancelled: { label: "취소", variant: "destructive" },
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
            {goal.priority === 1 && (
              <span className="flex items-center gap-0.5 text-[10px] h-5 font-medium text-orange-600 bg-orange-50 dark:bg-orange-950/30 px-1.5 py-0.5 rounded border border-orange-200/50 dark:border-orange-900/30">
                <ArrowUp className="w-2.5 h-2.5 text-orange-500" strokeWidth={2.5} />
                <span>높음</span>
              </span>
            )}
            {goal.priority === 2 && (
              <span className="flex items-center gap-0.5 text-[10px] h-5 font-medium text-destructive bg-destructive/5 dark:bg-destructive/10 px-1.5 py-0.5 rounded border border-destructive/15">
                <Flame className="w-2.5 h-2.5 text-destructive animate-pulse" strokeWidth={2.5} />
                <span>긴급</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
            {project && (
              <span className="flex items-center gap-1 font-mono truncate max-w-32">
                <Folder className="w-3 h-3 text-muted-foreground/75" />
                {project.name}
              </span>
            )}
            {goal.due_date && (
              <span className={`flex items-center gap-1 ${overdue ? "text-destructive font-medium" : ""}`}>
                <Calendar className="w-3 h-3 text-muted-foreground/75" />
                {formatDate(goal.due_date)}
                {overdue && " (지남)"}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:bg-muted"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "접기" : "펼치기"}
          >
            {expanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
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
                className="h-7 text-xs flex items-center gap-1 px-2.5"
                onClick={() => quickStatus("in_progress")}
              >
                <Play className="w-3 h-3 text-muted-foreground" />
                <span>시작</span>
              </Button>
            )}
            {goal.status !== "done" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs flex items-center gap-1 px-2.5"
                onClick={() => quickStatus("done")}
              >
                <Check className="w-3 h-3 text-emerald-500" />
                <span>완료</span>
              </Button>
            )}
            {goal.status === "done" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs flex items-center gap-1 px-2.5"
                onClick={() => quickStatus("open")}
              >
                <Undo className="w-3 h-3 text-blue-500" />
                <span>재개</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs flex items-center gap-1 px-2"
              onClick={() => onEdit(goal)}
            >
              <Pencil className="w-3 h-3 text-muted-foreground" />
              <span>수정</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive flex items-center gap-1 px-2"
              onClick={handleDelete}
            >
              <Trash2 className="w-3 h-3 text-destructive" />
              <span>삭제</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
