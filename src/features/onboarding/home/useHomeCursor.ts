/**
 * 메인 화면 키보드 커서.
 *
 * **`role="listbox"` / `aria-activedescendant` 를 쓰지 않는다.** 실기
 * VoiceOver/NVDA 의 지원 편차가 실재하고 axe 는 그걸 잡지 못하며, 이
 * 코드베이스에 combobox/listbox 선례도 없다. 대신 표준이고 100% 지원되는
 * **실제 포커스 이동 + 로빙 tabindex** 로 간다 — 스크린리더가 포커스 이동을
 * 자동으로 읽으므로 별도 공지도 필요 없다.
 *
 * 탭 스톱은 목록 전체에서 1개다 (프로젝트가 50개여도 Tab 을 50번 누를 일이
 * 없다). 목록 안 이동은 ↑↓ 가 맡는다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { HomeRow } from "./homeModel";

export interface UseHomeCursor {
  /** 현재 커서 행 id (로빙 tabindex 대상). */
  id: string | null;
  row: HomeRow | null;
  /** 행 엘리먼트 등록 — 포커스 이동에 필요. */
  register: (id: string, el: HTMLElement | null) => void;
  /** 검색 입력에서 ↓ 를 눌렀을 때: 첫 행으로 실제 포커스 이동. */
  focusFirst: () => void;
  /** 행에서의 키 처리 (↑↓ Home End). */
  onRowKeyDown: (e: React.KeyboardEvent) => void;
  /** 행이 실제로 포커스를 받으면 커서를 동기화. */
  onRowFocus: (id: string) => void;
  /**
   * 포인터가 행 위에서 **움직일 때** 커서 동기화.
   * `mouseenter` 가 아니라 `mousemove` 인 이유: 키보드로 이동하는 동안 마우스
   * 커서가 우연히 어떤 행 위에 멈춰 있으면, enter 기반은 스크롤로 행이 포인터
   * 밑을 지나가는 것만으로 커서를 빼앗아 간다.
   */
  onRowPointerMove: (id: string) => void;
  /** 커서 행이 실제로 포커스를 갖고 있는가 (파괴적 단축키의 전제 조건). */
  isFocusedRow: () => boolean;
  /** 커서를 비운다 (Esc 2단의 2단계). */
  reset: () => void;
}

export function useHomeCursor(args: {
  flat: HomeRow[];
  searchRef: React.RefObject<HTMLInputElement | null>;
}): UseHomeCursor {
  const { flat, searchRef } = args;
  const [id, setId] = useState<string | null>(null);
  const els = useRef(new Map<string, HTMLElement>());

  const register = useCallback((rowId: string, el: HTMLElement | null) => {
    if (el) els.current.set(rowId, el);
    else els.current.delete(rowId);
  }, []);

  // 목록이 다시 계산돼 커서 행이 사라지면(검색어 변경·프로젝트 삭제) 커서를
  // 비운다. 엉뚱한 행이 커서를 물려받아 ⏎ 가 다른 프로젝트를 여는 것보다
  // 아무것도 선택되지 않은 편이 안전하다.
  useEffect(() => {
    if (id !== null && !flat.some((r) => r.id === id)) setId(null);
  }, [flat, id]);

  const focusRow = useCallback((rowId: string) => {
    const el = els.current.get(rowId);
    if (!el) return;
    setId(rowId);
    el.focus();
    // smooth 금지 — App.css 와 base.css 에 scroll-behavior 가 이중 정의돼
    // ShellV2 로드 여부로 동작이 갈린다 (비결정성).
    el.scrollIntoView({ block: "nearest" });
  }, []);

  const focusFirst = useCallback(() => {
    if (flat.length > 0) focusRow(flat[0].id);
  }, [flat, focusRow]);

  const move = useCallback(
    (delta: number) => {
      if (flat.length === 0) return;
      const cur = id === null ? -1 : flat.findIndex((r) => r.id === id);
      const next = cur + delta;

      // 첫 행에서 ↑ → 검색 입력으로 돌아간다 (랩어라운드 없음).
      if (next < 0) {
        setId(null);
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (next >= flat.length) return;
      focusRow(flat[next].id);
    },
    [flat, id, focusRow, searchRef],
  );

  const onRowKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "Home":
          e.preventDefault();
          if (flat.length > 0) focusRow(flat[0].id);
          break;
        case "End":
          e.preventDefault();
          if (flat.length > 0) focusRow(flat[flat.length - 1].id);
          break;
        default:
          break;
      }
    },
    [move, flat, focusRow],
  );

  const onRowFocus = useCallback((rowId: string) => setId(rowId), []);

  const onRowPointerMove = useCallback(
    (rowId: string) => setId((prev) => (prev === rowId ? prev : rowId)),
    [],
  );

  /**
   * 커서가 **키보드로** 놓인 것인지. 마우스가 스쳐 지나간 행을 대상으로
   * `⌘E`(이름 변경)·`⌘⌫`(제거)가 발동하면 안 된다 — 포인터는 화면을 가로지르며
   * 아무 행이나 지나가지만 사용자의 의도는 그게 아니다. 파괴적 액션은 실제로
   * 포커스를 가진 행에만 적용한다.
   */
  const isFocusedRow = useCallback(() => {
    if (id === null) return false;
    const el = els.current.get(id);
    return !!el && el === document.activeElement;
  }, [id]);

  const reset = useCallback(() => setId(null), []);

  return {
    id,
    row: flat.find((r) => r.id === id) ?? null,
    register,
    focusFirst,
    onRowKeyDown,
    onRowFocus,
    onRowPointerMove,
    isFocusedRow,
    reset,
  };
}
