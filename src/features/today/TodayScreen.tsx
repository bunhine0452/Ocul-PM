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
  OculIcon,
} from "@/components/Icons";
import {
  commands,
  type DailyBrief,
  type ChangelogEntry,
  type Goal,
} from "@/lib/bindings";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  EmptyTodayV1,
  EmptyTodayV2,
  EmptyTodayV3,
} from "@/features/oculpm/EmptyToday";
import { OculpmOnboardingModal } from "@/features/oculpm/OculpmOnboardingModal";
import { TimelineView } from "@/features/oculpm/TimelineView";
import { ManualEntryModal } from "@/features/oculpm/ManualEntryModal";
import { DiffVsNarrative } from "@/features/oculpm/DiffVsNarrative";
import { OCULPM_BUS } from "@/components/CommandPalette";
import { CategoryFilterBar } from "@/features/oculpm/CategoryFilterBar";
import {
  DEFAULT_FILTER,
  loadFilter,
  saveFilter,
  toEntryFilters,
  type CategoryFilter,
} from "@/features/oculpm/filters";

// MASTER-GUIDE §5.3 — Today 화면, PM 정체성의 심장.
// 오늘의 포커스 / 어제의 완료 / 오늘의 활동 / AI 추천 4 영역.
//
// 백엔드 `daily_brief` 가 데이터를 합쳐주므로 이 화면은 순수 표시기.

interface TodayScreenProps {
  activeProjectId: number | null;
}

