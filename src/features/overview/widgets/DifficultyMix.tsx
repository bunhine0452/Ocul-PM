/**
 * Difficulty distribution. CSS-only donut alternative — a horizontal stacked
 * bar with legend rows. Click a row → navigate to Today with that
 * difficulty filter applied (PR6 wires the actual list filtering; until
 * then the filter intent is dropped on the floor with a console log via
 * `navigateToToday`).
 */

import type { Difficulty, DifficultyMix as DifficultyMixData } from "@/lib/bindings";
import { navigateToToday } from "@/lib/todayNavigate";

interface Props {
  mix: DifficultyMixData;
}

const SLICES: ReadonlyArray<{
  key: keyof DifficultyMixData;
  label: string;
  difficulty: Difficulty | null;
  cls: string;
}> = [
  { key: "superhigh", label: "초난도", difficulty: "superhigh", cls: "bg-rose-500" },
  { key: "high", label: "높음", difficulty: "high", cls: "bg-orange-500" },
  { key: "medium", label: "보통", difficulty: "medium", cls: "bg-amber-400" },
  { key: "low", label: "낮음", difficulty: "low", cls: "bg-emerald-500" },
  { key: "verylow", label: "쉬움", difficulty: "verylow", cls: "bg-sky-400" },
  { key: "null_count", label: "미지정", difficulty: null, cls: "bg-muted" },
];

export function DifficultyMix({ mix }: Props) {
  const total = SLICES.reduce((acc, s) => acc + (mix[s.key] as number), 0);
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        난이도 분포
      </h3>
      <div className="rounded-md overflow-hidden flex h-3 mb-3">
        {total === 0 ? (
          <div className="flex-1 bg-muted/40" />
        ) : (
          SLICES.map((s) => {
            const n = mix[s.key] as number;
            if (n === 0) return null;
            const pct = (n / total) * 100;
            return (
              <button
                key={s.key}
                type="button"
                title={`${s.label}: ${n}`}
                onClick={() => {
                  if (s.difficulty != null) {
                    navigateToToday({
                      kind: "filter",
                      filter: { difficulties: [s.difficulty] },
                    });
                  }
                }}
                className={`${s.cls} h-full transition-opacity hover:opacity-70`}
                style={{ width: `${pct}%` }}
              />
            );
          })
        )}
      </div>
      <ul className="grid grid-cols-2 gap-1 text-xs">
        {SLICES.map((s) => {
          const n = mix[s.key] as number;
          if (n === 0) return null;
          return (
            <li key={s.key} className="flex items-center gap-2 tabular-nums">
              <span className={`w-2.5 h-2.5 rounded-sm ${s.cls}`} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="ml-auto font-medium">{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
