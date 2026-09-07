/**
 * 계획 문서의 본문 — 머리글(제목·잠금·진행률·상태 집계) + 경고 + 단계 목록 +
 * 결정 기록.
 *
 * `PlannerScreenV2` 에서 그대로 분리했다 (분할 라운드, 플랜 `v3-release`
 * {#planner-diff-split}). 화면 파일은 툴바·레일·작성기·대화상자만 남고,
 * 「문서를 어떻게 그리는가」는 여기 한 곳에 모인다.
 */

import { useState, type Dispatch, type SetStateAction } from "react";

import { Lock, Pencil, RefreshCw, TriangleAlert, Trash2 } from "@/components/Icons";
import { InlineMarkdown } from "@/components/InlineMarkdown";
import { agentLabel } from "@/features/today/agentColor";
import { t } from "@/i18n";
import type { PlanDetail, PlanItemDto, PlanItemUpdateDto } from "@/lib/bindings";
import { PhaseCard } from "./PhaseCard";
import { NO_PHASE, STATUS_META, type JournalRefMeta } from "./planMeta";

interface PlanBodyProps {
  detail: PlanDetail;
  counts: Record<string, number>;
  phases: [string, PlanItemDto[]][];
  collapsed: Record<string, boolean>;
  setCollapsed: Dispatch<SetStateAction<Record<string, boolean>>>;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  onDispatch: (item: PlanItemDto) => void;
  busy: boolean;
  locked: boolean;
  onToggleLock: (lock: boolean) => void;
  /** 끝난 계획을 보관으로 — 완료 상태에서만 의미가 있다. */
  onArchive: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onRemoveItem: (item: PlanItemDto) => void;
  onRenameItem: (item: PlanItemDto, title: string) => void;
  onRenamePhase: (from: string, to: string) => void;
  onRemovePhase: (phase: string) => void;
  onMovePhase: (phase: string, up: boolean) => void;
  historyFor: string | null;
  history: PlanItemUpdateDto[] | null;
  onToggleHistory: (itemId: string) => void;
  onRefresh: () => void;
  onOpenJournalRef: (ref: string) => void;
  resolveJournalRefs: (refs: string[]) => Promise<JournalRefMeta[]>;
}

