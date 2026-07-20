import React from "react";

// Final UI Update (ui_v2) — the 52px screen Toolbar. Every ui_v2 screen renders
// its header through THIS component so toolbar uniformity is automatic
// (UI-MASTER-PROMPT §7.4). Left = title + optional sub; right = screen actions
// passed as children. Mirrors Ocul-PM1.0/src/shell.jsx `Toolbar`.

interface ToolbarProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** Optional element rendered before the title (e.g. a back button). */
  leading?: React.ReactNode;
  children?: React.ReactNode;
}

export function Toolbar({ title, sub, leading, children }: ToolbarProps) {
  // Window drag (Dogfooding 2026-06-15): the whole top bar should move the
  // window, not just the window edges. Tauri starts a drag only when the
  // clicked element ITSELF carries data-tauri-drag-region (it inspects
  // e.target, not ancestors), so the attribute goes on the container AND each
  // non-interactive child (title/sub/spacer). `leading` and action `children`
  // are buttons — they intentionally omit it so they stay clickable.
  return (
    <div className="toolbar" data-tauri-drag-region>
      {leading}
      <div className="toolbar-title" data-tauri-drag-region>{title}</div>
      {sub ? <span className="toolbar-sub" data-tauri-drag-region>{sub}</span> : null}
      <div className="toolbar-spacer" data-tauri-drag-region />
      {/* 좁은 창 방어 (2026-07-20): 액션 묶음은 압착 대신 가로 스크롤로
          도망간다 — 없으면 flex 압착이 CJK 라벨을 한 글자씩 세로로 꺾는다. */}
      <div className="toolbar-actions">{children}</div>
    </div>
  );
}
