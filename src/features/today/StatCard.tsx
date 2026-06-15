import React from "react";

// Final UI Update (ui_v2) — one of the 4 Today stat cards. Mirrors
// Ocul-PM1.0/src/today.jsx `StatCard`. `tint` carries the icon chip colors
// (token vars, not literals) so the trigger palette stays the single source.

interface StatCardProps {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  tint: { bg: string; fg: string };
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  /**
   * Richer content revealed on card hover — e.g. the full commit message that
   * the truncated `sub` line clips. Rendered as a direct child of `.stat`
   * (NOT inside the overflow-hidden `.stat-sub`) so the popover can escape the
   * card bounds instead of being clipped.
   */
  hoverTip?: React.ReactNode;
}

export function StatCard({ icon: Icon, tint, label, value, unit, sub, hoverTip }: StatCardProps) {
  return (
    <div className={"stat" + (hoverTip ? " has-tip" : "")}>
      <div className="stat-top">
        <span className="stat-ico" style={{ background: tint.bg, color: tint.fg }}>
          <Icon size={14} strokeWidth={2} />
        </span>
        {label}
      </div>
      <div className="stat-val">
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
      {hoverTip ? (
        <div className="stat-tip" role="tooltip">
          {hoverTip}
        </div>
      ) : null}
    </div>
  );
}
