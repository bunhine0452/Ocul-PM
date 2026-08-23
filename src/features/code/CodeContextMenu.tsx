// 코드 화면의 우클릭 메뉴 — 탭 바와 파일 트리가 같이 쓴다.
//
// 포털로 body 에 그린다: 트리와 탭 바 둘 다 `overflow: auto` 컨테이너 안이라,
// 제자리에 그리면 메뉴가 스크롤 영역에 잘린다.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface CodeMenuItem {
  label: string;
  onSelect: () => void;
  /** 되돌리기 어려운 항목 — 빨갛게. */
  danger?: boolean;
  disabled?: boolean;
  /** 이 항목 위에 구분선. */
  separatorBefore?: boolean;
  /** 오른쪽 끝에 흐리게 붙는 단축키 힌트 (예: "⌘W"). 번역하지 않는다. */
  hint?: string;
}

interface CodeContextMenuProps {
  x: number;
  y: number;
  items: CodeMenuItem[];
  label: string;
  onClose: () => void;
}

/** 뷰포트 가장자리에서 메뉴가 잘리지 않도록 남겨 두는 여백. */
const EDGE_GAP = 8;

export function CodeContextMenu({ x, y, items, label, onClose }: CodeContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // 그린 뒤 실제 크기를 재서 화면 안으로 당긴다 — 아래쪽·오른쪽 가장자리에서
  // 연 메뉴가 잘려 마지막 항목을 못 고르는 일을 막는다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(EDGE_GAP, Math.min(x, window.innerWidth - width - EDGE_GAP)),
      y: Math.max(EDGE_GAP, Math.min(y, window.innerHeight - height - EDGE_GAP)),
    });
  }, [x, y]);

  useEffect(() => {
    // 캡처 단계로 듣는다 — 아래 요소의 클릭 핸들러가 먼저 돌아 메뉴가 열린
    // 채로 화면이 바뀌는 것을 막는다.
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    // 스크롤·리사이즈로 앵커가 움직이면 메뉴가 엉뚱한 자리에 남는다 — 닫는다.
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="code-ctxmenu"
      role="menu"
      aria-label={label}
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) => (
        <button
          key={item.label + i}
          type="button"
          role="menuitem"
          className={
            "code-ctxmenu-item" +
            (item.danger ? " danger" : "") +
            (item.separatorBefore ? " sep" : "")
          }
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          <span>{item.label}</span>
          {item.hint ? <kbd className="code-ctxmenu-hint">{item.hint}</kbd> : null}
        </button>
      ))}
    </div>,
    document.body,
  );
}
