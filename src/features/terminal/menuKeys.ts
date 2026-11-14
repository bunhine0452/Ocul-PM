/**
 * 터미널 화면의 팝오버 메뉴 셋 — 숨은 세션(「+3」) · 「새 세션 ▾」 · 경로의 「이 파일로 할 일」 — 이 같은 키를 쓴다.
 *
 * 열면 첫 항목에 포커스, ↑ ↓ · Home · End 로 옮기고, Esc 는 닫고 연 자리로 돌아가며, Tab 도 닫는다(포커스가
 * 메뉴 밖으로 새지 않게). 바깥을 누르거나 포커스가 메뉴 밖으로 나가면 닫는다. 키는 캡처 단계에서 받는다 —
 * 터미널(xterm)이 먼저 삼키지 않게. 대신 포커스가 메뉴 안에 있을 때만 받는다: 그러지 않으면 메뉴가 열린 채
 * 포커스가 터미널로 간 뒤 ↑(셸 기록)는 메뉴로 끌려가고 Esc(Claude 중단)는 삼켜졌다.
 */
import { useEffect, useRef, type RefObject } from "react";

const ITEM = '[role="menuitem"]';

/** `close(refocus)` — `true` 면 연 자리로 포커스를 돌려줘야 한다(Esc · Tab). */
export function useMenuKeys(
  open: boolean,
  box: RefObject<HTMLElement | null>,
  close: (refocus: boolean) => void,
  /** 바깥 클릭으로 치지 않을 자리 — 메뉴를 여는 단추. */
  keep?: RefObject<HTMLElement | null>,
): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const items = () => [...(box.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target) || keep?.current?.contains(target)) return;
      closeRef.current(false);
    };
    // 포커스가 메뉴 밖의 다른 곳(다른 칸의 터미널 등)으로 갔다. 연 단추로 돌아간 것은 그대로 둔다(누르면 토글한다).
    // 갈 곳이 없는 것(메뉴의 빈 틈을 누름 · 창이 뒤로 감)도 둔다 — 바깥 클릭은 `onDown` 이 닫는다.
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next || box.current?.contains(next) || keep?.current?.contains(next)) return;
      closeRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!box.current?.contains(document.activeElement)) return;
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current(true);
        return;
      }
      const list = items();
      if (list.length === 0) return;
      const at = list.indexOf(document.activeElement as HTMLElement);
      const to =
        e.key === "ArrowDown"
          ? (at + 1) % list.length
          : e.key === "ArrowUp"
            ? (at - 1 + list.length) % list.length
            : e.key === "Home"
              ? 0
              : e.key === "End"
                ? list.length - 1
                : null;
      if (to == null) return;
      e.preventDefault();
      e.stopPropagation();
      list[to].focus();
    };
    const el = box.current;
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    el?.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      el?.removeEventListener("focusout", onFocusOut);
    };
  }, [open, box, keep]);
}
