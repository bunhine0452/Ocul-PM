/**
 * 90-day calendar heatmap. CSS grid (13 weeks × 7 days). Each cell is a
 * colored square whose darkness scales with `cell.score`. Clicking jumps to
 * Today focused on that workday.
 */

import type { HeatmapCell } from "@/lib/bindings";
import { navigateToToday } from "@/lib/todayNavigate";

interface Props {
  cells: ReadonlyArray<HeatmapCell>;
  /** Caller can intercept clicks (e.g. tab-switch) before the global bus
   *  fires. Returning `true` cancels the default navigation. */
  onCellClick?: (cell: HeatmapCell) => boolean | void;
}

const LEVELS = 4;
const SCORE_BUCKETS = [0, 3, 10, 25]; // ≤ → emerald scale 0..3

function bucketize(score: number): number {
  for (let i = SCORE_BUCKETS.length - 1; i >= 0; i--) {
    if (score >= SCORE_BUCKETS[i]) return i;
  }
  return 0;
}

const LEVEL_BG = [
  "bg-muted/40",
  "bg-emerald-500/30",
  "bg-emerald-500/60",
  "bg-emerald-500",
];

function formatTooltip(cell: HeatmapCell): string {
  const date = `${cell.workday.slice(0, 4)}-${cell.workday.slice(4, 6)}-${cell.workday.slice(6, 8)}`;
  return `${date} · ${cell.entry_count} entries · ${cell.file_event_count} file events`;
}

export function ActivityHeatmap({ cells, onCellClick }: Props) {
  // Layout: 7 rows (Sun..Sat per ISO mod), N columns of weeks. We just
  // chunk cells into 7 per column from the start (calendar alignment is
  // approximate — exact weekday alignment is a polish for W6).
  const cols: HeatmapCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    cols.push(cells.slice(i, i + 7));
  }
  const populated = cells.filter((c) => c.score > 0).length;
  const sparse = cells.length > 0 && populated / cells.length < 0.3;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          최근 활동
        </h3>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>적음</span>
          {Array.from({ length: LEVELS }).map((_, i) => (
            <span
              key={i}
              className={`w-2.5 h-2.5 rounded-[2px] ${LEVEL_BG[i]}`}
            />
          ))}
          <span>많음</span>
        </div>
      </div>
      <div className="flex gap-[2px] overflow-x-auto scrollbar-thin pb-1">
        {cols.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[2px]">
            {col.map((c) => (
              <button
                key={c.workday}
                type="button"
                title={formatTooltip(c)}
                onClick={() => {
                  if (onCellClick?.(c) === true) return;
                  navigateToToday({ kind: "workday", workday: c.workday });
                }}
                className={`w-3 h-3 rounded-[2px] ${LEVEL_BG[bucketize(c.score)]} hover:ring-1 hover:ring-primary cursor-pointer transition-shadow`}
                aria-label={formatTooltip(c)}
              />
            ))}
          </div>
        ))}
      </div>
      {sparse && (
        <div className="text-[11px] text-muted-foreground mt-2">
          90일 중 활동 비율 낮음 — 최근 30일만 보려면 위젯 설정에서 조정 가능
          (W6)
        </div>
      )}
    </div>
  );
}
