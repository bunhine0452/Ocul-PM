import { useEffect, useState } from "react";
import { commands } from "@/lib/bindings";
import { Button } from "@/components/ui/button";
import { tc, useT, type I18nKey } from "@/i18n";

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

// S1 / planner-unify (2026-06-22): plan-action protocol targets the file-based
// Plan (`.oculpm/planner/*.md` via plan_create / plan_apply_edit) — not the
// retired SQLite goals. Plans + items are referenced by their string ids
// (`plan_id` / `item_id`), surfaced to the model via buildPlannerSystemContext.
export interface PlannerAction {
  type: "create_plan" | "add_items" | "set_status" | "rename_item" | "remove_item";
  /** Target plan for add_items / set_status / rename_item / remove_item. */
  plan_id?: string;
  /** New plan title (create_plan). */
  plan_title?: string;
  /** Phase heading for added items (created if absent). */
  phase?: string;
  /** Item titles to add (create_plan / add_items). */
  titles?: string[];
  /** Target item for set_status / rename_item / remove_item. */
  item_id?: string;
  /** New title (rename_item). */
  title?: string;
  /** "todo" | "in_progress" | "done" (set_status). */
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

/**
 * AI 제안에 제목·단계가 없을 때 쓰는 기본값.
 *
 * **UI 문자열이 아니라 플래너 파일에 기록되는 내용값**이라 `t()` 가 아니라
 * `tc()` 를 쓴다 — AI 작성 언어(`settings.contentLanguage`) 축이다. 함수인
 * 이유는 모듈 상수로 두면 임포트 시점에 언어가 굳기 때문이다.
 */
const defaultPlanTitle = () => tc("content.defaultPlanTitle");
const defaultPhase = () => tc("content.defaultPhase");

/** System-prompt fragment teaching the model the json:action protocol. Injected
 *  when planner context is attached so the assistant can propose changes. */
export function buildActionInstruction(): string {
  return [
    "### Interactive Planner Actions:",
    "If the user asks to create or change a plan or its items (tasks), or you propose doing so, you MUST append a markdown code block with the language `json:action` AT the end of your response.",
    "Do NOT call commands directly — output the proposal so the user can review and approve it.",
    "Reference existing plans/items by the `plan_id` / `item_id` shown in \"Current Workspace Plans\". An item `status` is one of: \"todo\" | \"in_progress\" | \"done\".",
    "",
    "Create a new plan (optionally with initial items under a phase):",
    "```json:action",
    "{",
    "  \"type\": \"create_plan\",",
    "  \"plan_title\": \"Plan Title\",",
    `  "phase": "Phase name (optional, default ${defaultPhase()})",`,
    "  \"titles\": [\"Item 1\", \"Item 2\"] (optional)",
    "}",
    "```",
    "",
    "Add items to an existing plan (the phase is created if absent):",
    "```json:action",
    "{ \"type\": \"add_items\", \"plan_id\": \"...\", \"phase\": \"...\", \"titles\": [\"Item 1\", \"Item 2\"] }",
    "```",
    "",
    "Change an item's status:",
    "```json:action",
    "{ \"type\": \"set_status\", \"plan_id\": \"...\", \"item_id\": \"...\", \"status\": \"done\" }",
    "```",
    "",
    "Rename an item:",
    "```json:action",
    "{ \"type\": \"rename_item\", \"plan_id\": \"...\", \"item_id\": \"...\", \"title\": \"New title\" }",
    "```",
    "",
    "Remove an item:",
    "```json:action",
    "{ \"type\": \"remove_item\", \"plan_id\": \"...\", \"item_id\": \"...\" }",
    "```",
    "Always include a normal text response explaining the proposal. Propose only ONE action block per turn.",
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
  const { t } = useT();
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
      if (projectId == null) throw new Error(t("ai.actionNoProject"));
      const agent = "assistant";
      const addItem = async (planId: string, phase: string, title: string) => {
        const r = await commands.planApplyEdit(
          projectId,
          planId,
          { kind: "add_item", phase, title, item_id: null, status: null },
          agent,
        );
        if (r.status === "error") throw new Error(r.error);
      };
      if (action.type === "create_plan") {
        const created = await commands.planCreate(
          projectId,
          action.plan_title ?? defaultPlanTitle(),
        );
        if (created.status === "error") throw new Error(created.error);
        const planId = created.data.plan_id;
        for (const title of action.titles ?? [])
          await addItem(planId, action.phase ?? defaultPhase(), title);
      } else if (action.type === "add_items") {
        if (!action.plan_id) throw new Error(t("ai.actionMissingPlanId"));
        if (!action.titles?.length) throw new Error(t("ai.actionNoItems"));
        for (const title of action.titles)
          await addItem(action.plan_id, action.phase ?? defaultPhase(), title);
      } else if (action.type === "set_status") {
        if (!action.plan_id || !action.item_id || !action.status)
          throw new Error(t("ai.actionNeedStatus"));
        const r = await commands.planApplyEdit(
          projectId,
          action.plan_id,
          { kind: "set_status", item_id: action.item_id, status: action.status },
          agent,
        );
        if (r.status === "error") throw new Error(r.error);
      } else if (action.type === "rename_item") {
        if (!action.plan_id || !action.item_id || !action.title)
          throw new Error(t("ai.actionNeedTitle"));
        const r = await commands.planApplyEdit(
          projectId,
          action.plan_id,
          { kind: "rename_item", item_id: action.item_id, title: action.title },
          agent,
        );
        if (r.status === "error") throw new Error(r.error);
      } else if (action.type === "remove_item") {
        if (!action.plan_id || !action.item_id)
          throw new Error(t("ai.actionNeedItem"));
        const r = await commands.planApplyEdit(
          projectId,
          action.plan_id,
          { kind: "remove_item", item_id: action.item_id },
          agent,
        );
        if (r.status === "error") throw new Error(r.error);
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
      setErrorMsg(err.message || t("ai.actionUnknownError"));
      setStatus("error");
    }
  }

  // 표시 라벨만 사전을 거친다 — 키(action.type)는 프로토콜 판별자라 그대로다.
  const typeLabels: Record<string, I18nKey> = {
    create_plan: "ai.actionCreatePlan",
    add_items: "ai.actionAddItems",
    set_status: "ai.actionSetStatus",
    rename_item: "ai.actionRenameItem",
    remove_item: "ai.actionRemoveItem",
  };
  const typeKey = typeLabels[action.type];

  return (
    <div className="mt-3 p-4 rounded-xl border border-border/80 bg-background/50 backdrop-blur-sm shadow-sm space-y-3 max-w-full">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary">
          {typeKey ? t(typeKey) : t("ai.actionFallback")}
        </span>
        {status === "applied" && (
          <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
            {t("ai.actionApplied")}
          </span>
        )}
      </div>

      {(action.type === "create_plan" || action.type === "add_items") && (
        <div className="space-y-1.5 text-xs text-foreground">
          {action.type === "create_plan" ? (
            <div className="font-semibold text-sm">
              {t("ai.actionNewPlan", { title: action.plan_title ?? defaultPlanTitle() })}
            </div>
          ) : (
            <div className="text-muted-foreground">
              {t("ai.actionPlanLabel")}:{" "}
              <span className="font-mono font-semibold text-foreground">{action.plan_id}</span>
            </div>
          )}
          {action.phase && (
            <div className="text-muted-foreground">
              {t("ai.actionPhaseLabel")}:{" "}
              <span className="font-medium text-foreground">{action.phase}</span>
            </div>
          )}
          {action.titles && action.titles.length > 0 && (
            <div className="pt-1">
              <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">
                {t("ai.actionItemsToAdd")}
              </div>
              <ul className="space-y-1 pl-2">
                {action.titles.map((title, idx) => (
                  <li key={idx} className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/40" />
                    {title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {action.type === "set_status" && (
        <div className="text-xs text-foreground">
          {t("ai.actionItemWord")}{" "}
          <span className="font-mono font-semibold">{action.item_id}</span>{" "}
          {t("ai.actionStatusArrow")}{" "}
          <span className="px-1.5 py-0.5 rounded bg-muted font-medium">{action.status}</span>
          <span className="text-muted-foreground">
            {" "}
            {t("ai.actionInPlan", { planId: action.plan_id ?? "" })}
          </span>
        </div>
      )}

      {action.type === "rename_item" && (
        <div className="text-xs text-foreground">
          {t("ai.actionItemWord")}{" "}
          <span className="font-mono font-semibold">{action.item_id}</span>{" "}
          {t("ai.actionNameArrow")} <span className="font-semibold">{action.title}</span>
        </div>
      )}

      {action.type === "remove_item" && (
        <div className="text-xs text-foreground">
          {t("ai.actionItemWord")}{" "}
          <span className="font-mono font-semibold text-foreground">{action.item_id}</span>{" "}
          {t("ai.actionRemoveSuffix")}
          <span className="text-muted-foreground">
            {" "}
            {t("ai.actionInPlan", { planId: action.plan_id ?? "" })}
          </span>
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
            {status === "applying" ? t("ai.actionApplying") : t("ai.actionApply")}
          </Button>
        </div>
      )}
    </div>
  );
}
