/**
 * 계획 문서의 본문 — 머리글(제목 · 한 줄 상태 · 단계 스트립 · 집계) + 경고 +
 * 다음 할 일 + 단계 절 + 결정.
 *
 * 한 장의 시트다 (2026-09-10 리디자인). 카드는 없다 — 머리글은 문서의 제목부,
 * 단계는 절, 행은 구분선. 화면 파일(`PlannerScreenV2`)은 툴바·레일·작성기·
 * 대화상자만 남고, 「문서를 어떻게 그리는가」 는 여기 한 곳에 모인다.
 */

import { useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";

import { Lock, Pencil, RefreshCw, TriangleAlert, Trash2 } from "@/components/Icons";
import { InlineMarkdown } from "@/components/InlineMarkdown";
import { agentLabel } from "@/features/today/agentColor";
import { t } from "@/i18n";
import type { PlanDetail, PlanItemDto, PlanItemUpdateDto } from "@/lib/bindings";
import { NextUp } from "./NextUp";
import { PhaseCard } from "./PhaseCard";
import { PlanBoard } from "./PlanBoard";
import {
  isRemaining,
  leafItems,
  nextUp,
  NO_PHASE,
  phaseStrip,
  STATUS_META,
  type JournalRefMeta,
  type PlanView,
} from "./planMeta";
import { StatusMark } from "./StatusMark";

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
  onMoveItem: (item: PlanItemDto, target: { before?: string; phase?: string }) => void;
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
  /** 「남은 것만」 — 완료·폐기 항목을 숨긴다 (프로젝트별 영속). */
  hideDone: boolean;
  onHideDoneChange: (hide: boolean) => void;
  /** 문서형 체크리스트 / 상태별 열 보드. 머리글·결정은 둘 다 같다. */
  view: PlanView;
}

