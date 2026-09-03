/**
 * 계획 항목 한 행 — 글리프(상태 순환) · 제목 · 연결 일지 · 귀속 · 이력.
 *
 * `PlannerScreenV2` 에서 그대로 분리했다 (정리 라운드 2026-09-03). 공유 어휘는
 * `planMeta.ts` 에 있고, 이 파일은 한 행을 그리는 일만 한다.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ChevronDown,
  Clock,
  NotebookText,
  Pencil,
  Play,
  Trash2,
} from "@/components/Icons";
import type { PlanItemDto, PlanItemUpdateDto } from "@/lib/bindings";
import { agentColor, agentLabel } from "@/features/today/agentColor";
import { InlineMarkdown } from "@/components/InlineMarkdown";
import { t } from "@/i18n";
import {
  fmtWorkday,
  relativeTime,
  NEXT_STATUS,
  STATUS_META,
  type JournalRefMeta,
} from "./planMeta";


export interface PlanItemRowProps {
  item: PlanItemDto;
  busy: boolean;
  locked: boolean;
  /** 3-depth — 하위를 가진 부모: 상태는 롤업 파생이라 직접 조작 불가. */
  isParent: boolean;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  /** IN2 — 이 항목을 터미널에서 Claude Code 로 실행 (프롬프트 프리필). */
  onDispatch: (item: PlanItemDto) => void;
  onRemove: (item: PlanItemDto) => void;
  onRename: (item: PlanItemDto, title: string) => void;
  historyOpen: boolean;
  history: PlanItemUpdateDto[] | null;
  onToggleHistory: (itemId: string) => void;
  onOpenJournalRef: (ref: string) => void;
  resolveJournalRefs: (refs: string[]) => Promise<JournalRefMeta[]>;
}

