import { useEffect, useState } from "react";
import { commands } from "@/lib/bindings";
import { Button } from "@/components/ui/button";

// Shared planner-action machinery (Group B Stage 2 — 어시스턴트화).
//
// Extracted from ChatPanel so the main fullscreen AiPanelScreenV2 can also
// propose planner actions: the assistant appends a ```json:action block, we
// surface it as an approve-card, and applying it writes to the planner. The
// apply-state lives in the SQLite `conversation_actions` table so a re-opened
// thread shows already-applied proposals as done.
//
// (The one-time localStorage→SQLite migration stays in ChatPanel — it only
// needs to run once and ChatPanel already runs it on mount.)

export interface PlannerAction {
  type: "create_goal" | "update_goal" | "delete_goal" | "create_subtasks" | "toggle_subtask" | "delete_subtask";
  title?: string;
  description?: string;
  priority?: number;
  due_date?: string; // YYYY-MM-DD
  subtasks?: string[];
  goal_id?: number;
  subtask_id?: number;
  status?: string;
}

/** Pull a trailing ```json:action block out of an assistant message, returning
 *  the prose with the block stripped + the parsed action (or null). */
export function extractPlannerAction(text: string): { cleanText: string; action: PlannerAction | null } {
  const match = text.match(/```json:action\s*([\s\S]*?)\s*```/);
  if (!match) {
    return { cleanText: text, action: null };
  }
  const cleanText = text.replace(/```json:action\s*[\s\S]*?\s*```/, "").trim();
  try {
    const action = JSON.parse(match[1]) as PlannerAction;
    return { cleanText, action };
  } catch (e) {
    console.error("Failed to parse json:action block", e);
    return { cleanText: text, action: null };
  }
}

/** System-prompt fragment teaching the model the json:action protocol. Injected
 *  when planner context is attached so the assistant can propose changes. */
export function buildActionInstruction(): string {
  return [
    "### Interactive Planner Actions:",
    "If the user asks to create, update, or delete a goal or subtask, or if you propose doing so, you MUST append a markdown code block with the language `json:action` AT the end of your response.",
    "Do NOT invoke database commands directly. Instead, output the instruction so the user can review and approve it.",
    "",
    "Format for creating a goal (priority: 0=Normal, 1=High, 2=Urgent):",
    "```json:action",
    "{",
    "  \"type\": \"create_goal\",",
    "  \"title\": \"Goal Title\",",
    "  \"description\": \"Goal Description (optional)\",",
    "  \"priority\": 0 | 1 | 2,",
    "  \"due_date\": \"YYYY-MM-DD\" (optional),",
    "  \"subtasks\": [\"Subtask 1\", \"Subtask 2\"] (optional)",
    "}",
    "```",
    "",
    "Format for updating a goal's properties:",
    "```json:action",
    "{",
    "  \"type\": \"update_goal\",",
    "  \"goal_id\": number,",
    "  \"title\": \"New Title (optional)\",",
    "  \"description\": \"New Description (optional)\",",
    "  \"status\": \"open\" | \"in_progress\" | \"done\" | \"cancelled\" (optional),",
    "  \"priority\": 0 | 1 | 2 (optional),",
    "  \"due_date\": \"YYYY-MM-DD\" (optional)",
    "}",
    "```",
    "",
    "Format for deleting a goal:",
    "```json:action",
    "{",
    "  \"type\": \"delete_goal\",",
    "  \"goal_id\": number",
    "}",
    "```",
    "",
    "Format for adding subtasks to a goal:",
    "```json:action",
    "{",
    "  \"type\": \"create_subtasks\",",
    "  \"goal_id\": number,",
    "  \"subtasks\": [\"Subtask 1\", \"Subtask 2\"]",
    "}",
    "```",
    "",
    "Format for toggling a subtask's completion status:",
    "```json:action",
    "{",
    "  \"type\": \"toggle_subtask\",",
    "  \"subtask_id\": number",
    "}",
    "```",
    "",
    "Format for deleting a subtask:",
    "```json:action",
    "{",
    "  \"type\": \"delete_subtask\",",
    "  \"subtask_id\": number",
    "}",
    "```",
    "Ensure to also include a normal text response explaining what action you are proposing. Propose only ONE action block per turn.",
  ].join("\n");
}