/** `[data-item-id]` 로 행을 찾는다 — jsdom 에는 `CSS.escape` 가 없어 손으로 피한다. */
function itemSelector(itemId: string): string {
  const esc = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(itemId)
    : itemId.replace(/["\\]/g, "\\$&");
  return `[data-item-id="${esc}"]`;
}

function phaseSelector(phase: string): string {
  const esc = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(phase)
    : phase.replace(/["\\]/g, "\\$&");
  return `[data-phase="${esc}"]`;
}

/** 잠깐 밝혔다가 돌아온다 — 스트립·다음 할 일에서 뛰어온 자리. */
function flash(el: HTMLElement) {
  el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  el.classList.add("is-target");
  window.setTimeout(() => el.classList.remove("is-target"), 1800);
}

const LEGEND = ["done", "in_progress", "blocked", "deferred", "todo", "dropped"] as const;

export function PlanBody(props: PlanBodyProps) {
  const { detail, counts, phases, collapsed, setCollapsed, onSetStatus, onDispatch, busy, locked, onToggleLock, onArchive, onRename, onDelete, onRemoveItem, onMoveItem, onRenameItem, onRenamePhase, onRemovePhase, onMovePhase, historyFor, history, onToggleHistory, onRefresh, onOpenJournalRef, resolveJournalRefs, hideDone, onHideDoneChange, view } = props;
  const board = view === "board";
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = detail.plan.status !== "active" && detail.plan.status !== "done";
  const pct = Math.round((detail.plan.progress ?? 0) * 100);
  const phaseMeta = new Map((detail.phases ?? []).map((p) => [p.name, p] as const));

  const strip = phaseStrip(phases);
  const upNext = nextUp(detail.items);
  const remaining = leafItems(detail.items).filter((i) => isRemaining(i.status)).length;

  // 다음 할 일 → 그 행으로. 접힌 단계는 먼저 펼친다 — 클릭 핸들러 안의
  // setState 는 핸들러가 끝나기 전에 그려지므로 다음 프레임이면 행이 있다.
  const jumpTo = (item: PlanItemDto) => {
    const phase = item.phase ?? NO_PHASE;
    setCollapsed((c) => (c[phase] === true ? { ...c, [phase]: false } : c));
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(itemSelector(item.item_id));
      if (el) flash(el);
    });
  };
  // 스트립 조각 → 그 단계 머리로.
  const jumpToPhase = (phase: string) => {
    const el = document.querySelector<HTMLElement>(phaseSelector(phase));
    el?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };

  return (
    <>
      <header className="pln-mast">
        <div className="pln-mast-row">
          <div className="pln-mast-title">
            {renaming ? (
              <input
                autoFocus
                className="goal-title-input"
                defaultValue={detail.plan.title}
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
              <InlineMarkdown className="pln-plan-title" text={detail.plan.title} />
            ) : (
              <button
                type="button"
                className="plan-title-btn"
                onClick={() => setRenaming(true)}
                disabled={busy}
                title={t("plan.renameTitle")}
              >
                <InlineMarkdown className="pln-plan-title" text={detail.plan.title} linkable={false} />
                <span className="plan-title-pen"><Pencil size={13} /></span>
              </button>
            )}
            {/* 한 줄 상태 — 칩 대신 문장. */}
            <div className="pln-mast-sub">
              <span className={"pln-state " + (locked ? "is-locked" : "is-active")}>
                {locked ? <Lock size={11} /> : <span className="pln-state-dot" />}
                {locked ? (archived ? t("plan.group.archived") : t("plan.locked")) : t("plan.inProgress")}
              </span>
              <span className="dotsep">·</span>
              <span>{t("plan.doneOf", { done: detail.plan.done_count, total: detail.plan.item_count })}</span>
              <span className="dotsep">·</span>
              <span>{pct}%</span>
              {detail.plan.owner_agent ? (
                <>
                  <span className="dotsep">·</span>
                  <span>{t("plan.hover.owner")} {agentLabel(detail.plan.owner_agent)}</span>
                </>
              ) : null}
            </div>
          </div>
          {/* 액션은 한 덩어리다 — 좁아지면 제목 아래로 통째로 내려간다. */}
          <div className="pln-mast-actions">
            <button
              className="btn sm"
              onClick={() => onToggleLock(!locked)}
              disabled={busy}
              title={locked ? t("plan.unlockTitle") : t("plan.lockTitle")}
            >
              {locked ? t("plan.unlock") : t("plan.locked")}
            </button>
            {detail.plan.status === "done" ? (
              <button className="btn sm" onClick={onArchive} disabled={busy} title={t("plan.archiveTitle")}>
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
                <Trash2 size={13} />
              </button>
            )}
            <button type="button" className="pln-iconbtn" onClick={onRefresh} title={t("plan.refresh")}><RefreshCw size={13} /></button>
          </div>
        </div>
        {locked ? <div className="pln-mast-note">{t("plan.lockedNote")}</div> : null}

        {/* 단계 스트립 — 계획 전체를 한 줄로. 조각 = 단계, 폭 = 항목 수, 색 = 상태. */}
        {strip.length > 0 ? (
          <>
            <div className="pln-strip" role="group" aria-label={t("plan.stripAria")}>
              {strip.map((seg) => {
                const label = t("plan.stripSeg", {
                  phase: seg.phase === NO_PHASE ? t("plan.noPhase") : seg.phase,
                  done: seg.counts.done,
                  total: seg.n,
                  blocked: seg.counts.blocked,
                });
                return (
                  <button
                    key={seg.phase}
                    type="button"
                    className="pln-strip-seg"
                    style={{ "--n": seg.n } as CSSProperties}
                    title={label}
                    aria-label={label}
                    onClick={() => jumpToPhase(seg.phase)}
                  >
                    {(["done", "in_progress", "blocked", "todo"] as const)
                      .filter((k) => seg.counts[k] > 0)
                      .map((k) => <i key={k} className={k} style={{ "--n": seg.counts[k] } as CSSProperties} />)}
                  </button>
                );
              })}
            </div>
            {strip.length > 1 ? (
              <div className="pln-strip-legend" aria-hidden="true">
                <span>{strip[0].phase === NO_PHASE ? t("plan.noPhase") : strip[0].phase}</span>
                <span>{t("plan.stripCount", { phases: strip.length })}</span>
                <span>{strip[strip.length - 1].phase === NO_PHASE ? t("plan.noPhase") : strip[strip.length - 1].phase}</span>
              </div>
            ) : null}
          </>
        ) : null}

        <div className="pln-head-foot">
          <div className="pln-head-counts">
            {LEGEND.filter((s) => (counts[s] ?? 0) > 0).map((s) => (
              <span key={s} className="pln-head-count">
                <StatusMark status={s} size="sm" />
                {t(STATUS_META[s].labelKey)} <b>{counts[s]}</b>
              </span>
            ))}
          </div>
          {/* 「남은 것만」 은 문서 보기의 것이다 — 보드는 열 자체가 상태라 숨길 게 없다. */}
          {detail.plan.item_count > 0 && !board ? (
            <div className="seg" role="tablist" aria-label={t("plan.filterAria")}>
              {([false, true] as const).map((hide) => (
                <button
                  key={String(hide)}
                  type="button"
                  role="tab"
                  aria-selected={hideDone === hide}
                  className="seg-item"
                  onClick={() => onHideDoneChange(hide)}
                >
                  {hide ? t("plan.filterRemaining") : t("plan.filterAll")}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {detail.warnings.length > 0 ? (
        <div className="pln-warn">
          <div className="pln-warn-head">
            <TriangleAlert size={13} /> {t("plan.warnings", { n: detail.warnings.length })}
          </div>
          <ul>
            {detail.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      {detail.plan.item_count > 0 && !board ? (
        <NextUp items={upNext} remaining={remaining} locked={locked} onJump={jumpTo} onDispatch={onDispatch} />
      ) : null}

      {board ? (
        <PlanBoard
          items={detail.items}
          busy={busy}
          locked={locked}
          onSetStatus={onSetStatus}
          onDispatch={onDispatch}
          onOpenJournalRef={onOpenJournalRef}
        />
      ) : null}

      {/* Phases — reorder bounds are computed among real (on-disk) headings so
          the synthetic 기타 bucket never blocks moving the last real phase. */}
      {(board ? [] : phases).map(([phase, items]) => {
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
          onMoveItem={onMoveItem}
          onRenameItem={onRenameItem}
          historyFor={historyFor}
          history={history}
          onToggleHistory={onToggleHistory}
          onOpenJournalRef={onOpenJournalRef}
          resolveJournalRefs={resolveJournalRefs}
          hideDone={hideDone}
          onShowAll={() => onHideDoneChange(false)}
        />
        );
      })}

      {detail.decisions.length > 0 ? (
        <section className="pln-decisions" aria-label={t("plan.decisions")}>
          <div className="pln-decisions-title">{t("plan.decisions")}</div>
          {detail.decisions.map((d) => (
            <div className="pln-dec" key={d.decision_id}>
              <Lock size={13} />
              <div>
                <div className="pln-dec-title">{d.title}</div>
                {d.body ? <div className="pln-dec-body">{d.body}</div> : null}
                <div className="pln-dec-meta">
                  {d.locked_at ? <span>{d.locked_at}{d.agent_id ? ` · ${agentLabel(d.agent_id)}` : ""}</span> : null}
                  {d.locked_at ? <span className="dotsep">·</span> : null}
                  <span>{d.affects.length > 0 ? t("plan.affects", { list: d.affects.map((a) => `#${a}`).join(", ") }) : t("plan.noAffects")}</span>
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
