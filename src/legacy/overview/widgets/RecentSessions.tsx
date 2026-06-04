/**
 * 30-day session daily aggregate table. Row click → navigate to that
 * workday's Today.
 */

import type { SessionDailyAgg } from "@/lib/bindings";
import { navigateToToday } from "@/lib/todayNavigate";

interface Props {
  sessions: ReadonlyArray<SessionDailyAgg>;
}

function fmtDate(workday: string): string {
  if (workday.length !== 8) return workday;
  return `${workday.slice(4, 6)}/${workday.slice(6, 8)}`;
}

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function RecentSessions({ sessions }: Props) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        최근 30일 세션
      </h3>
      {sessions.length === 0 ? (
        <div className="text-xs text-muted-foreground py-3">
          최근 30일 안의 세션이 없습니다.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="text-left py-2 px-3 font-medium">날짜</th>
                <th className="text-right py-2 px-3 font-medium">세션</th>
                <th className="text-right py-2 px-3 font-medium">활동</th>
                <th className="text-right py-2 px-3 font-medium">파일</th>
                <th className="text-right py-2 px-3 font-medium">narrative</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.workday}
                  onClick={() =>
                    navigateToToday({ kind: "workday", workday: s.workday })
                  }
                  className="border-t border-border hover:bg-accent cursor-pointer"
                >
                  <td className="py-1.5 px-3 font-mono tabular-nums">
                    {fmtDate(s.workday)}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums">
                    {s.session_count}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">
                    {fmtDuration(s.total_active_seconds)}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">
                    {s.files_unique}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums">
                    {((s.narrative_rate ?? 0) * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