export function PlanItemRow({ item, busy, locked, isParent, onSetStatus, onDispatch, onRemove, onRename, historyOpen, history, onToggleHistory, onOpenJournalRef, resolveJournalRefs }: PlanItemRowProps) {
  const meta = STATUS_META[item.status] ?? STATUS_META.todo;
  const indent = item.parent_item ? 22 : 0;
  const linked = item.journal_refs ?? [];
  const multiLinked = linked.length > 1;

  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  // Multi-journal picker: one linked entry opens directly; several show a
  // date+title chooser. Metas resolve lazily on first open.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refMetas, setRefMetas] = useState<JournalRefMeta[] | null>(null);
  const jrefWrap = useRef<HTMLSpanElement>(null);

  const handleJournalBtn = () => {
    if (!multiLinked) {
      onOpenJournalRef(linked[0]);
      return;
    }
    setPickerOpen((o) => !o);
    if (refMetas == null) void resolveJournalRefs(linked).then(setRefMetas);
  };

  // Close the picker on an outside click (only while open).
  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (jrefWrap.current && !jrefWrap.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickerOpen]);

  // Suggestion (never auto-applied): journal work is logged against this item
  // but it isn't closed out yet → offer a one-click "완료?". Suppressed on a
  // locked plan (no edits allowed).
  const suggestDone =
    !locked && !isParent && linked.length > 0 && !["done", "dropped", "deferred"].includes(item.status);
  return (
    <div className="subtask pln-item" style={{ "--pln-indent": `${indent}px` } as CSSProperties}>
      <button
        type="button"
        className="pln-item-glyph"
        onClick={() => onSetStatus(item, NEXT_STATUS[item.status] ?? "in_progress")}
        disabled={busy || locked || isParent}
        title={
          isParent
            ? t("plan.statusParent", { label: t(meta.labelKey) })
            : locked
              ? t("plan.statusLocked", { label: t(meta.labelKey) })
              : t("plan.statusClick", { label: t(meta.labelKey) })
        }
        style={{ color: meta.color, cursor: busy || locked || isParent ? "default" : "pointer" }}
      >
        {meta.glyph}
      </button>

      <div className="pln-item-main">
        {/* 제목 묶음과 메타 묶음은 **한 줄에서 시작해 좁아지면 접힌다** —
            `.pln-item-line` 이 wrap 이고 제목 쪽에 flex-basis 가 있어서, 남는
            폭이 그 아래로 내려가면 실행/에이전트/액션이 통째로 다음 줄로
            빠진다. 예전처럼 제목만 0px 로 눌려 세로로 서는 일이 없다. */}
        <div className="pln-item-line">
          <div className="pln-item-text">
            {editing ? (
              <input
                autoFocus
                className="sub-title-input"
                defaultValue={item.title}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onRename(item, (e.target as HTMLInputElement).value);
                    setEditing(false);
                  }
                  if (e.key === "Escape") setEditing(false);
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== item.title) onRename(item, v);
                  setEditing(false);
                }}
              />
            ) : (
              // 제목은 `.oculpm/planner/*.md` 에서 온 마크다운이다 — `**강조**`
              // 와 `` `코드` `` 를 기호째 노출하지 않고 렌더한다.
              <InlineMarkdown className={"sub-title" + (item.status === "done" ? " done" : "")} text={item.title} />
            )}
            {item.note ? (
              <InlineMarkdown className="pln-item-note" text={`— ${item.note}`} />
            ) : null}
            {linked.length > 0 ? (
              <span className="jref-wrap" ref={jrefWrap}>
                <button
                  type="button"
                  className="jref-btn"
                  onClick={handleJournalBtn}
                  title={multiLinked ? t("plan.linkedMulti", { n: linked.length }) : t("plan.linkedOne")}
                  aria-haspopup={multiLinked ? "menu" : undefined}
                  aria-expanded={multiLinked ? pickerOpen : undefined}
                >
                  <NotebookText size={13} strokeWidth={2} />
                  <span>{t("plan.entryLabel")}{multiLinked ? ` ${linked.length}` : ""}</span>
                  {multiLinked ? <ChevronDown size={12} /> : null}
                </button>
                {multiLinked && pickerOpen ? (
                  <div className="jref-pop" role="menu">
                    {refMetas == null ? (
                      <div className="jref-pop-loading">{t("common.loading")}</div>
                    ) : (
                      refMetas.map((m) => (
                        <button
                          key={m.ref}
                          type="button"
                          role="menuitem"
                          className="jref-pop-item"
                          onClick={() => {
                            setPickerOpen(false);
                            onOpenJournalRef(m.ref);
                          }}
                        >
                          <span className="jref-pop-date">{fmtWorkday(m.workday)}</span>
                          <span className="jref-pop-title">{m.title}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </span>
            ) : null}
            {suggestDone ? (
              <button
                type="button"
                className="pln-done-hint"
                onClick={() => onSetStatus(item, "done")}
                title={t("plan.markDoneTitle")}
              >
                {t("plan.markDone")}
              </button>
            ) : null}
          </div>

          <div className="pln-item-meta">
            {!locked && !["done", "dropped"].includes(item.status) ? (
              <button
                type="button"
                className="jref-btn"
                onClick={() => onDispatch(item)}
                title={t("plan.dispatchTitle")}
              >
                <Play size={12} strokeWidth={2} />
                <span>{t("plan.dispatch")}</span>
              </button>
            ) : null}
            {item.last_agent ? (
              <button
                type="button"
                className="pln-item-agent"
                onClick={() => onToggleHistory(item.item_id)}
                title={t("plan.history")}
              >
                <span className="pln-agent-dot" style={{ background: agentColor(item.last_agent) }} />
                <span className="pln-agent-name">{agentLabel(item.last_agent)}</span>
                <span className="pln-agent-time">· {relativeTime(item.last_update)}</span>
                <Clock size={11} />
              </button>
            ) : null}

            {!locked && !editing ? (
              <div className={"item-actions" + (confirmDel ? " is-active" : "")}>
                {confirmDel ? (
                  <>
                    <button type="button" className="pln-textbtn danger" onClick={() => { setConfirmDel(false); onRemove(item); }} disabled={busy} title={t("plan.itemDeleteConfirm")}>
                      {t("plan.itemDeleteConfirm")}
                    </button>
                    <button type="button" className="pln-textbtn" onClick={() => setConfirmDel(false)}>{t("common.cancel")}</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="pln-iconbtn" onClick={() => setEditing(true)} disabled={busy} title={t("plan.itemRename")}>
                      <Pencil size={12} />
                    </button>
                    <button type="button" className="pln-iconbtn danger" onClick={() => setConfirmDel(true)} disabled={busy} title={t("plan.itemDelete")}>
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {historyOpen ? (
          <div className="pln-item-history">
            {history == null ? (
              <span style={{ color: "var(--text-3)" }}>{t("plan.historyLoading")}</span>
            ) : history.length === 0 ? (
              <span style={{ color: "var(--text-3)" }}>{t("plan.noHistory")}</span>
            ) : (
              history.map((u, i) => (
                <div key={i} className="pln-hist-row">
                  <span className="pln-agent-dot" style={{ background: agentColor(u.agent_id) }} />
                  <span>{agentLabel(u.agent_id)}</span>
                  <span style={{ color: "var(--text-3)" }}>
                    {u.from_status ?? "?"}→{u.to_status ?? "?"} · {relativeTime(u.ts)}
                  </span>
                  {u.journal_ref ? (
                    <button
                      type="button"
                      className="jref-btn"
                      onClick={() => onOpenJournalRef(u.journal_ref!)}
                      title={t("plan.gotoEntry", { ref: u.journal_ref })}
                    >
                      <NotebookText size={13} strokeWidth={2} />
                      <span>{t("plan.entryLabel")}</span>
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}