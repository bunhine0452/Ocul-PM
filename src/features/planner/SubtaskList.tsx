import { useState, useEffect, useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { commands, type Subtask } from "@/lib/bindings";
import { X, Plus } from "@/components/Icons";


interface SubtaskListProps {
  goalId: number;
  onProgressChange?: (done: number, total: number) => void;
}

export function SubtaskList({ goalId, onProgressChange }: SubtaskListProps) {
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const res = await commands.subtaskList(goalId);
    if (res.status === "ok") {
      setSubtasks(res.data);
      const done = res.data.filter((s) => s.done).length;
      onProgressChange?.(done, res.data.length);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  async function addSubtask() {
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    const res = await commands.subtaskCreate(goalId, title);
    if (res.status === "ok") {
      setNewTitle("");
      await refresh();
      inputRef.current?.focus();
    }
    setAdding(false);
  }

  async function toggle(subtaskId: number) {
    await commands.subtaskToggle(subtaskId);
    await refresh();
  }

  async function remove(subtaskId: number) {
    await commands.subtaskDelete(subtaskId);
    await refresh();
  }

  const doneCount = subtasks.filter((s) => s.done).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium tracking-wide uppercase">
          하위 작업
        </span>
        {subtasks.length > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {doneCount}/{subtasks.length}
          </span>
        )}
      </div>

      {/* Progress micro-bar */}
      {subtasks.length > 0 && (
        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
            style={{
              width: `${(doneCount / subtasks.length) * 100}%`,
            }}
          />
        </div>
      )}

      <ul className="space-y-1">
        {subtasks.map((st) => (
          <li
            key={st.id}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
          >
            <Checkbox
              checked={st.done}
              onCheckedChange={() => toggle(st.id)}
              id={`st-${st.id}`}
            />
            <label
              htmlFor={`st-${st.id}`}
              className={`flex-1 text-sm cursor-pointer select-none transition-all ${
                st.done
                  ? "line-through text-muted-foreground opacity-60"
                  : ""
              }`}
            >
              {st.title}
            </label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity flex items-center justify-center"
              onClick={() => remove(st.id)}
              title="삭제"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          addSubtask();
        }}
        className="flex gap-1.5"
      >
        <Input
          ref={inputRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.currentTarget.value)}
          placeholder="하위 작업 추가…"
          className="h-8 text-sm"
          disabled={adding}
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!newTitle.trim() || adding}
          className="h-8 w-8 p-0 flex items-center justify-center"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
