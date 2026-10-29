/**
 * 단계들을 2열 격자로 — 항목은 상태 상자 · 문구 · 사람 몫/막힘 칩 (시안 Plan).
 *
 * **끝난 단계는 한 줄로 접는다**(「engine · 4/4 ✓」, 누르면 펼침) — 25항목 중 23개가 끝난
 * 계획이 체크 표시 23줄로 남은 둘을 묻었다. 남은 단계가 먼저, 끝난 단계는 그 뒤 (4.0 「더 단순하게」).
 *
 * 상자를 누르면 상태 메뉴(`StatusMenu`)가 열린다. 부모 항목은 하위의 롤업이라 메뉴가
 * 없고, 끝난(잠긴) 계획은 아무것도 바꾸지 않는다.
 */

import { useRef, useState } from "react";

import { Check, ChevronRight } from "@/components/Icons";

import { useT } from "@/i18n";
import type { PlanItemDto } from "@/lib/bindings";
import { doneOfTotal, isUserItem, NO_PHASE, phasesOf, STATUS_META, stripUserTag } from "./planMeta";
import { StatusMark } from "./StatusMark";
import { StatusMenu, useCloseOnOutside } from "./StatusMenu";

interface ItemProps {
  item: PlanItemDto;
  depth: number;
  parent: boolean;
  locked: boolean;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  onOpenJournal: (ref: string) => void;
}

function PlanItemLine({ item, depth, parent, locked, onSetStatus, onOpenJournal }: ItemProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement | null>(null);
  useCloseOnOutside(anchor, open, () => setOpen(false));
  const title = stripUserTag(item.title);
  const statusLabel = t(STATUS_META[item.status]?.labelKey ?? "plan.status.todo");
  const showNote = item.note && (item.status === "in_progress" || item.status === "blocked");
  const lastRef = item.journal_refs[item.journal_refs.length - 1];
  return (
    <div className={"plv-item is-" + item.status + (parent ? " is-parent" : "")} style={depth > 0 ? { paddingLeft: depth * 18 } : undefined}>
      <span className="plv-anchor" ref={anchor}>
        <button
          type="button"
          className="plv-box-btn"
          aria-label={t("plan.item.statusAria", { title, status: statusLabel })}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={locked || parent}
          onClick={() => setOpen((v) => !v)}
        >
          <StatusMark status={item.status} />
        </button>
        {open ? (
          <StatusMenu
            item={item}
            onPick={(s) => {
              setOpen(false);
              if (s !== item.status) onSetStatus(item, s);
            }}
          />
        ) : null}
      </span>
      <span className="plv-item-t">{title}</span>
      {isUserItem(item.title) ? <span className="chip sm accent">{t("plan.item.user")}</span> : null}
      {item.status === "blocked" ? <span className="chip sm danger">{t("plan.status.blocked")}</span> : null}
      {showNote ? <span className="plv-meta plv-item-note">· {item.note}</span> : null}
      {lastRef ? (
        <button
          type="button"
          className="btn ghost sm plv-item-j"
          aria-label={t("plan.item.journalAria", { title })}
          onClick={() => onOpenJournal(lastRef)}
        >
          {t("plan.item.journal")}
        </button>
      ) : null}
    </div>
  );
}

export function PlanItems({
  items,
  locked,
  onSetStatus,
  onOpenJournal,
}: {
  items: PlanItemDto[];
  locked: boolean;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  onOpenJournal: (ref: string) => void;
}) {
  const { t } = useT();
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const groups = phasesOf(items).map((g) => ({ ...g, ...doneOfTotal(g.items.map((r) => r.item)) }));
  const finished = (g: (typeof groups)[number]) => g.total > 0 && g.done === g.total;
  const nameOf = (phase: string) => (phase === NO_PHASE ? t("plan.noPhase") : phase);
  // 남은 단계(와 펼친 끝난 단계)는 격자로, 접힌 끝난 단계는 그 아래 한 줄에 모은다.
  const shown = groups.filter((g) => !finished(g) || opened.has(g.phase));
  const folded = groups.filter((g) => finished(g) && !opened.has(g.phase));
  return (
    <div className="plv-phases">
      {shown.map((g) => {
        const { done, total } = g;
        const name = nameOf(g.phase);
        return (
          <section key={g.phase} className="plv-phase" aria-label={name}>
            <h3 className="plv-sec-h">
              {name} · {done}/{total}
            </h3>
            {g.items.map((r) => (
              <PlanItemLine
                key={r.item.item_id}
                item={r.item}
                depth={r.depth}
                parent={r.parent}
                locked={locked}
                onSetStatus={onSetStatus}
                onOpenJournal={onOpenJournal}
              />
            ))}
          </section>
        );
      })}
      {folded.length > 0 ? (
        <div className="plv-done-row">
          {folded.map((g) => (
            <button
              key={g.phase}
              type="button"
              className="plv-phase-done"
              aria-expanded={false}
              onClick={() => setOpened((prev) => new Set(prev).add(g.phase))}
            >
              <ChevronRight size={13} aria-hidden="true" />
              <span className="plv-item-t">{nameOf(g.phase)}</span>
              <span className="plv-meta">
                {g.done}/{g.total}
              </span>
              <Check size={13} className="plv-phase-ok" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