export function TodayScreen({ activeProjectId }: TodayScreenProps) {
  const { state, setOculpmStatus } = useWorkspace();
  const oculpmStatus = state.oculpmStatus;
  const workdayKey = state.workdayKey;
  const projectRoot = state.currentProjectRoot;

  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [dayOffset, setDayOffset] = useState(0); // 0 = today, -1 = yesterday
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // W3-PR5 ocul-pm branching state
  const [journalCount, setJournalCount] = useState<number | null>(null);
  const [fileChangeCount, setFileChangeCount] = useState<number | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  // W4-PR6 — latest session for the EmptyTodayV3 "compare" entry point, plus
  // the active modal target (null = closed).
  const [latestSessionId, setLatestSessionId] = useState<string | null>(null);
  const [compareSessionId, setCompareSessionId] = useState<string | null>(null);

  // W4-PR8 — CommandPalette bus listeners (manual entry / compare latest).
  useEffect(() => {
    const onManual = () => {
      if (oculpmStatus?.initialized) setManualEntryOpen(true);
    };
    const onCompare = () => {
      if (latestSessionId) setCompareSessionId(latestSessionId);
    };
    window.addEventListener(OCULPM_BUS.manualEntry, onManual);
    window.addEventListener(OCULPM_BUS.compareLatest, onCompare);
    return () => {
      window.removeEventListener(OCULPM_BUS.manualEntry, onManual);
      window.removeEventListener(OCULPM_BUS.compareLatest, onCompare);
    };
  }, [oculpmStatus?.initialized, latestSessionId]);
  // Bumped after a manual entry is created so the journal-count probe re-runs
  // (and TimelineView re-renders via its own event subscription).
  const [refreshTick, setRefreshTick] = useState(0);

  // W3-PR8 category filter — per-project state owner. We start from DEFAULT
  // and re-hydrate from localStorage in a `useEffect` so the SSR-safe
  // pattern survives if this screen ever runs outside the browser.
  const [filter, setFilter] = useState<CategoryFilter>(DEFAULT_FILTER);
  useEffect(() => {
    if (activeProjectId == null) {
      setFilter(DEFAULT_FILTER);
      return;
    }
    setFilter(loadFilter(activeProjectId));
  }, [activeProjectId]);
  const handleFilterChange = useCallback(
    (next: CategoryFilter) => {
      setFilter(next);
      if (activeProjectId != null) saveFilter(activeProjectId, next);
    },
    [activeProjectId],
  );
  // Memoised wire DTO — TimelineView treats this as the fetch identity, so a
  // stable reference avoids needless refetches on unrelated re-renders.
  const entryFilters = useMemo(() => toEntryFilters(filter), [filter]);

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

  // ── Probe journal/file-change counts when ocul-pm is active ─────────────
  // Drives the EmptyTodayV2 vs V3 branching. Today (dayOffset === 0) only —
  // historical days fall through to the legacy DailyBrief view.
  useEffect(() => {
    if (activeProjectId == null) return;
    if (!oculpmStatus?.initialized || dayOffset !== 0) {
      setJournalCount(null);
      setFileChangeCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [entries, fileChanges, sessions] = await Promise.all([
          oculpmApi.listJournalEntries(activeProjectId),
          oculpmApi.getFileChanges(
            activeProjectId,
            oculpmStatus.current_workday
          ),
          oculpmApi.listSessions(activeProjectId, oculpmStatus.current_workday),
        ]);
        if (cancelled) return;
        setJournalCount(entries.length);
        setFileChangeCount(fileChanges.length);
        // Latest = greatest session_id lexicographically (YYYYMMDD-NNN).
        const sortedIds = sessions.map((s) => s.id).sort();
        setLatestSessionId(sortedIds.length ? sortedIds[sortedIds.length - 1] : null);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof OculpmApiError) {
          console.warn("[TodayScreen] ocul-pm probe failed:", e.message);
        }
        // Treat probe failure as "no data" so the legacy view still renders.
        setJournalCount(null);
        setFileChangeCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, oculpmStatus, dayOffset, refreshTick]);

  if (activeProjectId == null) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        프로젝트를 먼저 선택해주세요.
      </div>
    );
  }

  // ── ocul-pm branching: V1 / V2 / V3 / fall-through ─────────────────────
  // dayOffset !== 0 → user is browsing history → keep the legacy view.
  // dismissed users still see V1 (the "활성화" CTA there is their re-entry
  // path; the status-bar link below also reopens the modal).
  const dismissed = readDismissed(activeProjectId);
  const showOculpmEmpty =
    dayOffset === 0 &&
    (oculpmStatus == null ||
      !oculpmStatus.initialized ||
      journalCount === 0);

  // W3-PR6: opens the real ManualEntryModal. Requires ocul-pm to be active
  // (the V1 onboarding screen is the path otherwise).
  const handleManualEntry = () => {
    if (!oculpmStatus?.initialized) {
      setOnboardingOpen(true);
      return;
    }
    setManualEntryOpen(true);
  };

  // Global ⌘+Shift+J — open the manual entry modal regardless of which tab
  // the user is on (works because TodayScreen is mounted as part of the
  // active workspace; if Today isn't the active view, the shortcut wins).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (activeProjectId == null) return;
        handleManualEntry();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleManualEntry is recreated each render but the deps it closes over
    // are listed explicitly; the cleanup runs on every render so no stale
    // closure leaks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, oculpmStatus?.initialized]);

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

        {/* W3-PR5 status bar: dismissed users still need a re-entry point */}
        {oculpmStatus != null && !oculpmStatus.initialized && dismissed && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <OculIcon className="w-3.5 h-3.5" />
              ocul-pm 비활성화 — 워처/세션이 동작하지 않습니다
            </span>
            <button
              onClick={() => setOnboardingOpen(true)}
              className="text-primary hover:underline font-medium"
            >
              활성화
            </button>
          </div>
        )}

        {/* W3-PR5 ocul-pm empty variants (today only) */}
        {showOculpmEmpty && (
          <div className="pt-4">
            {(oculpmStatus == null || !oculpmStatus.initialized) ? (
              <EmptyTodayV1
                onActivate={() => setOnboardingOpen(true)}
                onDismiss={() => {
                  try {
                    localStorage.setItem(
                      `oculpm_dismissed_${activeProjectId}`,
                      "1"
                    );
                  } catch {
                    /* non-fatal */
                  }
                  // Re-trigger a render so the dismiss bar appears immediately.
                  setBrief((b) => b);
                }}
              />
            ) : (fileChangeCount ?? 0) > 0 ? (
              <EmptyTodayV3
                fileChangeCount={fileChangeCount ?? 0}
                onCreateManual={handleManualEntry}
                onCompareLayers={
                  latestSessionId
                    ? () => setCompareSessionId(latestSessionId)
                    : null
                }
              />
            ) : (
              <EmptyTodayV2
                workdayKey={workdayKey}
                onCreateManual={handleManualEntry}
              />
            )}
          </div>
        )}

        {/* W4 dogfooding finding (2026-05-25) — was a top-level modal; relocated
            inline above the timeline so users can keep scrolling through their
            sessions while the comparison stays visible. */}
        {compareSessionId && activeProjectId != null && (
          <DiffVsNarrative
            projectId={activeProjectId}
            sessionId={compareSessionId}
            onClose={() => setCompareSessionId(null)}
          />
        )}

        {!brief && loading && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
          </div>
        )}

        {/* W3-PR6: TimelineView when ocul-pm has journal entries on today.
            W3-PR8: CategoryFilterBar above it owns the per-project filter.
            Legacy DailyBrief is preserved for historical days and projects
            without ocul-pm so users don't lose existing functionality. */}
        {!showOculpmEmpty &&
          dayOffset === 0 &&
          oculpmStatus?.initialized &&
          (journalCount ?? 0) > 0 ? (
          <div className="space-y-3">
            <CategoryFilterBar filter={filter} onChange={handleFilterChange} />
            <TimelineView
              projectId={activeProjectId}
              projectRoot={projectRoot}
              workday={oculpmStatus.current_workday}
              filters={entryFilters}
            />
          </div>
        ) : (
          !showOculpmEmpty && brief && (
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
          )
        )}
      </div>

      {onboardingOpen && activeProjectId != null && (
        <OculpmOnboardingModal
          projectId={activeProjectId}
          onClose={async (reason) => {
            setOnboardingOpen(false);
            if (reason === "completed") {
              // Refresh probe counters so V1 transitions to V2/V3.
              try {
                const status = await oculpmApi.getStatus(activeProjectId);
                setOculpmStatus(status);
              } catch {
                /* non-fatal */
              }
            }
          }}
        />
      )}

      {manualEntryOpen &&
        activeProjectId != null &&
        oculpmStatus?.initialized && (
          <ManualEntryModal
            projectId={activeProjectId}
            workday={oculpmStatus.current_workday}
            onCreated={() => {
              // Bump the refresh tick so the probe re-runs (which transitions
              // V2/V3 → TimelineView once journalCount becomes > 0).
              setRefreshTick((n) => n + 1);
            }}
            onClose={() => setManualEntryOpen(false)}
          />
        )}

    </div>
  );
}

/** Read the per-project dismiss flag. Safe in private mode / SSR. */
function readDismissed(projectId: number): boolean {
  try {
    return localStorage.getItem(`oculpm_dismissed_${projectId}`) === "1";
  } catch {
    return false;
  }
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
