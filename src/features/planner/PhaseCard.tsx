/**
 * 한 단계(`## ` 섹션) 카드 — 접힘 · 인라인 이름 바꾸기 · 순서 이동 · 삭제.
 *
 * `PlannerScreenV2` 에서 그대로 분리했다 (분할 라운드, 플랜 `v3-release`
 * {#planner-diff-split}). 화면은 문서를 **배치**하고, 단계 하나의 상호작용은
 * 여기가 소유한다 — 항목 행은 다시 `PlanItemRow` 가 가진다.
 */

import { useRef, useState } from "react";

import {
  ChevronDown, ChevronUpIcon as ChevronUp, ChevronRight, Pencil, Trash2,
} from "@/components/Icons";
import { InlineMarkdown } from "@/components/InlineMarkdown";
import { agentColor, agentLabel } from "@/features/today/agentColor";
import { t } from "@/i18n";
import type { PlanDetail, PlanItemDto, PlanItemUpdateDto } from "@/lib/bindings";
import { PlanItemRow } from "./PlanItemRow";
import {
  NO_PHASE,
  phaseProgress,
  relativeTime,
  STATUS_META,
  type JournalRefMeta,
} from "./planMeta";

interface PhaseCardProps {
  phase: string;
  items: PlanItemDto[];
  meta: NonNullable<PlanDetail["phases"]>[number] | undefined;
  isOpen: boolean;
  onToggle: () => void;
  busy: boolean;
  locked: boolean;
  canEdit: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRenamePhase: (from: string, to: string) => void;
  onRemovePhase: (phase: string) => void;
  onMovePhase: (phase: string, up: boolean) => void;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  onDispatch: (item: PlanItemDto) => void;
  onRemoveItem: (item: PlanItemDto) => void;
  onRenameItem: (item: PlanItemDto, title: string) => void;
  historyFor: string | null;
  history: PlanItemUpdateDto[] | null;
  onToggleHistory: (itemId: string) => void;
  onOpenJournalRef: (ref: string) => void;
  resolveJournalRefs: (refs: string[]) => Promise<JournalRefMeta[]>;
}

export function PhaseCard(props: PhaseCardProps) {
  const {
    phase, items, meta, isOpen, onToggle, busy, locked, canEdit, canMoveUp, canMoveDown,
    onRenamePhase, onRemovePhase, onMovePhase,
    onSetStatus, onDispatch, onRemoveItem, onRenameItem, historyFor, history, onToggleHistory,
    onOpenJournalRef, resolveJournalRefs,
  } = props;
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  // Phases are matched by name, so a rename must fire exactly once: Enter blurs
  // the input and the single onBlur commits; Escape blurs with this flag set so
  // the commit is skipped. (A double submit would re-target the old, now-gone
  // name and surface a spurious "not found".)
  const cancelEditRef = useRef(false);

  const sm = STATUS_META[meta?.status ?? "todo"] ?? STATUS_META.todo;
  const phasePct = meta ? Math.round((meta.progress ?? 0) * 100) : phaseProgress(items);

  return (
    <div className="card goal-card" style={{ marginBottom: 12 }}>
      <div className={"goal-head-row" + (confirmDel ? " is-active" : "")}>
        {editing ? (
          <div className="goal-head-edit">
            <span className="goal-glyph" style={{ color: sm.color }}>{sm.glyph}</span>
            <input
              autoFocus
              className="goal-title-input"
              defaultValue={phase}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                if (e.key === "Escape") { cancelEditRef.current = true; (e.target as HTMLInputElement).blur(); }
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (!cancelEditRef.current && v && v !== phase) onRenamePhase(phase, v);
                cancelEditRef.current = false;
                setEditing(false);
              }}
            />
          </div>
        ) : (
          <button type="button" className="goal-head-toggle" onClick={onToggle} aria-expanded={isOpen}>
            {isOpen ? <ChevronDown size={16} color="var(--text-3)" /> : <ChevronRight size={16} color="var(--text-3)" />}
            <span className="goal-glyph" style={{ color: sm.color }}>{sm.glyph}</span>
            <InlineMarkdown
              className="goal-title goal-title-clip"
              text={phase === NO_PHASE ? t("plan.noPhase") : phase}
              linkable={false}
            />
            {meta?.last_agent ? (
              <span
                className="phase-agent"
                title={`${agentLabel(meta.last_agent)} · ${relativeTime(meta.last_update)}`}
              >
                <span style={{ width: 7, height: 7, borderRadius: 99, background: agentColor(meta.last_agent) }} />
                {agentLabel(meta.last_agent)}
              </span>
            ) : null}
          </button>
        )}

        {!locked && !editing && canEdit ? (
          <div className="phase-actions">
            {confirmDel ? (
              <>
                <button type="button" className="pln-textbtn danger" onClick={() => { setConfirmDel(false); onRemovePhase(phase); }} disabled={busy}>
                  {t("plan.phaseRemove")}
                </button>
                <button type="button" className="pln-textbtn" onClick={() => setConfirmDel(false)}>{t("common.cancel")}</button>
              </>
            ) : (
              <>
                <button type="button" className="pln-iconbtn" title={t("plan.phaseRename")} onClick={() => setEditing(true)} disabled={busy}>
                  <Pencil size={13} />
                </button>
                <button type="button" className="pln-iconbtn" title={t("plan.phaseUp")} onClick={() => onMovePhase(phase, true)} disabled={busy || !canMoveUp}>
                  <ChevronUp size={14} />
                </button>
                <button type="button" className="pln-iconbtn" title={t("plan.phaseDown")} onClick={() => onMovePhase(phase, false)} disabled={busy || !canMoveDown}>
                  <ChevronDown size={14} />
                </button>
                <button type="button" className="pln-iconbtn danger" title={t("plan.phaseRemoveTitle")} onClick={() => setConfirmDel(true)} disabled={busy}>
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        ) : null}

        <span className="prog-pct">{phasePct}%</span>
      </div>

      {isOpen
        ? items.map((it) => (
            <PlanItemRow
              key={it.item_id}
              item={it}
              busy={busy}
              locked={locked}
              isParent={items.some((c) => c.parent_item === it.item_id)}
              onSetStatus={onSetStatus}
              onDispatch={onDispatch}
              onRemove={onRemoveItem}
              onRename={onRenameItem}
              historyOpen={historyFor === it.item_id}
              history={historyFor === it.item_id ? history : null}
              onToggleHistory={onToggleHistory}
              onOpenJournalRef={onOpenJournalRef}
              resolveJournalRefs={resolveJournalRefs}
            />
          ))
        : null}
    </div>
  );
}
