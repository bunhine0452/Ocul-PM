/**
 * 계획 보드 — 같은 항목을 상태별 열로 (2026-09-10 플래너 업그레이드, 칸반 뷰).
 *
 * 문서형 체크리스트는 「단계 안에서 무엇이 어디까지 왔나」 를 읽기 좋고, 보드는
 * 「지금 막힌 게 몇 개고 진행중이 몇 개인가」 를 한눈에 센다. 데이터는 하나
 * (`PlanDetail.items`)이고 배치만 다르다 — SSOT 인 `.oculpm/planner/*.md` 에는
 * 열이라는 개념이 없으므로 여기서 새로 저장하는 것은 없다.
 *
 * - 리프만 싣는다. 부모는 롤업이라 카드로 두면 하위와 이중 계산된다. 대신
 *   하위 카드에 부모 제목을 빵부스러기로 단다.
 * - 열 사이 드래그 = `set_status`. 문서 행의 마크와 같은 `onSetStatus` 로
 *   가므로 완료 소프트 게이트(검증 일지 없음 확인)도 그대로 거친다.
 * - 완료 열은 길어지기 쉬워 앞 몇 장만 펼치고 「N개 더 보기」 로 연다.
 * - 열은 면이 아니라 위 선 하나로 나뉜다 (2026-09-10 리디자인) — 색은 상태.
 */

import { useRef, useState, type DragEvent } from "react";

import { ChevronDown, NotebookText, Play } from "@/components/Icons";
import { InlineMarkdown } from "@/components/InlineMarkdown";
import { agentColor, agentLabel } from "@/features/today/agentColor";
import { t } from "@/i18n";
import type { PlanItemDto } from "@/lib/bindings";
import {
  BOARD_COLUMNS,
  BOARD_OPTIONAL_COLUMNS,
  leafItems,
  relativeTime,
  STATUS_META,
} from "./planMeta";
import { StatusMark } from "./StatusMark";
import { StatusMenu, useCloseOnOutside } from "./StatusMenu";

/** 완료 열이 처음에 펼치는 카드 수 — 32장짜리 완료 벽을 보드에 옮겨 오지 않는다. */
export const BOARD_DONE_PREVIEW = 8;

const DRAG_MIME = "application/x-oculpm-plan-item";

interface PlanBoardProps {
  items: PlanItemDto[];
  busy: boolean;
  locked: boolean;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  onDispatch: (item: PlanItemDto) => void;
  onOpenJournalRef: (ref: string) => void;
}

