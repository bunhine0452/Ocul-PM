import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import { SearchIcon, TriangleAlert, X, Plus, ChevronDown, ChevronRight } from "@/components/Icons";
import { useWorkspace, type JournalFilter } from "@/contexts/WorkspaceContext";
import type { EntryFilters, EntryType, JournalEntrySummary } from "@/lib/bindings";
import { oculpmApi } from "@/api/oculpm";
import { useJournalDays } from "./useJournalDays";
import { JournalCardV2 } from "./JournalCardV2";
import { EntryDetailView } from "./EntryDetailView";
import { ManualEntryModalV2 } from "./ManualEntryModalV2";
import { TRIGGER_META } from "./triggerMeta";
import { toast } from "@/lib/toast";
import {
  consumeManualEntryRequest,
  onManualEntryRequest,
  type ManualEntrySeed,
} from "@/lib/journalCompose";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT, type I18nKey } from "@/i18n";

// Final UI Update (ui_v2) — 작업 일지 timeline (02-screen-specs §2). Frontend
// aggregation over oculpm_list_journal_entries (Decision F). scope-chip 6 filters
// persist via WorkspaceContext.journalFilter; ⌘F focuses an in-page search;
// route.params.focus (from Today's MiniEntry) ring-highlights an entry.

// scope-chip → backend EntryType. Note the JournalFilter union uses "bugfix"
// while EntryType uses "bug" (the backend never renamed it) — map here.
const FILTER_TO_TYPE: Record<Exclude<JournalFilter, "all">, EntryType> = {
  feature: "feature",
  bugfix: "bug",
  refactor: "refactor",
  error: "error",
  chore: "chore",
};

const CHIPS: { id: JournalFilter; labelKey: I18nKey }[] = [
  { id: "all", labelKey: "journal.filter.all" },
  { id: "feature", labelKey: "journal.filter.feature" },
  { id: "bugfix", labelKey: "journal.filter.bugfix" },
  { id: "refactor", labelKey: "journal.filter.refactor" },
  { id: "error", labelKey: "journal.filter.error" },
  { id: "chore", labelKey: "journal.filter.chore" },
];

interface JournalScreenV2Props {
  projectId: number;
  /** Current workday key (YYYYMMDD). */
  todayKey: string | null;
  oculpmReady: boolean;
  /** Open the 변경 diff 화면 for a specific entry (PR-UI 4 consumes the path). */
  onOpenDiff: (entry: JournalEntrySummary) => void;
  /** One-shot: relative_path of an entry to ring-highlight (from Today). */
  focusPath: string | null;
  /** Called once the focus has been applied so the parent can clear it. */
  onFocusConsumed: () => void;
  /**
   * One-shot: relative_path of an entry to open directly in the detail view
   * (from Planner 📓). Resolved by its workday, so it works even when the entry
   * is older than the loaded timeline window. Distinct from focusPath.
   */
  openEntryPath?: string | null;
  /** Called once the entry has been opened (or failed to resolve). */
  onOpenEntryConsumed?: () => void;
  /**
   * When the detail view was reached via `openEntryPath` (i.e. navigated in from
   * the Planner), this routes the detail's "back" button to the origin screen
   * instead of the journal timeline. Undefined → back goes to the timeline.
   */
  onReturnToOrigin?: () => void;
}

