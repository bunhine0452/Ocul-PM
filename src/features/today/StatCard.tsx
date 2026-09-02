import React from "react";

// Final UI Update (ui_v2) — one of the Today stat cards. Mirrors
// Ocul-PM1.0/src/today.jsx `StatCard`.
//
// 2026-09-02: 아이콘의 색 상자(tint)를 뺐다. 8장의 타일마다 다른 색 네모를 두는
// 것은 'KPI 대시보드 템플릿' 그 자체였고, 그 색이 트리거 팔레트(잡일·리팩토링…)
// 를 빌려 와 지표와 무관했다. 색은 의미가 있을 때만 — `tone="danger"` 는 에러
// 사이클이 0 이 아닐 때, `tone="accent"` 는 오늘의 주 지표 하나.

interface StatCardProps {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  /** 아이콘 색. 생략하면 3차 텍스트색 — 대부분의 지표는 색이 없다. */
  tone?: "accent" | "danger";
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

export function StatCard({ icon: Icon, tone, label, value, unit, sub, hoverTip }: StatCardProps) {
  return (
    <div className={"stat" + (hoverTip ? " has-tip" : "")}>
      <div className="stat-top">
        <span className={"stat-ico" + (tone ? ` ${tone}` : "")}>
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
