import { useRef, useState } from "react";
import { MoreHorizontal } from "@/components/Icons";
import { useT, type I18nKey } from "@/i18n";
import type { PlanGroup, PlanSort } from "./planList";
import { useCloseOnOutside } from "./StatusMenu";

/**
 * 계획 레일의 옵션 메뉴 (2026-09-11 레일 리디자인).
 *
 * 예전엔 정렬·묶기가 네이티브 `<select>` 둘로 레일 머리에 늘 서 있었고,
 * 접기·좌우 이동은 화면 툴바에 아이콘 둘로 나가 있었다 — 같은 도형(패널)의
 * 글리프가 나란히 서서 무엇이 무엇인지 읽히지 않았다. 넷 다 **가끔 바꾸는
 * 설정**이라 한 메뉴로 접는다. 정렬·묶기는 `menuitemradio`, 나머지 둘은
 * `menuitem`.
 */

const SORTS: { id: PlanSort; key: I18nKey }[] = [
  { id: "recent", key: "plan.rail.sort.recent" },
  { id: "progress", key: "plan.rail.sort.progress" },
  { id: "remaining", key: "plan.rail.sort.remaining" },
  { id: "title", key: "plan.rail.sort.title" },
];
const GROUPS: { id: PlanGroup; key: I18nKey }[] = [
  { id: "status", key: "plan.rail.group.status" },
  { id: "recency", key: "plan.rail.group.recency" },
  { id: "agent", key: "plan.rail.group.agent" },
  { id: "none", key: "plan.rail.group.none" },
];

interface PlanRailMenuProps {
  sort: PlanSort;
  onSortChange: (sort: PlanSort) => void;
  group: PlanGroup;
  onGroupChange: (group: PlanGroup) => void;
  side: "left" | "right";
  onSideToggle: () => void;
  onCollapse: () => void;
}

export function PlanRailMenu({
  sort,
  onSortChange,
  group,
  onGroupChange,
  side,
  onSideToggle,
  onCollapse,
}: PlanRailMenuProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutside(ref, open, () => setOpen(false));

  const radio = <T extends string>(
    items: { id: T; key: I18nKey }[],
    value: T,
    pick: (v: T) => void,
  ) =>
    items.map((it) => (
      <button
        key={it.id}
        type="button"
        role="menuitemradio"
        aria-checked={value === it.id}
        className="pln-status-item"
        onClick={() => {
          pick(it.id);
          setOpen(false);
        }}
      >
        {t(it.key)}
      </button>
    ));

  return (
    <div className="pln-rail-menu" ref={ref}>
      <button
        type="button"
        className="pln-iconbtn"
        aria-label={t("plan.rail.optionsAria")}
        title={t("plan.rail.optionsAria")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={15} />
      </button>
      {open ? (
        <div className="pln-status-pop pln-rail-pop" role="menu" aria-label={t("plan.rail.optionsAria")}>
          <div className="pln-rail-pop-head">{t("plan.rail.sortAria")}</div>
          {radio(SORTS, sort, onSortChange)}
          <div className="pln-rail-pop-head">{t("plan.rail.groupAria")}</div>
          {radio(GROUPS, group, onGroupChange)}
          <div className="pln-rail-pop-sep" />
          <button
            type="button"
            role="menuitem"
            className="pln-status-item"
            onClick={() => {
              setOpen(false);
              onSideToggle();
            }}
          >
            {t(side === "right" ? "plan.railToLeft" : "plan.railToRight")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="pln-status-item"
            onClick={() => {
              setOpen(false);
              onCollapse();
            }}
          >
            {t("plan.railCollapse")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
