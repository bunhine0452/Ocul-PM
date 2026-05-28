/**
 * Up to 50 unfinished journal entries. Click → navigate to Today, focused on
 * that workday with the entry pre-selected (handoff via `navigateToToday`).
 */

import type { JournalEntrySummary } from "@/lib/bindings";
import { navigateToToday } from "@/lib/todayNavigate";

interface Props {
  entries: ReadonlyArray<JournalEntrySummary>;
}

const TYPE_BG: Record<string, string> = {
  bug: "bg-rose-500/20 text-rose-700 dark:text-rose-300",
  feature: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  error: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  refactor: "bg-violet-500/20 text-violet-700 dark:text-violet-300",
  chore: "bg-muted text-muted-foreground",
};

export function UnfinishedChecklist({ entries }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          미완료 ({entries.length})
        </h3>
        {entries.length === 50 && (
          <span className="text-[10px] text-muted-foreground">
            최대 50개까지 표시
          </span>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="text-xs text-muted-foreground py-3">
          완료 안 된 항목이 없습니다. 🎉
        </div>
      ) : (
        <ul className="space-y-1 max-h-72 overflow-y-auto scrollbar-thin pr-1">
          {entries.map((e) => (
            <li key={e.relative_path}>
              <button
                type="button"
                onClick={() =>
                  navigateToToday({
                    kind: "workday-entry",
                    workday: e.workday,
                    relativePath: e.relative_path,
                  })
                }
                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-accent text-left group cursor-pointer"
              >
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase shrink-0 ${TYPE_BG[e.type] ?? TYPE_BG.chore}`}
                >
                  {e.type}
                </span>
                <span className="text-sm flex-1 truncate group-hover:text-primary transition-colors">
                  {e.title || e.slug}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {e.workday.slice(4, 6)}/{e.workday.slice(6, 8)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
