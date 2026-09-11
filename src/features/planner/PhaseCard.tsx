/**
 * 한 단계(`## ` 섹션) — 접힘 · 인라인 이름 바꾸기 · 순서 이동 · 삭제.
 *
 * 카드가 아니라 **절**이다 (2026-09-10 리디자인). 머리는 스크롤 중 위에 붙어
 * 지금 어느 단계를 읽고 있는지 말하고, 행은 구분선으로만 나뉜다. 화면은
 * 문서를 **배치**하고, 단계 하나의 상호작용은 여기가 소유한다 — 항목 행은
 * 다시 `PlanItemRow` 가 가진다. (파일 이름은 옛 것을 그대로 둔다.)
 */

import { useRef, useState, type DragEvent } from "react";

import {
  ChevronDown, ChevronUpIcon as ChevronUp, ChevronRight, Pencil, Trash2,
} from "@/components/Icons";
import { InlineMarkdown } from "@/components/InlineMarkdown";
import { agentColor, agentLabel } from "@/features/today/agentColor";
import { t } from "@/i18n";
import { blocked } from "@/lib/blocked";
import type { PlanDetail, PlanItemDto, PlanItemUpdateDto } from "@/lib/bindings";
import { PlanItemRow } from "./PlanItemRow";
import {
  countByStatus,
  isHiddenWhenRemainingOnly,
  leafItems,
  NO_PHASE,
  relativeTime,
  type JournalRefMeta,
} from "./planMeta";

/** 보드(`PlanBoard`)와 같은 MIME — 열 드래그와 행 드래그가 같은 물건을 나른다. */
export const ITEM_DRAG_MIME = "application/x-oculpm-plan-item";
/** 단계 사이를 건너는 드래그 — dataTransfer 는 drop 전엔 안 읽히므로 모듈이 든다. */
const draggedItemRef: { current: PlanItemDto | null } = { current: null };

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
  /** E2 — 행 드래그: 다른 행 위에 놓으면 그 앞으로, 단계 머리에 놓으면 그 끝으로. */
  onMoveItem: (item: PlanItemDto, target: { before?: string; phase?: string }) => void;
  onRenameItem: (item: PlanItemDto, title: string) => void;
  historyFor: string | null;
  history: PlanItemUpdateDto[] | null;
  onToggleHistory: (itemId: string) => void;
  onOpenJournalRef: (ref: string) => void;
  resolveJournalRefs: (refs: string[]) => Promise<JournalRefMeta[]>;
  /** 「남은 것만」 — 완료·폐기 행을 숨기고 숨긴 수를 발치에 적는다. */
  hideDone: boolean;
  onShowAll: () => void;
}

