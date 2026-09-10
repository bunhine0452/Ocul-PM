/**
 * 항목 상태 메뉴 — 여섯 상태를 `menuitemradio` 로 (2026-09-10 플래너 업그레이드).
 *
 * 마크 클릭은 앞으로 한 칸(todo→진행→완료)이라 빠르지만, 막힘·이월·폐기로는
 * 갈 수 없었다 — 그 셋은 에이전트만 쓸 수 있는 상태였다. 문서 행(`PlanItemRow`)
 * 과 보드 카드(`PlanBoard`)가 같은 메뉴를 쓴다.
 */

import { useEffect, useRef, type RefObject } from "react";

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
    const onKey = (e: KeyboardEvent) => {
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

/** 상태 메뉴의 순서 — 앞으로 가는 셋, 옆으로 빠지는 셋. */
export const MENU_STATUSES = ["todo", "in_progress", "done", "blocked", "deferred", "dropped"] as const;

interface StatusMenuProps {
  item: PlanItemDto;
  /** 고른 상태 — 현재와 같으면 호출부가 무시한다. */
  onPick: (status: string) => void;
}

/** 팝오버 본체만 — 여닫기와 앵커(`position: relative`)는 호출부가 갖는다. */
export function StatusMenu({ item, onPick }: StatusMenuProps) {
  return (
    <div className="pln-status-pop" role="menu" aria-label={t("plan.statusMenuAria", { title: item.title })}>
      {MENU_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          role="menuitemradio"
          aria-checked={item.status === s}
          className="pln-status-item"
          onClick={() => onPick(s)}
        >
          <StatusMark status={s} size="sm" />
          {t(STATUS_META[s].labelKey)}
        </button>
      ))}
    </div>
  );
}
