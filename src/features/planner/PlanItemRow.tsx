/**
 * 계획 항목 한 행 — 마크(상태 순환) · 제목 · 메타 열(일지 · 실행 · 귀속 · 동작) · 이력.
 *
 * 세 열 격자다 (2026-09-10 리디자인): `[마크 | 제목 | 메타]`. 메타는 오른쪽
 * 한 열에 모여 22px 높이로 정렬되므로 제목이 두 줄로 흘러도 열은 흔들리지
 * 않는다. 에이전트 이름은 행마다 되풀이하지 않는다 — 점(색)과 시각만 두고
 * 이름은 툴팁과 이력에 있다. 공유 어휘는 `planMeta.ts`, 마크는 `StatusMark`.
 */

import { useRef, useState } from "react";
import {
  ChevronDown,
  NotebookText,
  Pencil,
  Play,
  Trash2,
} from "@/components/Icons";
import type { PlanItemDto, PlanItemUpdateDto } from "@/lib/bindings";
import { agentColor, agentLabel } from "@/features/today/agentColor";
import { InlineMarkdown } from "@/components/InlineMarkdown";
import { t } from "@/i18n";
import { blocked } from "@/lib/blocked";
import {
  fmtWorkday,
  relativeTime,
  NEXT_STATUS,
  STATUS_META,
  type JournalRefMeta,
} from "./planMeta";
import { StatusMark } from "./StatusMark";
import { StatusMenu, useCloseOnOutside } from "./StatusMenu";


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

  useCloseOnOutside(jrefWrap, pickerOpen, () => setPickerOpen(false));

  // 상태 메뉴 — 마크 클릭은 앞으로 한 칸(todo→진행→완료)이라 빠르지만,
  // 막힘·이월·폐기로는 갈 수 없었다. 우클릭과 ▾ 버튼이 여섯 상태 전부를 연다.
  const [menuOpen, setMenuOpen] = useState(false);
  const statusWrap = useRef<HTMLSpanElement>(null);
  useCloseOnOutside(statusWrap, menuOpen, () => setMenuOpen(false));
  const canChange = !busy && !locked && !isParent;
  const pickStatus = (status: string) => {
    setMenuOpen(false);
    if (status !== item.status) onSetStatus(item, status);
  };

  // Suggestion (never auto-applied): journal work is logged against this item
  // but it isn't closed out yet → offer a one-click "완료?". Suppressed on a
  // locked plan (no edits allowed).
  const suggestDone =
    !locked && !isParent && linked.length > 0 && !["done", "dropped", "deferred"].includes(item.status);
  const dispatchable = !locked && !["done", "dropped"].includes(item.status);

  const rowClass =
    "pln-it is-" + item.status + (item.parent_item ? " is-child" : "") + (isParent ? " is-parent" : "");

  return (
    <div className={rowClass} data-item-id={item.item_id}>
      <span className="pln-status-wrap" ref={statusWrap}>
        <button
          type="button"
          className="pln-item-glyph"
          onClick={() => onSetStatus(item, NEXT_STATUS[item.status] ?? "in_progress")}
          onContextMenu={(e) => {
            if (!canChange) return;
            e.preventDefault();
            setMenuOpen((o) => !o);
          }}
          {...blocked(
            isParent
              ? t("plan.statusParent", { label: t(meta.labelKey) })
              : locked
                ? t("plan.statusLocked", { label: t(meta.labelKey) })
                : null,
            t("plan.statusClick", { label: t(meta.labelKey) }),
          )}
          disabled={busy}
          aria-label={t(meta.labelKey)}
        >
          <StatusMark status={item.status} />
        </button>
        {menuOpen ? <StatusMenu item={item} onPick={pickStatus} /> : null}
      </span>

      <div className="pln-item-main">
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
        {suggestDone && !editing ? (
          <button
            type="button"
            className="pln-done-hint"
            onClick={() => onSetStatus(item, "done")}
            title={t("plan.markDoneTitle")}
          >
            {t("plan.markDone")}
          </button>
        ) : null}
        {item.note ? (
          <InlineMarkdown className="pln-item-note" text={item.note} />
        ) : null}

        {historyOpen ? (
          <div className="pln-item-history">
            {history == null ? (
              <span>{t("plan.historyLoading")}</span>
            ) : history.length === 0 ? (
              <span>{t("plan.noHistory")}</span>
            ) : (
              history.map((u, i) => (
                <div key={i} className="pln-hist-row">
                  <span className="pln-agent-dot" style={{ background: agentColor(u.agent_id) }} />
                  <span>{agentLabel(u.agent_id)}</span>
                  <span style={{ color: "var(--text-3)" }}>
                    {t(STATUS_META[u.from_status ?? ""]?.labelKey ?? "plan.status.todo")}
                    {" → "}
                    {t(STATUS_META[u.to_status ?? ""]?.labelKey ?? "plan.status.todo")}
                    {" · "}
                    {relativeTime(u.ts)}
                  </span>
                  {u.journal_ref ? (
                    <button
                      type="button"
                      className="pln-act"
                      onClick={() => onOpenJournalRef(u.journal_ref!)}
                      title={t("plan.gotoEntry", { ref: u.journal_ref })}
                    >
                      <NotebookText size={11} strokeWidth={2} />
                      <span>{t("plan.entryLabel")}</span>
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className="pln-item-meta">
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
                {!isParent ? (
                  <button type="button" className="pln-iconbtn" onClick={() => setMenuOpen((o) => !o)} disabled={busy} title={t("plan.statusMenu")} aria-haspopup="menu" aria-expanded={menuOpen}>
                    <ChevronDown size={13} />
                  </button>
                ) : null}
                <button type="button" className="pln-iconbtn" onClick={() => setEditing(true)} disabled={busy} title={t("plan.itemRename")}>
                  <Pencil size={13} />
                </button>
                <button type="button" className="pln-iconbtn danger" onClick={() => setConfirmDel(true)} disabled={busy} title={t("plan.itemDelete")}>
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        ) : null}
        {dispatchable ? (
          <button
            type="button"
            className="pln-act accent is-quiet"
            onClick={() => onDispatch(item)}
            title={t("plan.dispatchTitle")}
          >
            <Play size={11} strokeWidth={2.2} />
            <span>{t("plan.dispatch")}</span>
          </button>
        ) : null}
        {linked.length > 0 ? (
          <span className="jref-wrap" ref={jrefWrap}>
            <button
              type="button"
              className="pln-jref"
              onClick={handleJournalBtn}
              title={multiLinked ? t("plan.linkedMulti", { n: linked.length }) : t("plan.linkedOne")}
              aria-label={multiLinked ? t("plan.linkedMulti", { n: linked.length }) : t("plan.linkedOne")}
              aria-haspopup={multiLinked ? "menu" : undefined}
              aria-expanded={multiLinked ? pickerOpen : undefined}
            >
              <NotebookText size={13} strokeWidth={2} />
              {multiLinked ? <span>{linked.length}</span> : null}
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
        {item.last_agent ? (
          <button
            type="button"
            className="pln-item-agent"
            onClick={() => onToggleHistory(item.item_id)}
            title={`${agentLabel(item.last_agent)} · ${relativeTime(item.last_update)} — ${t("plan.history")}`}
            aria-expanded={historyOpen}
          >
            <span className="pln-agent-dot" style={{ background: agentColor(item.last_agent) }} />
            <span className="pln-agent-time">{relativeTime(item.last_update)}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
