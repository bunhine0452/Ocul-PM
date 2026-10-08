import { useEffect, useRef, useState } from "react";

// ── 넘침 메뉴 ─────────────────────────────────────────────────────────────────

interface MenuItem {
  key: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

/**
 * 부차 동작(첨부·이름 변경·닫기·보관·삭제)을 접어 두는 작은 메뉴. 헤더에
 * 회색 버튼 일곱 개가 늘어서 있으면 정작 자주 쓰는 세 개가 안 보인다.
 */
export function MoreMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!hostRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="disc-more" ref={hostRef}>
      <button
        type="button"
        className="btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">···</span>
      </button>
      {open ? (
        <div className="disc-menu right" role="menu" aria-label={label}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={`disc-menu-item${it.danger ? " danger" : ""}`}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
