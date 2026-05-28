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
import {
  MigrationModal,
  useShouldOfferMigration,
} from "@/features/projects/MigrationModal";
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
import {
  consumePendingNavTarget,
  subscribeNavTarget,
} from "@/lib/todayNavigate";

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
  // W5-PR4 — migration modal. Opens automatically after onboarding completes
  // (or on first mount if init was done in a prior session and the user hasn't
  // dismissed) when the legacy SQLite changelog has at least one entry.
  const [migrationOpen, setMigrationOpen] = useState(false);
  const migrationOffer = useShouldOfferMigration(
    activeProjectId,
    !migrationOpen && oculpmStatus?.initialized === true,
  );

  useEffect(() => {
    if (migrationOffer === "yes" && !migrationOpen) {
      setMigrationOpen(true);
    }
  }, [migrationOffer, migrationOpen]);
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

  // W5-PR5/PR6 — consume pending nav target from Overview widgets. Applies
  // `filter` intent (agents / difficulties) on top of the current filter and
  // jumps to the right workday via dayOffset if the target carries one.
  useEffect(() => {
    const apply = () => {
      if (activeProjectId == null) return;
      const target = consumePendingNavTarget();
      if (!target) return;
      if (target.kind === "filter") {
        const next: CategoryFilter = {
          ...filter,
          agents: target.filter.agents
            ? new Set(target.filter.agents)
            : filter.agents,
          difficulties: target.filter.difficulties
            ? new Set(target.filter.difficulties)
            : filter.difficulties,
        };
        setFilter(next);
        saveFilter(activeProjectId, next);
      }
      // `workday` / `workday-entry` need an anchor-date diff to compute
      // dayOffset. For v1 we accept Today as anchor and let the user navigate
      // manually if the target is far in the past. PR8 may extend this.
    };
    apply();
    const off = subscribeNavTarget(apply);
    return off;
  }, [activeProjectId, filter]);
  // Memoised wire DTO — TimelineView treats this as the fetch identity, so a
  // stable reference avoids needless refetches on unrelated re-renders.
  const entryFilters = useMemo(() => toEntryFilters(filter), [filter]);

  const dateUnix = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.floor(now.getTime() / 1000) + dayOffset * 86400;
  }, [dayOffset]);

  // W4 dogfooding (2026-05-27) — derive the YYYYMMDD workday for *this* page
  // so TimelineView can render past days too. Previously the screen only
  // mounted TimelineView for `dayOffset === 0` and fell through to the
  // legacy DailyBrief for history, which felt like a UI regression.
  //
  // We anchor on the backend's `current_workday` (which already respects
  // timezone + day_starts_at) and shift by `dayOffset` calendar days. This
  // matches the default `day_starts_at = "00:00"` exactly; non-default
  // boundaries skew at most ±1 day for the slice straddling midnight, which
  // is acceptable for history browsing.
  const targetWorkday = useMemo<string | null>(() => {
    const anchor = workdayKey ?? oculpmStatus?.current_workday ?? null;
    if (!anchor || !/^\d{8}$/.test(anchor)) return null;
    const y = Number(anchor.slice(0, 4));
    const m = Number(anchor.slice(4, 6)) - 1;
    const d = Number(anchor.slice(6, 8));
    const dt = new Date(y, m, d);
    dt.setDate(dt.getDate() + dayOffset);
    const yy = dt.getFullYear().toString().padStart(4, "0");
    const mm = (dt.getMonth() + 1).toString().padStart(2, "0");
    const dd = dt.getDate().toString().padStart(2, "0");
    return `${yy}${mm}${dd}`;
  }, [workdayKey, oculpmStatus, dayOffset]);

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
  // Drives the EmptyTodayV2 vs V3 branching for *today* and the legacy-vs-
  // TimelineView branching for past days. The probe now runs for any
  // `dayOffset` so historical days can show the same TimelineView UI instead
  // of falling back to the older DailyBrief layout (W4 dogfooding 2026-05-27).
  useEffect(() => {
    if (activeProjectId == null) return;
    if (!oculpmStatus?.initialized || targetWorkday == null) {
      setJournalCount(null);
      setFileChangeCount(null);
      setLatestSessionId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [entries, fileChanges, sessions] = await Promise.all([
          oculpmApi.listJournalEntries(activeProjectId, targetWorkday),
          oculpmApi.getFileChanges(activeProjectId, targetWorkday),
          oculpmApi.listSessions(activeProjectId, targetWorkday),
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
  }, [activeProjectId, oculpmStatus, targetWorkday, refreshTick]);

  if (activeProjectId == null) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        프로젝트를 먼저 선택해주세요.
      </div>
    );
  }

  // ── ocul-pm branching: V1 / V2 / V3 / fall-through ─────────────────────
  // Today (`dayOffset === 0`) keeps the full V1/V2/V3 onboarding empty
  // states. Past days never need onboarding, so an empty past day skips
  // straight to the TimelineView branch (it'll render a "no entries" hint
  // when journalCount === 0).
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
      <div className="max-w-6xl mx-auto p-6 space-y-5">
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
            W4 dogfooding (2026-05-27): TimelineView also renders for past
            days using `targetWorkday`, so navigating to yesterday no longer
            falls back to the older DailyBrief layout.
            Legacy DailyBrief is preserved for projects without ocul-pm so
            users don't lose existing functionality. */}
        {!showOculpmEmpty &&
          oculpmStatus?.initialized &&
          targetWorkday != null &&
          (journalCount ?? 0) > 0 ? (
          <div className="space-y-3">
            <CategoryFilterBar
              projectId={activeProjectId!}
              filter={filter}
              onChange={handleFilterChange}
            />
            <TimelineView
              projectId={activeProjectId}
              projectRoot={projectRoot}
              workday={targetWorkday}
              filters={entryFilters}
            />
          </div>
        ) : !showOculpmEmpty &&
          oculpmStatus?.initialized &&
          dayOffset !== 0 &&
          (journalCount ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg px-4 py-8 text-center">
            이 날에 기록된 entries 가 없습니다.
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

      {/* W5-PR4 — Migration modal. Mounts automatically when the project has
          legacy SQLite changelog rows and the user hasn't dismissed it. */}
      {migrationOpen && activeProjectId != null && (
        <MigrationModal
          projectId={activeProjectId}
          onClose={() => {
            setMigrationOpen(false);
            // Trigger a refetch so Today picks up the newly-migrated entries.
            setRefreshTick((n) => n + 1);
          }}
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
