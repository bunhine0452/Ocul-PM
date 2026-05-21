import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  RefreshCw,
  Target,
  Check,
  Flame,
  Sparkles,
  Calendar,
} from "@/components/Icons";
import {
  commands,
  type DailyBrief,
  type ChangelogEntry,
  type Goal,
} from "@/lib/bindings";

// MASTER-GUIDE §5.3 — Today 화면, PM 정체성의 심장.
// 오늘의 포커스 / 어제의 완료 / 오늘의 활동 / AI 추천 4 영역.
//
// 백엔드 `daily_brief` 가 데이터를 합쳐주므로 이 화면은 순수 표시기.

interface TodayScreenProps {
  activeProjectId: number | null;
}

export function TodayScreen({ activeProjectId }: TodayScreenProps) {
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [dayOffset, setDayOffset] = useState(0); // 0 = today, -1 = yesterday
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateUnix = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.floor(now.getTime() / 1000) + dayOffset * 86400;
  }, [dayOffset]);

  const load = useCallback(async () => {
    if (activeProjectId == null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await commands.dailyBrief(activeProjectId, dateUnix);
      if (res.status === "ok") setBrief(res.data);
      else setError((res as any).error ?? "불러오기 실패");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, dateUnix]);

  useEffect(() => {
    void load();
  }, [load]);

  if (activeProjectId == null) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        프로젝트를 먼저 선택해주세요.
      </div>
    );
  }

  const dateLabel = new Date(dateUnix * 1000).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto p-6 space-y-5">
        <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Today</h1>
            <p className="text-xs text-muted-foreground mt-1">
              <Calendar className="inline w-3 h-3 mr-1 -mt-0.5" />
              {dateLabel}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDayOffset((d) => d - 1)}
              disabled={loading}
              title="어제"
            >
              ◀
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDayOffset(0)}
              disabled={loading || dayOffset === 0}
            >
              오늘
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDayOffset((d) => Math.min(0, d + 1))}
              disabled={loading || dayOffset === 0}
              title="다음 날"
            >
              ▶
            </Button>
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
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
            {error}
          </div>
        )}

        {!brief && loading && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
          </div>
        )}

        {brief && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FocusCard goals={brief.focus_goals} />
              <CompletedCard
                goals={brief.completed_today}
                files={brief.files_touched}
                added={brief.lines_added}
                removed={brief.lines_removed}
                entryCount={brief.today_entries.length}
              />
            </div>

            <ActivityCard entries={brief.today_entries} />

            {brief.pinned_entries.length > 0 && (
              <PinnedCard entries={brief.pinned_entries} />
            )}

            <RecommendationCard
              activeProjectId={activeProjectId}
              brief={brief}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Focus ────────────────────────────────────────────────────────────────

function FocusCard({ goals }: { goals: Goal[] }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-bold">오늘의 포커스</h2>
      </div>
      {goals.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          진행 중인 목표가 없습니다. Plan 에서 추가해보세요.
        </p>
      ) : (
        <ol className="space-y-2">
          {goals.map((g, i) => (
            <li
              key={g.id}
              className="flex items-start gap-3 text-sm leading-snug"
            >
              <span className="text-muted-foreground tabular-nums shrink-0">
                {i + 1}.
              </span>
              <span className="flex-1 min-w-0">
                <span className="font-medium">{g.title}</span>
                {g.priority > 0 && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    P{g.priority}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ─── Completed ───────────────────────────────────────────────────────────

function CompletedCard({
  goals,
  files,
  added,
  removed,
  entryCount,
}: {
  goals: Goal[];
  files: number;
  added: number;
  removed: number;
  entryCount: number;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Check className="w-4 h-4 text-emerald-500" />
        <h2 className="text-sm font-bold">오늘의 완료</h2>
      </div>
      <ul className="space-y-1.5 text-sm">
        <li>
          <span className="font-semibold tabular-nums">{goals.length}</span>{" "}
          <span className="text-muted-foreground">goals 완료</span>
        </li>
        <li>
          <span className="font-semibold tabular-nums">{files}</span>{" "}
          <span className="text-muted-foreground">files 변경</span>
        </li>
        <li>
          <span className="font-semibold tabular-nums">{entryCount}</span>{" "}
          <span className="text-muted-foreground">changelog entry</span>
        </li>
        <li className="text-xs text-muted-foreground tabular-nums">
          +{added} / -{removed}
        </li>
      </ul>
    </section>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────

function ActivityCard({ entries }: { entries: ChangelogEntry[] }) {
  if (entries.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-bold mb-2">오늘의 활동</h2>
        <p className="text-xs text-muted-foreground">
          아직 기록된 활동이 없습니다. Code 패널에서 변경사항을 changelog 로
          저장해보세요.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-sm font-bold mb-3">오늘의 활동</h2>
      <ul className="space-y-2.5">
        {entries.map((e) => (
          <li
            key={e.id}
            className="flex items-start gap-3 text-sm leading-snug"
          >
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 pt-0.5">
              {new Date(e.created_at * 1000).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="flex-1 min-w-0">
              {e.category && (
                <CategoryChip category={e.category} />
              )}
              <span className="ml-1.5">{e.title ?? truncate(e.ai_summary, 60)}</span>
              <span className="ml-2 text-[11px] text-muted-foreground tabular-nums">
                · {e.files_changed} files
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Pinned ─────────────────────────────────────────────────────────────

function PinnedCard({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Flame className="w-4 h-4 text-amber-500" />
        <h2 className="text-sm font-bold">고정된 항목</h2>
      </div>
      <ul className="space-y-1.5 text-sm">
        {entries.map((e) => (
          <li key={e.id} className="leading-snug">
            <span className="font-medium">
              {e.title ?? truncate(e.ai_summary, 60)}
            </span>
            <span className="ml-2 text-[11px] text-muted-foreground">
              {new Date(e.created_at * 1000).toLocaleDateString("ko-KR")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── AI Recommendation ──────────────────────────────────────────────────

function RecommendationCard({
  activeProjectId: _activeProjectId,
  brief,
}: {
  activeProjectId: number;
  brief: DailyBrief;
}) {
  // §12 열린 결정 #3 (Today AI 추천 호출 빈도) 미해결 — 일단 정적 규칙 기반.
  // 진짜 LLM 추천은 후속 PR. 여기서는 데이터를 토대로 결정론적 힌트만.
  const tips: string[] = [];
  if (brief.focus_goals.length === 0) {
    tips.push("오늘 진행할 목표를 Plan 화면에서 1~3 개 정해보세요.");
  }
  if (brief.today_entries.length === 0 && brief.files_touched === 0) {
    tips.push(
      "Code 워크벤치에서 외부 LLM 으로 수정한 변경을 changelog 로 기록하면 흐름이 누적됩니다.",
    );
  }
  if (brief.today_entries.some((e) => !e.title || e.title.length < 6)) {
    tips.push(
      "오늘 entry 중 제목이 비어있거나 짧은 항목이 있어요. 한 줄 제목을 보강해보세요.",
    );
  }
  if (tips.length === 0) {
    tips.push("오늘 흐름이 잘 잡혀 있습니다. 진행 중인 목표를 계속 밀어붙이세요.");
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-bold">AI 추천</h2>
      </div>
      <ul className="space-y-2 text-sm">
        {tips.map((t, i) => (
          <li key={i} className="flex gap-2 leading-snug">
            <span className="text-muted-foreground">•</span>
            <span className="flex-1">{t}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────

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
    <span
      className={`inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}
    >
      {category}
    </span>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}
