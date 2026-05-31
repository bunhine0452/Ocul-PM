import React from "react";

// Final UI Update (ui_v2) — the 52px screen Toolbar. Every ui_v2 screen renders
// its header through THIS component so toolbar uniformity is automatic
// (UI-MASTER-PROMPT §7.4). Left = title + optional sub; right = screen actions
// passed as children. Mirrors Ocul-PM1.0/src/shell.jsx `Toolbar`.

interface ToolbarProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}

export function Toolbar({ title, sub, children }: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-title">{title}</div>
      {sub ? <span className="toolbar-sub">{sub}</span> : null}
      <div className="toolbar-spacer" />
      {children}
    </div>
  );
}
