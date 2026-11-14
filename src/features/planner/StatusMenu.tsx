/**
 * 항목 상태 메뉴 — 여섯 상태를 `menuitemradio` 로 (2026-09-10 플래너 업그레이드 → 11-15 키보드).
 *
 * 마크 클릭은 앞으로 한 칸(todo→진행→완료)이라 빠르지만, 막힘·이월·폐기로는
 * 갈 수 없었다 — 그 셋은 에이전트만 쓸 수 있는 상태였다. 4.0 계획 화면의 항목
 * 상자(`PlanItems`)가 이 메뉴를 연다.
 *
 * 메뉴답게 움직인다(11-15): 열리면 지금 상태에 포커스, ↑↓ · Home/End 로 옮기고, 1~6 숫자로 바로 고르고,
 * 닫히면(고르든 Esc 든) 포커스가 상자로 돌아간다. 예전엔 role=menu 인데 포커스를 안 옮기고 화살표를 안
 * 받았으며, 고르면 포커스가 body 로 떨어졌다.
 */

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

import { CheckMark } from "@/components/Icons";
import { t } from "@/i18n";
import type { PlanItemDto } from "@/lib/bindings";
import { STATUS_META } from "./planMeta";
import { StatusMark } from "./StatusMark";

/** 열린 동안만 바깥 클릭·Escape 로 닫는다 — 일지 선택기와 상태 메뉴가 같이 쓴다. */
export function useCloseOnOutside(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  // 호출부가 인라인 화살표를 넘겨도 열린 동안 매 렌더 재구독하지 않도록 ref 로 받는다.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open]);
}

/** 상태 메뉴의 순서 — 앞으로 가는 셋, 옆으로 빠지는 셋. 숫자 키 1~6 이 이 순서다. */
export const MENU_STATUSES = ["todo", "in_progress", "done", "blocked", "deferred", "dropped"] as const;

interface StatusMenuProps {
  item: PlanItemDto;
  /** 고른 상태 — 현재와 같으면 호출부가 무시한다. */
  onPick: (status: string) => void;
  /** 고르지 않고 닫는다(Esc · Tab) — 호출부가 포커스를 상자로 돌린다. */
  onDismiss: () => void;
}

/** 팝오버 본체만 — 여닫기와 앵커(`position: relative`)는 호출부가 갖는다. */
export function StatusMenu({ item, onPick, onDismiss }: StatusMenuProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // 열리면 지금 상태에 포커스 — 거기서 화살표로 옮기거나 Enter 로 그대로 닫는다.
  useEffect(() => {
    const at = Math.max(0, MENU_STATUSES.indexOf(item.status as (typeof MENU_STATUSES)[number]));
    refs.current[at]?.focus();
    // 열릴 때 한 번 — 상태가 바뀌어 다시 그려져도 포커스를 빼앗지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = refs.current.filter((x): x is HTMLButtonElement => x != null);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (e.key === "ArrowDown") next = (at + 1) % items.length;
    else if (e.key === "ArrowUp") next = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (/^[1-6]$/.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      onPick(MENU_STATUSES[Number(e.key) - 1]);
      return;
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
      return;
    } else {
      // 메뉴 안의 글자 키(j · k · r …)는 화면 단축키로 새지 않는다.
      if (e.key.length === 1) e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    items[next]?.focus();
  };

  return (
    <div className="plv-status-pop" role="menu" aria-label={t("plan.statusMenuAria", { title: item.title })} onKeyDown={onKeyDown}>
      {MENU_STATUSES.map((s, i) => (
        <button
          key={s}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="menuitemradio"
          aria-checked={item.status === s}
          tabIndex={-1}
          className="plv-status-item"
          onClick={() => onPick(s)}
        >
          <StatusMark status={s} />
          {t(STATUS_META[s].labelKey)}
          {item.status === s ? <CheckMark size={13} className="plv-status-check" aria-hidden="true" /> : null}
          <span className="plv-status-key" aria-hidden="true">
            {i + 1}
          </span>
        </button>
      ))}
    </div>
  );
}