interface ActionProposalCardProps {
  action: PlannerAction;
  conversationId: number | null;
  messageIndex: number;
  projectId?: number | null;
  onApplied: () => void;
}

export function ActionProposalCard({
  action,
  conversationId,
  messageIndex,
  projectId = null,
  onApplied,
}: ActionProposalCardProps) {
  // Apply-state lives in the SQLite `conversation_actions` table (W5).
  // We start in "idle" and quietly upgrade to "applied" if a matching row
  // shows up — this avoids a render flicker for unmatched messages.
  const [status, setStatus] = useState<"idle" | "applying" | "applied" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (conversationId == null) return;
    (async () => {
      const res = await commands.listConversationActions(conversationId);
      if (cancelled) return;
      if (res.status !== "ok") return;
      const match = res.data.find(
        (r) => r.message_index === messageIndex && r.status === "applied",
      );
      if (match) setStatus("applied");
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, messageIndex]);

  async function handleApply() {
    if (conversationId == null) return;
    setStatus("applying");
    setErrorMsg(null);
    try {
      if (action.type === "create_goal") {
        const priorityVal = action.priority ?? 0;
        const dueTs = action.due_date
          ? Math.floor(new Date(action.due_date + "T00:00:00").getTime() / 1000)
          : null;
        const res = await commands.goalCreate(
          projectId ?? null,
          action.title ?? "New Goal",
          action.description ?? null,
          priorityVal,
          dueTs
        );
        if (res.status === "error") throw new Error(res.error);

        if (action.subtasks && action.subtasks.length > 0) {
          const goalId = res.data.id;
          for (const sub of action.subtasks) {
            await commands.subtaskCreate(goalId, sub);
          }
        }
      } else if (action.type === "update_goal") {
        if (action.goal_id == null) throw new Error("Goal ID is missing");
        const dueTs = action.due_date
          ? Math.floor(new Date(action.due_date + "T00:00:00").getTime() / 1000)
          : null;
        const res = await commands.goalUpdate(
          action.goal_id,
          action.title ?? null,
          action.description ?? null,
          action.status ?? null,
          action.priority ?? null,
          dueTs,
          null
        );
        if (res.status === "error") throw new Error(res.error);
      } else if (action.type === "delete_goal") {
        if (action.goal_id == null) throw new Error("Goal ID is missing");
        const res = await commands.goalDelete(action.goal_id);
        if (res.status === "error") throw new Error(res.error);
      } else if (action.type === "create_subtasks") {
        if (action.goal_id == null) throw new Error("Goal ID is missing");
        if (!action.subtasks || action.subtasks.length === 0) throw new Error("Subtasks are missing");
        for (const sub of action.subtasks) {
          const res = await commands.subtaskCreate(action.goal_id, sub);
          if (res.status === "error") throw new Error(res.error);
        }
      } else if (action.type === "toggle_subtask") {
        if (action.subtask_id == null) throw new Error("Subtask ID is missing");
        const res = await commands.subtaskToggle(action.subtask_id);
        if (res.status === "error") throw new Error(res.error);
      } else if (action.type === "delete_subtask") {
        if (action.subtask_id == null) throw new Error("Subtask ID is missing");
        const res = await commands.subtaskDelete(action.subtask_id);
        if (res.status === "error") throw new Error(res.error);
      }

      const rec = await commands.recordConversationAction(
        conversationId,
        messageIndex,
        "applied",
      );
      if (rec.status === "error") throw new Error(rec.error);
      setStatus("applied");
      onApplied();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "알 수 없는 오류가 발생했습니다.");
      setStatus("error");
    }
  }

  const typeLabels: Record<string, string> = {
    create_goal: "🎯 목표 생성",
    update_goal: "🔄 목표 수정",
    delete_goal: "🗑 목표 삭제",
    create_subtasks: "➕ 하위 작업 추가",
    toggle_subtask: "✅ 작업 완료 토글",
    delete_subtask: "❌ 하위 작업 삭제",
  };

  const priorityLabels = ["보통", "높음", "긴급"];
  // ui_v2 trigger-token vars (theme via [data-theme] attribute).
  const priorityColors = [
    "bg-[var(--t-chore-soft)] text-[var(--t-chore)]",
    "bg-[var(--t-error-soft)] text-[var(--t-error)]",
    "bg-[var(--t-bug-soft)] text-[var(--t-bug)]",
  ];

  return (
    <div className="mt-3 p-4 rounded-xl border border-border/80 bg-background/50 backdrop-blur-sm shadow-sm space-y-3 max-w-full">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary">
          {typeLabels[action.type] || "플래너 제안"}
        </span>
        {status === "applied" && (
          <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
            ✓ 반영 완료
          </span>
        )}
      </div>

      {action.type === "create_goal" && (
        <div className="space-y-1.5 text-xs text-foreground">
          <div className="font-semibold text-sm">{action.title}</div>
          {action.description && (
            <p className="text-muted-foreground whitespace-pre-wrap">{action.description}</p>
          )}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {action.priority != null && (
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${priorityColors[action.priority]}`}>
                우선순위: {priorityLabels[action.priority]}
              </span>
            )}
            {action.due_date && (
              <span className="px-2 py-0.5 rounded bg-muted text-[10px] font-medium">
                기한: {action.due_date}
              </span>
            )}
          </div>
          {action.subtasks && action.subtasks.length > 0 && (
            <div className="pt-2">
              <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">제안된 하위 작업</div>
              <ul className="space-y-1 pl-2">
                {action.subtasks.map((sub, idx) => (
                  <li key={idx} className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground" />
                    {sub}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {action.type === "update_goal" && (
        <div className="space-y-1 text-xs text-foreground">
          <div className="text-muted-foreground">목표 ID: <span className="font-mono font-semibold text-foreground">#{action.goal_id}</span></div>
          {action.title && <div>변경 제목: <span className="font-semibold">{action.title}</span></div>}
          {action.description && <div className="text-muted-foreground">변경 설명: {action.description}</div>}
          {action.status && (
            <div>
              상태 변경:{" "}
              <span className="px-1.5 py-0.5 rounded bg-muted font-medium">
                {action.status}
              </span>
            </div>
          )}
          {action.priority != null && (
            <div>우선순위 변경: <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${priorityColors[action.priority]}`}>{priorityLabels[action.priority]}</span></div>
          )}
          {action.due_date && <div>기한 변경: <span className="font-semibold">{action.due_date}</span></div>}
        </div>
      )}

      {action.type === "delete_goal" && (
        <div className="text-xs text-foreground">
          목표 ID <span className="font-mono font-semibold">#{action.goal_id}</span>를 삭제합니다.
        </div>
      )}

      {action.type === "create_subtasks" && (
        <div className="space-y-1.5 text-xs text-foreground">
          <div className="text-muted-foreground">목표 ID: <span className="font-mono font-semibold text-foreground">#{action.goal_id}</span></div>
          <div className="pt-1">
            <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">추가할 서브태스크</div>
            <ul className="space-y-1 pl-2">
              {action.subtasks?.map((sub, idx) => (
                <li key={idx} className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/40" />
                  {sub}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {action.type === "toggle_subtask" && (
        <div className="text-xs text-foreground">
          서브태스크 ID <span className="font-mono font-semibold">#{action.subtask_id}</span>의 완료 상태를 전환(토글)합니다.
        </div>
      )}

      {action.type === "delete_subtask" && (
        <div className="text-xs text-foreground">
          서브태스크 ID <span className="font-mono font-semibold text-foreground">#{action.subtask_id}</span>를 삭제합니다.
        </div>
      )}

      {status === "error" && errorMsg && (
        <p className="text-xs text-destructive bg-destructive/5 p-2 rounded border border-destructive/20 font-mono">
          {errorMsg}
        </p>
      )}

      {status !== "applied" && (
        <div className="flex gap-2 justify-end pt-1">
          <Button
            size="sm"
            onClick={handleApply}
            disabled={status === "applying"}
            className="h-8 px-4 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
          >
            {status === "applying" ? "반영 중..." : "적용하기 (Apply)"}
          </Button>
        </div>
      )}
    </div>
  );
}
