import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  RefreshCw,
  FileDiff,
  Flame,
} from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import {
  commands,
  type ChangelogEntry,
  type ChangelogFileEntry,
  type DailyChangelogBucket,
} from "@/lib/bindings";

// MASTER-GUIDE §5.5 — Changelog 화면 (최소 버전).
// 좌측: 날짜 버킷 / 우측: 선택된 entry 의 디테일.
// W4 에서 풀 diff modal + 검색 + Export 가 추가될 예정.

const CATEGORIES = ["all", "feature", "fix", "refactor", "docs", "test", "chore"] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

const WINDOWS = [
  { label: "최근 7일", days: 7 },
  { label: "최근 30일", days: 30 },
  { label: "최근 90일", days: 90 },
];

interface ChangelogScreenProps {
  activeProjectId: number | null;
}

export function ChangelogScreen({ activeProjectId }: ChangelogScreenProps) {
  const [buckets, setBuckets] = useState<DailyChangelogBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ entry: ChangelogEntry; files: ChangelogFileEntry[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [windowDays, setWindowDays] = useState<number>(30);

  const load = useCallback(async () => {
    if (activeProjectId == null) return;
    setLoading(true);
    setError(null);
    const res = await commands.listChangelogByDay(activeProjectId, windowDays);
    if (res.status === "ok") {
      setBuckets(res.data);
    } else {
      setError((res as any).error ?? "불러오기 실패");
    }
    setLoading(false);
  }, [activeProjectId, windowDays]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedEntryId == null) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    commands.getChangelogDetail(selectedEntryId).then((res) => {
      if (res.status === "ok") {
        const [entry, files] = res.data;
        setDetail({ entry, files });
      } else {
        setError((res as any).error ?? "디테일 로드 실패");
        setDetail(null);
      }
      setDetailLoading(false);
    });
  }, [selectedEntryId]);

  const filteredBuckets = useMemo(() => {
    if (categoryFilter === "all") return buckets;
    return buckets
      .map((b) => ({ ...b, entries: b.entries.filter((e) => e.category === categoryFilter) }))
      .filter((b) => b.entries.length > 0);
  }, [buckets, categoryFilter]);

  async function togglePin() {
    if (!detail) return;
    const res = await commands.pinChangelog(detail.entry.id);
    if (res.status === "ok") {
      setDetail({ entry: res.data, files: detail.files });
      // also reflect in the bucket list so the row updates
      setBuckets((prev) =>
        prev.map((b) => ({
          ...b,
          entries: b.entries.map((e) => (e.id === res.data.id ? res.data : e)),
        })),
      );
    }
  }

  if (activeProjectId == null) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        프로젝트를 먼저 선택해주세요.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header / Filters */}
      <header className="border-b border-border px-5 py-3 flex items-center gap-3 shrink-0">
        <h1 className="text-base font-bold tracking-tight">Changelog</h1>
        <div className="flex items-center gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
                categoryFilter === c
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/40"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setWindowDays(w.days)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                windowDays === w.days
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {w.label}
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </header>

      {error && (
        <div className="m-3 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Left: day buckets */}
        <div className="w-[320px] border-r border-border overflow-y-auto scrollbar-thin">
          {filteredBuckets.length === 0 && !loading && (
            <div className="p-6 text-xs text-muted-foreground">
              해당 기간에 기록된 변경이 없습니다. Code 화면에서 변경사항을 changelog 로
              저장하면 여기에 누적됩니다.
            </div>
          )}
          {filteredBuckets.map((bucket) => (
            <div key={bucket.date} className="border-b border-border/60">
              <div className="px-4 py-2 bg-secondary/30 text-[11px] font-bold tabular-nums flex items-center justify-between">
                <span>{bucket.date}</span>
                <span className="text-muted-foreground font-normal">
                  {bucket.entries.length} · +{bucket.total_lines_added} / -{bucket.total_lines_removed}
                </span>
              </div>
              <ul>
                {bucket.entries.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => setSelectedEntryId(e.id)}
                      className={`w-full text-left px-4 py-2.5 hover:bg-accent/40 transition-colors border-l-2 ${
                        selectedEntryId === e.id
                          ? "border-primary bg-accent/30"
                          : "border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {e.category && <CategoryChip category={e.category} />}
                        {e.pinned && <Flame className="w-3 h-3 text-amber-500" />}
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {new Date(e.created_at * 1000).toLocaleTimeString("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="text-sm font-medium leading-snug mt-0.5">
                        {e.title ?? truncate(e.ai_summary, 60)}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                        {e.files_changed} files · +{e.lines_added} / -{e.lines_removed}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {!selectedEntryId && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              왼쪽에서 entry 를 선택해주세요.
            </div>
          )}
          {selectedEntryId && detailLoading && (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 디테일 로드 중…
            </div>
          )}
          {detail && (
            <article className="p-6 max-w-3xl mx-auto space-y-5">
              <header className="border-b border-border pb-4">
                <div className="flex items-center gap-2 mb-2">
                  {detail.entry.category && <CategoryChip category={detail.entry.category} />}
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {new Date(detail.entry.created_at * 1000).toLocaleString("ko-KR")}
                  </span>
                  <Button
                    onClick={togglePin}
                    size="sm"
                    variant={detail.entry.pinned ? "default" : "outline"}
                    className="ml-auto"
                  >
                    <Flame className="w-3.5 h-3.5 mr-1.5" />
                    {detail.entry.pinned ? "고정 해제" : "고정"}
                  </Button>
                </div>
                <h2 className="text-xl font-bold leading-tight">
                  {detail.entry.title ?? truncate(detail.entry.ai_summary, 80)}
                </h2>
                {detail.entry.user_intent && (
                  <p className="text-xs text-muted-foreground mt-2">
                    <span className="font-semibold">의도:</span> {detail.entry.user_intent}
                  </p>
                )}
              </header>

              <section>
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                  AI 요약
                </h3>
                <Markdown>{detail.entry.ai_summary}</Markdown>
              </section>

              <section>
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                  파일별 변경 ({detail.files.length})
                </h3>
                <ul className="space-y-1.5">
                  {detail.files.map((f) => (
                    <li
                      key={f.id}
                      className="rounded-lg border border-border bg-card p-3 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <FileDiff className="w-3.5 h-3.5 text-muted-foreground" />
                        <code className="font-mono text-[11px] flex-1 truncate">
                          {f.file_path}
                        </code>
                        <span className="tabular-nums text-muted-foreground">
                          +{f.lines_added} / -{f.lines_removed}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {f.change_type}
                        </span>
                      </div>
                      {f.per_file_summary && (
                        <p className="text-muted-foreground mt-1.5 leading-snug">
                          {f.per_file_summary}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryChip({ category }: { category: string }) {
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

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}
