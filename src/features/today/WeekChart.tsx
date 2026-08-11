import type { WeekBar } from "./useTodayBrief";
import { useT } from "@/i18n";

// Final UI Update (ui_v2) — 7-day rolling change-count bar chart. Mirrors the
// `.week-row` block in Ocul-PM1.0/src/today.jsx. Heights are relative to the
// busiest day in the window; today's bar gets the accent ring.

export function WeekChart({ week }: { week: WeekBar[] }) {
  const { t } = useT();
  const max = Math.max(1, ...week.map((w) => w.count));
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="section-title" style={{ marginBottom: 12 }}>
        {t("today.week.title")}
      </div>
      <div className="week-row">
        {week.map((w) => (
          <div className="week-col" key={w.workday}>
            <div className="week-val">{w.count}</div>
            <div className={"week-bar" + (w.isToday ? " is-today" : "")} style={{ flex: 1 }}>
              <i style={{ height: `${(w.count / max) * 100}%` }} />
            </div>
            <div className={"week-lbl" + (w.isToday ? " is-today" : "")}>{w.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
