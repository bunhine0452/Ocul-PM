import { useEffect, useRef } from "react";
import { useT } from "@/i18n";
import { SESSION_COLORS, sessionColorVar, type SessionColor } from "@/lib/sessionColors";

// 세션 카드의 오른쪽 클릭 메뉴 (2026-09-04) — 지금은 색 고르기 하나다.
//
// 색을 **설정 화면이 아니라 카드 위**에서 고르는 이유: 고르는 이유가 "이
// 세션이 무엇인지 기억하려고" 이고, 그 판단은 카드를 보고 있을 때만 생긴다.
// 설정에 넣으면 세션 목록을 떠나 이름으로 다시 찾아야 한다.
//
// 바깥 클릭·Esc 규약은 `TerminalBlockMenu` 와 같다 — 캡처 단계에서 듣는다.
// 터미널 캔버스가 mousedown 을 먼저 삼키면 메뉴가 열린 채 남는다.

const MENU_WIDTH = 156;
/** 메뉴가 창 밖으로 나가지 않게 두는 여백. */
const EDGE = 8;

export interface SessionMenuTarget {
  id: string;
  label: string;
  color: SessionColor | null;
  x: number;
  y: number;
}

export interface TerminalSessionMenuProps {
  target: SessionMenuTarget;
  onPick: (id: string, color: SessionColor | null) => void;
  onClose: () => void;
}

export function TerminalSessionMenu({ target, onPick, onClose }: TerminalSessionMenuProps) {
  const { t } = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // 창 오른쪽·아래에서 열면 메뉴가 잘린다. 미리 접어 넣는다 (측정 없이 —
  // 폭은 상수이고 높이는 한 줄이라 재 볼 것이 없다).
  const left = Math.min(target.x, window.innerWidth - MENU_WIDTH - EDGE);
  const top = Math.min(target.y, window.innerHeight - 72);

  return (
    <div
      ref={rootRef}
      className="term-sess-menu"
      style={{ left: Math.max(EDGE, left), top: Math.max(EDGE, top) }}
      role="menu"
      aria-label={t("term.color.menu", { label: target.label })}
    >
      <div className="tsm-title">{t("term.color.title")}</div>
      <div className="tsm-row">
        {/* 색 없음이 먼저다 — 되돌리는 길은 언제나 맨 앞에 있어야 한다. */}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={target.color === null}
          className={"tsm-swatch none" + (target.color === null ? " picked" : "")}
          onClick={() => onPick(target.id, null)}
          title={t("term.color.none")}
          aria-label={t("term.color.none")}
        />
        {SESSION_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="menuitemradio"
            aria-checked={target.color === color}
            className={"tsm-swatch" + (target.color === color ? " picked" : "")}
            style={{ "--sw": sessionColorVar(color) } as React.CSSProperties}
            onClick={() => onPick(target.id, color)}
            title={t(`term.color.${color}`)}
            aria-label={t(`term.color.${color}`)}
          />
        ))}
      </div>
    </div>
  );
}
