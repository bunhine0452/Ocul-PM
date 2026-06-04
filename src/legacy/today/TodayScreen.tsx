import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Calendar,
  OculIcon,
} from "@/components/Icons";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  EmptyTodayV1,
  EmptyTodayV2,
} from "@/features/oculpm/EmptyToday";
import { OculpmOnboardingModal } from "@/features/oculpm/OculpmOnboardingModal";
import { TimelineView } from "@/features/oculpm/TimelineView";
import { ManualEntryModal } from "@/features/oculpm/ManualEntryModal";
import {
  MigrationModal,
  useShouldOfferMigration,
} from "@/features/projects/MigrationModal";
import { LegacyDeleteModal } from "@/features/projects/LegacyDeleteModal";
import type { MigrationReport } from "@/lib/bindings";
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

  const [dayOffset, setDayOffset] = useState(0); // 0 = today, -1 = yesterday

  // W3-PR5 ocul-pm branching state
  const [journalCount, setJournalCount] = useState<number | null>(null);
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
  // W5-PR7 — legacy delete modal. Triggered from MigrationModal's step 5 CTA.
  const [legacyDeleteOpen, setLegacyDeleteOpen] = useState(false);
  const [legacyDeleteSource, setLegacyDeleteSource] = useState<MigrationReport | null>(null);

  useEffect(() => {
    if (migrationOffer === "yes" && !migrationOpen) {
      setMigrationOpen(true);
    }
  }, [migrationOffer, migrationOpen]);
  // CommandPalette bus listener — manual entry only (Lite-W6 PR3 retired
  // the compare-latest action along with the session-comparison UI).
  useEffect(() => {
    const onManual = () => {
      if (oculpmStatus?.initialized) setManualEntryOpen(true);
    };
    window.addEventListener(OCULPM_BUS.manualEntry, onManual);
    return () => {
      window.removeEventListener(OCULPM_BUS.manualEntry, onManual);
    };
  }, [oculpmStatus?.initialized]);
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

  // ── Probe journal entry count when ocul-pm is active ───────────────────
  // Drives EmptyTodayV1/V2 branching for *today* and the legacy-vs-
  // TimelineView branching for past days. The probe runs for any
  // `dayOffset` so historical days can show the same TimelineView UI instead
  // of falling back to the older DailyBrief layout (W4 dogfooding 2026-05-27).
  useEffect(() => {
    if (activeProjectId == null) return;
    if (!oculpmStatus?.initialized || targetWorkday == null) {
      setJournalCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const entries = await oculpmApi.listJournalEntries(
          activeProjectId,
          targetWorkday,
        );
        if (cancelled) return;
        setJournalCount(entries.length);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof OculpmApiError) {
          console.warn("[TodayScreen] ocul-pm probe failed:", e.message);
        }
        // Treat probe failure as "no data" so the legacy view still renders.
        setJournalCount(null);
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
              title="어제"
            >
              ◀
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDayOffset(0)}
              disabled={dayOffset === 0}
            >
              오늘
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDayOffset((d) => Math.min(0, d + 1))}
              disabled={dayOffset === 0}
              title="다음 날"
            >
              ▶
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRefreshTick((n) => n + 1)}
              title="새로고침"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </header>

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
                  setRefreshTick((n) => n + 1);
                }}
              />
            ) : (
              <EmptyTodayV2
                workdayKey={workdayKey}
                onCreateManual={handleManualEntry}
              />
            )}
          </div>
        )}

        {/* TimelineView when ocul-pm has journal entries.
            W3-PR8: CategoryFilterBar above it owns the per-project filter.
            W4 dogfooding (2026-05-27): TimelineView also renders for past
            days using `targetWorkday`.
            Lite-W6 PR4 retired the legacy DailyBrief fallback (it was
            entirely changelog-driven). Projects without an active ocul-pm
            session land on the EmptyTodayV1 activation CTA above. */}
        {!showOculpmEmpty &&
          oculpmStatus?.initialized &&
          targetWorkday != null &&
          (journalCount ?? 0) > 0 && (
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
        )}

        {!showOculpmEmpty &&
          oculpmStatus?.initialized &&
          dayOffset !== 0 &&
          (journalCount ?? 0) === 0 && (
          <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg px-4 py-8 text-center">
            이 날에 기록된 entries 가 없습니다.
          </div>
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
          onOpenLegacyDelete={(report) => {
            setLegacyDeleteSource(report);
            setLegacyDeleteOpen(true);
            setMigrationOpen(false);
          }}
          onClose={() => {
            setMigrationOpen(false);
            // Trigger a refetch so Today picks up the newly-migrated entries.
            setRefreshTick((n) => n + 1);
          }}
        />
      )}

      {/* W5-PR7 — Legacy SQLite changelog delete confirmation. */}
      {legacyDeleteOpen && activeProjectId != null && (
        <LegacyDeleteModal
          projectId={activeProjectId}
          lastReport={legacyDeleteSource}
          onClose={() => {
            setLegacyDeleteOpen(false);
            setLegacyDeleteSource(null);
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