export function PlanBody(props: PlanBodyProps) {
  const { detail, counts, phases, collapsed, setCollapsed, onSetStatus, onDispatch, busy, locked, onToggleLock, onArchive, onRename, onDelete, onRemoveItem, onRenameItem, onRenamePhase, onRemovePhase, onMovePhase, historyFor, history, onToggleHistory, onRefresh, onOpenJournalRef, resolveJournalRefs } = props;
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = detail.plan.status !== "active" && detail.plan.status !== "done";
  const pct = Math.round((detail.plan.progress ?? 0) * 100);
  const phaseMeta = new Map((detail.phases ?? []).map((p) => [p.name, p] as const));

  return (
    <>
      {/* Header */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="pln-plan-head">
          <div className="pln-plan-headtitle">
            {renaming ? (
              <input
                autoFocus
                className="goal-title-input"
                defaultValue={detail.plan.title}
                style={{ fontSize: 16, fontWeight: 660 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onRename((e.target as HTMLInputElement).value);
                    setRenaming(false);
                  }
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== detail.plan.title) onRename(v);
                  setRenaming(false);
                }}
              />
            ) : locked ? (
              <InlineMarkdown className="goal-title pln-plan-title" text={detail.plan.title} />
            ) : (
              <button
                type="button"
                className="plan-title-btn"
                onClick={() => setRenaming(true)}
                disabled={busy}
                title={t("plan.renameTitle")}
              >
                <InlineMarkdown className="goal-title pln-plan-title" text={detail.plan.title} linkable={false} />
                <span className="plan-title-pen"><Pencil size={13} /></span>
              </button>
            )}
            <div className="goal-due" style={{ marginTop: 4 }}>
              <span className={"goal-status " + (locked ? "planned" : "active")}>
                {locked ? (
                  <>
                    <Lock size={11} />{" "}
                    {archived ? t("plan.group.archived") : t("plan.locked")}
                  </>
                ) : (
                  t("plan.inProgress")
                )}
              </span>
              <span className="dotsep">·</span>
              {t("plan.doneOf", { done: detail.plan.done_count, total: detail.plan.item_count })}
            </div>
          </div>
          {/* 액션은 한 덩어리다 — 좁아지면 제목 아래로 통째로 내려간다
              (버튼이 하나씩 흩어져 접히면 어디가 어딘지 안 보인다). */}
          <div className="pln-plan-headactions">
            <button
              className="btn sm"
              onClick={() => onToggleLock(!locked)}
              disabled={busy}
              title={locked ? t("plan.unlockTitle") : t("plan.lockTitle")}
            >
              {locked ? t("plan.unlock") : t("plan.locked")}
            </button>
            {/* 보관은 '끝났고 이제 목록에서 치운다' 는 뜻이라 완료된 계획에만
                붙인다. 되돌리기는 왼쪽의 '잠금 해제' 하나로 충분하다. */}
            {detail.plan.status === "done" ? (
              <button
                className="btn sm"
                onClick={onArchive}
                disabled={busy}
                title={t("plan.archiveTitle")}
              >
                {t("plan.group.archived")}
              </button>
            ) : null}
            {confirmDelete ? (
              <>
                <button type="button" className="pln-textbtn danger" onClick={() => { setConfirmDelete(false); onDelete(); }} disabled={busy} title={t("plan.deleteConfirmTitle")}>
                  {t("plan.deleteConfirm")}
                </button>
                <button type="button" className="pln-textbtn" onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</button>
              </>
            ) : (
              <button type="button" className="pln-iconbtn danger" onClick={() => setConfirmDelete(true)} disabled={busy} title={t("plan.deleteTitle")}>
                <Trash2 size={14} />
              </button>
            )}
            <button type="button" className="pln-iconbtn" onClick={onRefresh} title={t("plan.refresh")}><RefreshCw size={14} /></button>
          </div>
        </div>
        {locked ? (
          <div className="today-date" style={{ marginTop: 8, color: "var(--text-3)" }}>
            {t("plan.lockedNote")}
          </div>
        ) : null}

        <div className="goal-prog-wrap" style={{ marginTop: 12 }}>
          <div className="prog-track" style={{ flex: 1 }}><i style={{ width: `${pct}%` }} /></div>
          <span className="prog-pct">{pct}%</span>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          {(["done", "in_progress", "blocked", "deferred", "todo", "dropped"] as const)
            .filter((s) => (counts[s] ?? 0) > 0)
            .map((s) => (
              <span key={s} style={{ fontSize: 12, color: "var(--text-2)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: STATUS_META[s].color, fontSize: 14 }}>{STATUS_META[s].glyph}</span>
                {t(STATUS_META[s].labelKey)} {counts[s]}
              </span>
            ))}
        </div>
      </div>

      {/* Warnings */}
      {detail.warnings.length > 0 ? (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: "var(--t-bug)" }}>
          <div className="stat-top" style={{ color: "var(--t-bug)" }}>
            <TriangleAlert size={14} /> {t("plan.warnings", { n: detail.warnings.length })}
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--text-2)" }}>
            {detail.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      {/* Phases — reorder bounds are computed among real (on-disk) headings so
          the synthetic 기타 bucket never blocks moving the last real phase. */}
      {phases.map(([phase, items]) => {
        const realPhases = phases.map(([p]) => p).filter((p) => p !== NO_PHASE);
        const ri = realPhases.indexOf(phase);
        const canEdit = phase !== NO_PHASE;
        return (
        <PhaseCard
          key={phase}
          phase={phase}
          items={items}
          meta={phaseMeta.get(phase)}
          isOpen={collapsed[phase] !== true}
          onToggle={() => setCollapsed((c) => ({ ...c, [phase]: c[phase] !== true }))}
          busy={busy}
          locked={locked}
          canEdit={canEdit}
          canMoveUp={ri > 0}
          canMoveDown={ri >= 0 && ri < realPhases.length - 1}
          onRenamePhase={onRenamePhase}
          onRemovePhase={onRemovePhase}
          onMovePhase={onMovePhase}
          onSetStatus={onSetStatus}
          onDispatch={onDispatch}
          onRemoveItem={onRemoveItem}
          onRenameItem={onRenameItem}
          historyFor={historyFor}
          history={history}
          onToggleHistory={onToggleHistory}
          onOpenJournalRef={onOpenJournalRef}
          resolveJournalRefs={resolveJournalRefs}
        />
        );
      })}

      {/* Decisions */}
      {detail.decisions.length > 0 ? (
        <div style={{ marginTop: 20 }}>
          <div className="today-date" style={{ marginBottom: 8, fontWeight: 600 }}>{t("plan.decisions")}</div>
          {detail.decisions.map((d) => (
            <div className="card card-pad" key={d.decision_id} style={{ marginBottom: 10 }}>
              <div className="goal-title" style={{ fontSize: 14 }}>{d.title}</div>
              {d.body ? <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, whiteSpace: "pre-wrap" }}>{d.body}</div> : null}
              <div className="goal-due" style={{ marginTop: 8 }}>
                {d.locked_at ? <><Lock size={10} /> {d.locked_at}{d.agent_id ? ` · ${agentLabel(d.agent_id)}` : ""}<span className="dotsep">·</span></> : null}
                {d.affects.length > 0 ? t("plan.affects", { list: d.affects.map((a) => `#${a}`).join(", ") }) : t("plan.noAffects")}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