export function PlanBoard({ items, busy, locked, onSetStatus, onDispatch, onOpenJournalRef }: PlanBoardProps) {
  const leaves = leafItems(items);
  const titleOf = new Map(items.map((i) => [i.item_id, i.title] as const));
  const byStatus = new Map<string, PlanItemDto[]>();
  for (const it of leaves) {
    if (!byStatus.has(it.status)) byStatus.set(it.status, []);
    byStatus.get(it.status)!.push(it);
  }
  const columns: string[] = [
    ...BOARD_COLUMNS,
    ...BOARD_OPTIONAL_COLUMNS.filter((s) => (byStatus.get(s)?.length ?? 0) > 0),
  ];

  const [over, setOver] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const canDrag = !busy && !locked;

  const onDragStart = (e: DragEvent, item: PlanItemDto) => {
    e.dataTransfer.setData(DRAG_MIME, item.item_id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (e: DragEvent, status: string) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG_MIME);
    const item = leaves.find((i) => i.item_id === id);
    if (!item || item.status === status || !canDrag) return;
    onSetStatus(item, status);
  };

  return (
    <div className="pln-board" role="list" aria-label={t("plan.view.board")}>
      {columns.map((status) => {
        const meta = STATUS_META[status] ?? STATUS_META.todo;
        const all = byStatus.get(status) ?? [];
        const preview = status === "done" && !expanded[status] ? all.slice(0, BOARD_DONE_PREVIEW) : all;
        const rest = all.length - preview.length;
        return (
          <section
            key={status}
            role="listitem"
            className={"pln-col is-" + status + (over === status ? " is-over" : "")}
            aria-label={`${t(meta.labelKey)} ${all.length}`}
            onDragOver={(e) => {
              if (!canDrag || !e.dataTransfer.types.includes(DRAG_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== status) setOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => onDrop(e, status)}
          >
            <header className="pln-col-head">
              <StatusMark status={status} size="sm" />
              <span className="pln-col-title">{t(meta.labelKey)}</span>
              <span className="pln-col-count">{all.length}</span>
            </header>
            <div className="pln-col-body">
              {all.length === 0 ? (
                <div className="pln-col-empty">{t("plan.board.empty")}</div>
              ) : (
                preview.map((it) => (
                  <BoardCard
                    key={it.item_id}
                    item={it}
                    parentTitle={it.parent_item ? titleOf.get(it.parent_item) ?? null : null}
                    canDrag={canDrag}
                    locked={locked}
                    onDragStart={onDragStart}
                    onSetStatus={onSetStatus}
                    onDispatch={onDispatch}
                    onOpenJournalRef={onOpenJournalRef}
                  />
                ))
              )}
              {rest > 0 ? (
                <button
                  type="button"
                  className="pln-textbtn pln-col-more"
                  onClick={() => setExpanded((x) => ({ ...x, [status]: true }))}
                >
                  {t("plan.board.more", { n: rest })}
                </button>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

interface BoardCardProps {
  item: PlanItemDto;
  parentTitle: string | null;
  canDrag: boolean;
  locked: boolean;
  onDragStart: (e: DragEvent, item: PlanItemDto) => void;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  onDispatch: (item: PlanItemDto) => void;
  onOpenJournalRef: (ref: string) => void;
}

function BoardCard({ item, parentTitle, canDrag, locked, onDragStart, onSetStatus, onDispatch, onOpenJournalRef }: BoardCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useCloseOnOutside(wrap, menuOpen, () => setMenuOpen(false));
  const linked = item.journal_refs ?? [];
  const dispatchable = !locked && !["done", "dropped"].includes(item.status);

  return (
    <article
      className={"pln-card" + (canDrag ? " is-draggable" : "")}
      draggable={canDrag}
      onDragStart={(e) => onDragStart(e, item)}
      data-item-id={item.item_id}
    >
      {parentTitle ? (
        <InlineMarkdown className="pln-card-parent" text={parentTitle} linkable={false} />
      ) : null}
      <InlineMarkdown className={"pln-card-title" + (item.status === "done" ? " done" : "")} text={item.title} />
      <div className="pln-card-foot">
        {item.phase ? <InlineMarkdown className="pln-card-phase" text={item.phase} linkable={false} /> : null}
        {item.last_agent ? (
          <span className="pln-card-agent" title={`${agentLabel(item.last_agent)} · ${relativeTime(item.last_update)}`}>
            <span className="pln-agent-dot" style={{ background: agentColor(item.last_agent) }} />
            {relativeTime(item.last_update)}
          </span>
        ) : null}
        <span className="pln-card-actions" ref={wrap}>
          {linked.length > 0 ? (
            <button
              type="button"
              className="pln-iconbtn"
              title={linked.length > 1 ? t("plan.linkedMulti", { n: linked.length }) : t("plan.linkedOne")}
              onClick={() => onOpenJournalRef(linked[linked.length - 1])}
            >
              <NotebookText size={13} strokeWidth={2} />
            </button>
          ) : null}
          {dispatchable ? (
            <button type="button" className="pln-iconbtn" title={t("plan.dispatchTitle")} onClick={() => onDispatch(item)}>
              <Play size={13} strokeWidth={2} />
            </button>
          ) : null}
          {!locked ? (
            <button
              type="button"
              className="pln-iconbtn"
              title={t("plan.statusMenu")}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <ChevronDown size={13} />
            </button>
          ) : null}
          {menuOpen ? (
            <StatusMenu
              item={item}
              onPick={(s) => {
                setMenuOpen(false);
                if (s !== item.status) onSetStatus(item, s);
              }}
            />
          ) : null}
        </span>
      </div>
    </article>
  );
}