export function JournalScreenV2({
  projectId,
  todayKey,
  oculpmReady,
  onOpenDiff,
  focusPath,
  onFocusConsumed,
  openEntryPath,
  onOpenEntryConsumed,
  onReturnToOrigin,
}: JournalScreenV2Props) {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  const filter = state.journalFilter;

  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [unfinishedOnly, setUnfinishedOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // 작성기 열림 여부 + 미리 채울 재료를 한 값으로 든다 — 따로 두면 "열려는
  // 있는데 씨앗이 아직 안 온" 한 프레임에 빈 작성기가 그려진다.
  const [manualSeed, setManualSeed] = useState<ManualEntrySeed | null>(null);
  const manualOpen = manualSeed !== null;
  const [backfilling, setBackfilling] = useState(false);

  // F3 — debounce the search so the all-period backend query (below) isn't
  // fired on every keystroke; the in-memory filter still narrows instantly.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // F3 — when any filter/search is active (or the user asked for older entries),
  // query the backend over the FULL history instead of the 14-day window, so
  // search + filters reach every entry. The backend `EntryFilters` path was
  // already complete; this finally drives it.
  const allPeriod =
    showAll ||
    filter !== "all" ||
    unfinishedOnly ||
    verifiedOnly ||
    debouncedSearch.trim() !== "";
  const backendFilters = useMemo<EntryFilters | null>(() => {
    if (!allPeriod) return null;
    return {
      types: filter === "all" ? [] : [FILTER_TO_TYPE[filter]],
      verified_only: verifiedOnly,
      mismatch_only: false,
      unfinished_only: unfinishedOnly,
      search: debouncedSearch.trim() || null,
    };
  }, [allPeriod, filter, verifiedOnly, unfinishedOnly, debouncedSearch]);

  const { days, loading, error, refresh } = useJournalDays(projectId, todayKey, oculpmReady, {
    filters: backendFilters,
    allPeriod,
  });

  // F5 — cold-start backfill: synthesise journal entries from git history so a
  // repo with commits but no journal isn't a blank wall on day 1.
  const runGitBackfill = async () => {
    setBackfilling(true);
    try {
      const r = await oculpmApi.backfillFromGit(projectId, 300);
      if (r.created > 0) {
        toast.info(t("journal.backfill.done", { n: r.created }));
        refresh();
      } else if (r.scanned === 0) {
        toast.warning(t("journal.backfill.noCommits"));
      } else {
        toast.info(t("journal.backfill.upToDate"));
      }
    } catch {
      toast.warning(t("journal.backfill.failed"));
    } finally {
      setBackfilling(false);
    }
  };
  // Master-detail: a non-null entry shows the full-screen 변경 기록 detail view
  // in place of the timeline (Dogfooding 2026-06-07 — replaced the modal).
  const [detailEntry, setDetailEntry] = useState<JournalEntrySummary | null>(null);
  // True when detailEntry was opened by navigating in from another screen
  // (Planner journal link) rather than clicking a timeline row. Drives whether
  // "back" returns to the origin screen or the journal timeline.
  const [detailFromExternal, setDetailFromExternal] = useState(false);

  // Timeline length control (Dogfooding 2026-06-14 #1): older days collapse to a
  // one-line summary; a side date-rail jumps/scrubs. dayOpen holds explicit user
  // toggles; the default keeps the 2 most-recent days open.
  const [dayOpen, setDayOpen] = useState<Record<string, boolean>>({});
  const [activeWorkday, setActiveWorkday] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const setFilter = (next: JournalFilter) =>
    setState((prev) => ({ ...prev, journalFilter: next }));

  // Screen-local shortcuts (stop propagation so the global handler doesn't also
  // act). ⌘F → focus in-page search. ⌘N → 수동 일지 모달 (단축키 매트릭스 §1.2 —
  // 작업 일지 = ⌘N). j/k handled by the OS for now.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "f") {
        e.preventDefault();
        e.stopPropagation();
        searchRef.current?.focus();
      } else if (k === "n") {
        e.preventDefault();
        e.stopPropagation();
        setManualSeed({});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 화면 밖에서 온 "일지 작성기 열기" 요청 — ⌘K 팔레트의 '새 일지'와 터미널의
  // 에이전트 실행 종료 제안이 여기로 들어온다. 다른 화면에 있을 때는 이 화면이
  // 언마운트돼 있어 이벤트를 놓치므로, 구독과 함께 대기분도 한 번 회수한다.
  // (팔레트는 예전부터 이 이벤트를 쏘고 있었지만 듣는 곳이 없어 무동작이었다.)
  useEffect(() => {
    const pending = consumeManualEntryRequest();
    if (pending) setManualSeed(pending);
    return onManualEntryRequest((seed) => setManualSeed(seed));
  }, []);

  // Apply the one-shot focus once the matching entry is in the list.
  useEffect(() => {
    if (!focusPath || !days) return;
    const exists = days.some((d) => d.entries.some((e) => e.relative_path === focusPath));
    if (exists) {
      // Clear on the next tick so JournalCardV2 sees focused=true for one render.
      const t = window.setTimeout(onFocusConsumed, 1700);
      return () => window.clearTimeout(t);
    }
  }, [focusPath, days, onFocusConsumed]);

  const total = useMemo(
    () => (days ?? []).reduce((s, d) => s + d.entries.length, 0),
    [days],
  );

  // Apply scope-chip + in-page search (title + tags + slug substring).
  const filteredDays = useMemo(() => {
    if (!days) return null;
    const q = search.trim().toLowerCase();
    const typeWanted = filter === "all" ? null : FILTER_TO_TYPE[filter];
    return days
      .map((d) => ({
        ...d,
        entries: d.entries.filter((e) => {
          if (typeWanted && e.type !== typeWanted) return false;
          if (q) {
            const hay = `${e.title} ${e.slug} ${e.tags.join(" ")}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        }),
      }))
      .filter((d) => d.entries.length > 0);
  }, [days, filter, search]);

  // While a filter/search is active, force every day open so matches in older
  // (default-collapsed) days are visible.
  const searchActive =
    search.trim() !== "" || filter !== "all" || unfinishedOnly || verifiedOnly;

  // Planner 📓 → open this entry's detail view directly. Resolved by the entry's
  // workday (parsed from the path), so a completed plan's weeks-old journal opens
  // even though it's outside the loaded timeline window. One-shot.
  // Resolve a `.oculpm/journal/`-relative path to a summary and open it —
  // shared by the Planner link (`openEntryPath`) and the detail view's
  // `related` chips. The workday folder is the lookup key, so an entry outside
  // the loaded timeline window still resolves. Returns whether it opened.
  const openByPath = useCallback(
    async (rawPath: string, fromExternal: boolean, isCancelled: () => boolean): Promise<boolean> => {
      // Agents often write the prefixed form (`.oculpm/journal/…`) — accept both.
      const path = rawPath.replace(/^\.\/?/, "").replace(/^\.oculpm\/journal\//, "");
      const workday = path.split("/")[0];
      try {
        if (!/^\d{8}$/.test(workday)) {
          toast.warning(t("journal.resolveFailed"));
          return false;
        }
        const list = await oculpmApi.listJournalEntries(projectId, workday);
        if (isCancelled()) return false;
        const base = path.split("/").pop();
        const hit =
          list.find((e) => e.relative_path === path) ??
          list.find((e) => e.relative_path.split("/").pop() === base);
        if (hit) {
          setDetailFromExternal(fromExternal);
          setDetailEntry(hit);
          return true;
        }
        toast.warning(t("journal.linkNotFound"));
      } catch {
        if (!isCancelled()) toast.warning(t("journal.linkOpenFailed"));
      }
      return false;
    },
    [projectId],
  );

  useEffect(() => {
    if (!openEntryPath) return;
    let cancelled = false;
    void openByPath(openEntryPath, true, () => cancelled).finally(() => {
      if (!cancelled) onOpenEntryConsumed?.();
    });
    return () => {
      cancelled = true;
    };
  }, [openEntryPath, openByPath, onOpenEntryConsumed]);

  // Date-rail active highlight: mark the top-most day section currently in view.
  useEffect(() => {
    if (!filteredDays || filteredDays.length === 0) return;
    if (typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const wd = (top?.target as HTMLElement | undefined)?.dataset.workday;
        if (wd) setActiveWorkday(wd);
      },
      { root: scrollRef.current, rootMargin: "0px 0px -72% 0px", threshold: 0 },
    );
    for (const d of filteredDays) {
      const el = dayRefs.current[d.workday];
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [filteredDays]);

  // Date-rail click: expand the target day, then scroll its section into view.
  const jumpToDay = (workday: string) => {
    setDayOpen((p) => ({ ...p, [workday]: true }));
    setActiveWorkday(workday);
    requestAnimationFrame(() => {
      dayRefs.current[workday]?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  };

  // Detail view replaces the timeline (and its toolbar) until the user goes back.
  if (detailEntry) {
    return (
      <EntryDetailView
        projectId={projectId}
        entry={detailEntry}
        onOpenRelated={(p) => void openByPath(p, false, () => false)}
        onBack={() => {
          // From the Planner → return to it; otherwise back to the timeline.
          if (detailFromExternal && onReturnToOrigin) {
            onReturnToOrigin();
          } else {
            setDetailEntry(null);
          }
        }}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  return (
    <>
      <Toolbar title={t("nav.journal")} sub={t("journal.toolbarSub", { n: total })}>
        <div className="search-box" style={{ minWidth: 180 }}>
          <SearchIcon size={15} color="var(--text-3)" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("journal.searchPlaceholder")}
            aria-label={t("journal.searchAria")}
          />
          {search ? (
            <button
              type="button"
              className="iconbtn"
              style={{ width: 22, height: 22 }}
              onClick={() => setSearch("")}
              aria-label={t("journal.clearSearch")}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={"scope-chip" + (filter === c.id ? " on" : "")}
              style={{ height: 28 }}
              onClick={() => setFilter(c.id)}
            >
              {t(c.labelKey)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            type="button"
            className={"scope-chip" + (unfinishedOnly ? " on" : "")}
            style={{ height: 28 }}
            onClick={() => setUnfinishedOnly((v) => !v)}
            title={t("journal.filterOpenTitle")}
          >
            {t("journal.filterOpen")}
          </button>
          <button
            type="button"
            className={"scope-chip" + (verifiedOnly ? " on" : "")}
            style={{ height: 28 }}
            onClick={() => setVerifiedOnly((v) => !v)}
            title={t("journal.filterVerifiedTitle")}
          >
            {t("journal.filterVerified")}
          </button>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => setManualSeed({})}
          disabled={!todayKey}
          title={todayKey ? t("journal.newTitle") : t("journal.newDisabled")}
        >
          <Plus size={15} /> {t("journal.new")}
        </button>
      </Toolbar>

      <div className="scroll" ref={scrollRef}>
        <div className="journal-wrap">
          <div className="journal-col fade-in">
            {error ? (
              <div className="card card-pad" style={{ marginBottom: 16 }}>
                <div className="stat-top" style={{ color: "var(--t-bug)" }}>
                  <TriangleAlert size={14} /> {t("journal.loadFailed")}
                </div>
                <div className="today-date" style={{ marginTop: 8 }}>{error}</div>
                <button className="btn sm" style={{ marginTop: 12 }} onClick={refresh}>
                  {t("common.retry")}
                </button>
              </div>
            ) : null}

            {loading && days == null ? (
              <SkeletonList rows={4} height={76} />
            ) : !oculpmReady ? (
              <div className="empty-hint">{t("journal.notActive")}</div>
            ) : filteredDays && filteredDays.length > 0 ? (
              <>
                {filteredDays.map((day, idx) => {
                const open = searchActive ? true : (dayOpen[day.workday] ?? idx < 2);
                return (
                  <div
                    key={day.workday}
                    ref={(el) => {
                      dayRefs.current[day.workday] = el;
                    }}
                    data-workday={day.workday}
                    style={{ scrollMarginTop: 8 }}
                  >
                    <button
                      type="button"
                      className="day-head"
                      onClick={() => setDayOpen((p) => ({ ...p, [day.workday]: !open }))}
                      aria-expanded={open}
                    >
                      {open ? (
                        <ChevronDown size={14} color="var(--text-3)" />
                      ) : (
                        <ChevronRight size={14} color="var(--text-3)" />
                      )}
                      <span className="day-head-label">{day.label}</span>
                      <span className="day-head-line" />
                      <span className="day-head-count">{t("journal.dayCount", { n: day.entries.length })}</span>
                    </button>
                    {open ? (
                      <div className="tl">
                        {day.entries.map((e) => (
                          <div className="tl-node" key={e.relative_path}>
                            <span className="tl-dot">
                              <TriggerMeticon type={e.type} />
                            </span>
                            <JournalCardV2
                              entry={e}
                              focused={focusPath === e.relative_path}
                              onOpenEntry={(entry) => {
                                setDetailFromExternal(false);
                                setDetailEntry(entry);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
                })}
                {!allPeriod ? (
                  <button
                    type="button"
                    className="btn sm"
                    style={{ margin: "16px auto 0", display: "block" }}
                    onClick={() => setShowAll(true)}
                  >
                    {t("journal.loadMore")}
                  </button>
                ) : null}
              </>
            ) : searchActive ? (
              <div className="empty-hint">{t("journal.noMatch")}</div>
            ) : (
              <div className="empty-hint">
                {t("journal.empty")}
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={backfilling}
                    onClick={runGitBackfill}
                  >
                    {backfilling ? t("journal.backfill.busy") : t("journal.backfill.action")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {filteredDays && filteredDays.length > 1 ? (
            <nav className="date-rail" aria-label={t("journal.dateRail")}>
              {filteredDays.map((day) => (
                <button
                  key={day.workday}
                  type="button"
                  className={"date-rail-item" + (activeWorkday === day.workday ? " active" : "")}
                  onClick={() => jumpToDay(day.workday)}
                  title={`${day.label} · ${t("journal.dayCount", { n: day.entries.length })}`}
                >
                  <span className="date-rail-md">
                    {day.workday.slice(4, 6)}-{day.workday.slice(6, 8)}
                  </span>
                  <span className="date-rail-n">{day.entries.length}</span>
                </button>
              ))}
            </nav>
          ) : null}
        </div>
      </div>

      {manualOpen && todayKey ? (
        <ManualEntryModalV2
          projectId={projectId}
          workday={todayKey}
          seedTitle={manualSeed?.title}
          seedBody={manualSeed?.body}
          onCreated={(entry) => {
            void refresh();
            toast.info(t("journal.written", { title: entry.title }));
          }}
          onClose={() => setManualSeed(null)}
        />
      ) : null}
    </>
  );
}

/** The trigger-colored dot icon inside a timeline node. */
function TriggerMeticon({ type }: { type: EntryType }) {
  const m = TRIGGER_META[type] ?? TRIGGER_META.chore;
  const Icon = m.icon;
  return <Icon size={11} strokeWidth={2.2} color={`var(--t-${m.cssVar})`} />;
}
