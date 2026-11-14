import { useEffect } from "react";

/**
 * useModalBehavior — 모달 공통 동작 훅 (v2 U13, docs/20260706_v2/01-ux-spec.md §5).
 *
 * 배경: 오버레이 8곳이 각자 `fixed inset-0` 를 구현하면서 **포커스 트랩·트리거
 * 복원이 전무**했다. 이 훅이 그 규칙을 한 곳에 모으고, 기존 모달은 마크업/CSS
 * (set-modal, disc-modal, …)를 그대로 둔 채 동작만 얹는다. 새 모달은 이 훅을
 * 내장한 `<AppDialog>` 셸을 쓰면 된다.
 *
 * 제공: 열릴 때 트리거 저장→내부 첫 포커서블(또는 initialFocus) 포커스,
 * Tab/Shift+Tab 내부 순환, Esc → onClose, 닫힐 때 트리거로 포커스 복원.
 * (백드롭 클릭 닫기는 레이아웃 소유자인 각 모달의 몫으로 남긴다.)
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalBehaviorOptions {
  open: boolean;
  onClose: () => void;
  /** 트랩 경계가 될 패널 요소. */
  panelRef: React.RefObject<HTMLElement | null>;
  /** 열릴 때 포커스할 요소 (기본: 패널 내 첫 포커서블). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export function useModalBehavior({
  open,
  onClose,
  panelRef,
  initialFocusRef,
}: ModalBehaviorOptions): void {
  // 초기 포커스 + 닫힐 때 트리거 복원.
  useEffect(() => {
    if (!open) return;
    const restore = (document.activeElement as HTMLElement | null) ?? null;
    const panel = panelRef.current;
    const target =
      initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    target?.focus?.();
    return () => {
      restore?.focus?.();
    };
    // ref 객체들은 identity 안정 — open 전이만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc + Tab 트랩. 패널에 직접 리스너를 달아 다른 오버레이와 간섭하지 않는다.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // offsetParent 가시성 필터는 쓰지 않는다 — fixed 오버레이 안에선
      // (그리고 jsdom 에선) 정상 요소도 null 이라 트랩이 통째로 빈다.
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const at = active ? focusables.indexOf(active) : -1;
      if (at >= 0) {
        // 끝에서만 되감는다 — 그 사이는 브라우저의 Tab 순서 그대로.
        if (e.shiftKey ? at > 0 : at < focusables.length - 1) return;
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      // 포커스가 목록 밖이다 — 판 자체나 tabIndex -1 칸(글자를 눌렀을 때)에 앉았다. 브라우저는 DOM 순서로 다음 Tab
      // 자리를 찾는데, 판 안에 그 뒤(⇧Tab 이면 앞)가 없으면 판 밖으로 나간다(11-15 — 단축키 표에서 열자마자 Tab
      // 한 번에 덮개 뒤로 나갔고, 그 뒤로는 Esc 도 가두기도 듣지 않았다). 같은 순서로 판 안에서 고르고, 없으면 되감는다.
      e.preventDefault();
      const follows = (el: HTMLElement) =>
        active != null &&
        panel.contains(active) &&
        (active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      const next = e.shiftKey ? focusables.filter((el) => !follows(el)).pop() : focusables.find(follows);
      (next ?? (e.shiftKey ? last : first)).focus();
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, panelRef]);

  // body 스크롤락.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}
