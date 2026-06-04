import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { commands, type Goal, type Project } from "@/lib/bindings";

const PRIORITIES = [
  { value: "0", label: "보통" },
  { value: "1", label: "높음" },
  { value: "2", label: "긴급" },
];

interface GoalFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  editGoal?: Goal | null;
  onSaved: () => void;
}

export function GoalForm({
  open,
  onOpenChange,
  projects,
  editGoal,
  onSaved,
}: GoalFormProps) {
  const isEdit = !!editGoal;

  const [title, setTitle] = useState(editGoal?.title ?? "");
  const [description, setDescription] = useState(
    editGoal?.description ?? "",
  );
  const [priority, setPriority] = useState(
    String(editGoal?.priority ?? 0),
  );
  const [projectId, setProjectId] = useState<string>(
    editGoal?.project_id != null ? String(editGoal.project_id) : "none",
  );
  const [dueDate, setDueDate] = useState<string>(
    editGoal?.due_date
      ? new Date(editGoal.due_date * 1000).toISOString().slice(0, 10)
      : "",
  );
  const [status, setStatus] = useState(editGoal?.status ?? "open");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when editGoal changes
  const resetForm = () => {
    setTitle(editGoal?.title ?? "");
    setDescription(editGoal?.description ?? "");
    setPriority(String(editGoal?.priority ?? 0));
    setProjectId(
      editGoal?.project_id != null ? String(editGoal.project_id) : "none",
    );
    setDueDate(
      editGoal?.due_date
        ? new Date(editGoal.due_date * 1000).toISOString().slice(0, 10)
        : "",
    );
    setStatus(editGoal?.status ?? "open");
    setError(null);
  };

  async function handleSubmit() {
    if (!title.trim()) {
      setError("제목을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);

    const pid = projectId === "none" ? null : Number(projectId);
    const dueDateTs = dueDate
      ? Math.floor(new Date(dueDate + "T00:00:00").getTime() / 1000)
      : null;

    if (isEdit && editGoal) {
      const res = await commands.goalUpdate(
        editGoal.id,
        title,
        description || null,
        status,
        Number(priority),
        dueDateTs,
        null,
      );
      if (res.status === "error") {
        setError(res.error);
        setSaving(false);
        return;
      }
    } else {
      const res = await commands.goalCreate(
        pid,
        title,
        description || null,
        Number(priority),
        dueDateTs,
      );
      if (res.status === "error") {
        setError(res.error);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "목표 수정" : "새 목표"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="goal-title">제목</Label>
            <Input
              id="goal-title"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              placeholder="목표 제목을 입력하세요"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal-desc">설명</Label>
            <Textarea
              id="goal-desc"
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              placeholder="선택사항"
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>우선순위</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="goal-due">마감일</Label>
              <Input
                id="goal-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.currentTarget.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>프로젝트</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">없음</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isEdit && (
              <div className="space-y-1.5">
                <Label>상태</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">열림</SelectItem>
                    <SelectItem value="in_progress">진행 중</SelectItem>
                    <SelectItem value="done">완료</SelectItem>
                    <SelectItem value="cancelled">취소</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={saving}>
              취소
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "저장 중…" : isEdit ? "수정" : "생성"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
