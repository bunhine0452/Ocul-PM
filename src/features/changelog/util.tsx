// Small bits shared by ChangelogScreen / EntryDetail / TodayScreen.
//
// We keep them in one file (not separate barrels) because they are tiny and
// always travel together. Duplicating CategoryChip across screens would drift.

export function CategoryChip({ category }: { category: string }) {
  const colorMap: Record<string, string> = {
    feature: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    fix: "bg-red-500/15 text-red-700 dark:text-red-300",
    refactor: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
    docs: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    test: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    chore: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  };
  const cls = colorMap[category] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>
      {category}
    </span>
  );
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}