export function PhaseCard(props: PhaseCardProps) {
  const {
    phase, items, meta, isOpen, onToggle, busy, locked, canEdit, canMoveUp, canMoveDown,
    onRenamePhase, onRemovePhase, onMovePhase,
    onSetStatus, onDispatch, onRemoveItem, onMoveItem, onRenameItem, historyFor, history, onToggleHistory,
    onOpenJournalRef, resolveJournalRefs, hideDone, onShowAll,
  } = props;
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  // Phases are matched by name, so a rename must fire exactly once: Enter blurs
  // the input and the single onBlur commits; Escape blurs with this flag set so
  // the commit is skipped. (A double submit would re-target the old, now-gone
  // name and surface a spurious "not found".)
  const cancelEditRef = useRef(false);

  // 숫자는 리프 기준 — 백엔드 phase meta 와 같은 모수. (기타) 묶음은 meta 가
  // 없어 여기서 센다.
  const leafCounts = countByStatus(leafItems(items));
  const doneCount = meta?.done_count ?? leafCounts.done ?? 0;
  const totalCount = meta?.item_count ?? leafItems(items).length;
  const blockedCount = leafCounts.blocked ?? 0;
  const phaseDone = totalCount > 0 && doneCount === totalCount && blockedCount === 0;
  const visible = hideDone ? items.filter((it) => !isHiddenWhenRemainingOnly(it.status)) : items;
  const hiddenCount = items.length - visible.length;
  const label = phase === NO_PHASE ? t("plan.noPhase") : phase;

  // 행 드래그 (E2). 보드의 열 드래그와 같은 MIME 을 쓴다 — 같은 데이터(항목 id).
  // 놓는 자리: 다른 행 = 그 앞, 단계 머리 = 그 단계 끝. 잠긴 플랜·(기타) 묶음은
  // 드래그하지 않는다.
  const canDrag = !locked && !busy;
  const [dropOn, setDropOn] = useState<string | null>(null);
  const dragged = (e: DragEvent) => e.dataTransfer.types.includes(ITEM_DRAG_MIME);
  const dropBefore = (e: DragEvent, target: PlanItemDto) => {
    e.preventDefault();
    setDropOn(null);
    const id = e.dataTransfer.getData(ITEM_DRAG_MIME);
    const item = items.find((it) => it.item_id === id) ?? draggedItemRef.current;
    if (!item || item.item_id === target.item_id) return;
    onMoveItem(item, { before: target.item_id });
  };
  const dropOnPhase = (e: DragEvent) => {
    e.preventDefault();
    setDropOn(null);
    const item = draggedItemRef.current;
    if (!item || !canEdit) return;
    onMoveItem(item, { phase });
  };

  return (
    <section className={"pln-ph" + (phaseDone ? " is-done" : "")} data-phase={phase} aria-label={label}>
      <div
        className={"pln-ph-head" + (confirmDel ? " is-active" : "") + (dropOn === "__phase" ? " is-drop" : "")}
        onDragOver={(e) => {
          if (!canDrag || !canEdit || !dragged(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropOn("__phase");
        }}
        onDragLeave={() => setDropOn((d) => (d === "__phase" ? null : d))}
        onDrop={dropOnPhase}
      >
        {editing ? (
          <div className="pln-ph-edit">
            <input
              autoFocus
              className="pln-ph-name-input"
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
          <button type="button" className="pln-ph-toggle" onClick={onToggle} aria-expanded={isOpen}>
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <InlineMarkdown className="pln-ph-name" text={label} linkable={false} />
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
                <button type="button" className="pln-iconbtn" {...blocked(canMoveUp ? null : t("plan.blockedTop"), t("plan.phaseUp"))} onClick={() => onMovePhase(phase, true)} disabled={busy}>
                  <ChevronUp size={13} />
                </button>
                <button type="button" className="pln-iconbtn" {...blocked(canMoveDown ? null : t("plan.blockedBottom"), t("plan.phaseDown"))} onClick={() => onMovePhase(phase, false)} disabled={busy}>
                  <ChevronDown size={13} />
                </button>
                <button type="button" className="pln-iconbtn danger" title={t("plan.phaseRemoveTitle")} onClick={() => setConfirmDel(true)} disabled={busy}>
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        ) : null}

        {meta?.last_agent ? (
          <span
            className="phase-agent"
            title={`${agentLabel(meta.last_agent)} · ${relativeTime(meta.last_update)}`}
          >
            <span className="pln-agent-dot" style={{ background: agentColor(meta.last_agent) }} />
            {agentLabel(meta.last_agent)}
          </span>
        ) : null}
        {blockedCount > 0 ? (
          <span className="phase-blocked" title={t("plan.phaseBlocked", { n: blockedCount })}>
            {t("plan.phaseBlocked", { n: blockedCount })}
          </span>
        ) : null}
        <span className="phase-count">{t("plan.doneOf", { done: doneCount, total: totalCount })}</span>
      </div>

      {isOpen
        ? visible.map((it) => (
            <PlanItemRow
              key={it.item_id}
              item={it}
              draggable={canDrag && !it.parent_item}
              dropTarget={dropOn === it.item_id}
              onDragStart={(e) => {
                e.dataTransfer.setData(ITEM_DRAG_MIME, it.item_id);
                e.dataTransfer.effectAllowed = "move";
                draggedItemRef.current = it;
              }}
              onDragOver={(e) => {
                if (!canDrag || !dragged(e) || it.parent_item) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropOn(it.item_id);
              }}
              onDragLeave={() => setDropOn((d) => (d === it.item_id ? null : d))}
              onDrop={(e) => dropBefore(e, it)}
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
      {isOpen && hiddenCount > 0 ? (
        <div className="pln-hidden-done">
          <span>{t("plan.hiddenDone", { n: hiddenCount })}</span>
          <span className="dotsep">·</span>
          <button type="button" className="pln-textbtn" onClick={onShowAll}>{t("plan.showAll")}</button>
        </div>
      ) : null}
    </section>
  );
}
