import { useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import { SearchIcon, TriangleAlert, X, Plus, ChevronDown, ChevronRight } from "@/components/Icons";
import { useWorkspace, type JournalFilter } from "@/contexts/WorkspaceContext";
import type { EntryType, JournalEntrySummary } from "@/lib/bindings";
import { oculpmApi } from "@/api/oculpm";
import { useJournalDays } from "./useJournalDays";
import { JournalCardV2 } from "./JournalCardV2";
import { EntryDetailView } from "./EntryDetailView";
import { ManualEntryModalV2 } from "./ManualEntryModalV2";
import { TRIGGER_META } from "./triggerMeta";
import { toast } from "@/lib/toast";
import { OculSpinner } from "@/components/OculSpinner";

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

const CHIPS: { id: JournalFilter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "feature", label: "기능" },
  { id: "bugfix", label: "버그" },
  { id: "refactor", label: "리팩토링" },
  { id: "error", label: "에러" },
  { id: "chore", label: "잡일" },
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
  const { state, setState } = useWorkspace();
  const filter = state.journalFilter;
  const { days, loading, error, refresh } = useJournalDays(projectId, todayKey, oculpmReady);

  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [manualOpen, setManualOpen] = useState(false);
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
        setManualOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
  const searchActive = search.trim() !== "" || filter !== "all";

  // Planner 📓 → open this entry's detail view directly. Resolved by the entry's
  // workday (parsed from the path), so a completed plan's weeks-old journal opens
  // even though it's outside the loaded timeline window. One-shot.
  useEffect(() => {
    if (!openEntryPath) return;
    let cancelled = false;
    const workday = openEntryPath.split("/")[0];
    void (async () => {
      try {
        if (!/^\d{8}$/.test(workday)) {
          toast.warning("일지 경로를 해석하지 못했어요.");
          return;
        }
        const list = await oculpmApi.listJournalEntries(projectId, workday);
        if (cancelled) return;
        const base = openEntryPath.split("/").pop();
        const hit =
          list.find((e) => e.relative_path === openEntryPath) ??
          list.find((e) => e.relative_path.split("/").pop() === base);
        if (hit) {
          setDetailFromExternal(true);
          setDetailEntry(hit);
        } else toast.warning("연결된 일지를 찾지 못했어요.");
      } catch {
        if (!cancelled) toast.warning("연결된 일지를 열지 못했어요.");
      } finally {
        if (!cancelled) onOpenEntryConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openEntryPath, projectId, onOpenEntryConsumed]);

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
      <Toolbar title="작업 일지" sub={`${total}건의 자동 기록`}>
        <div className="search-box" style={{ minWidth: 180 }}>
          <SearchIcon size={15} color="var(--text-3)" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="일지 검색 (⌘F)"
            aria-label="일지 검색"
          />
          {search ? (
            <button
              type="button"
              className="iconbtn"
              style={{ width: 22, height: 22 }}
              onClick={() => setSearch("")}
              aria-label="검색어 지우기"
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
              {c.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => setManualOpen(true)}
          disabled={!todayKey}
          title={todayKey ? "수동 일지 작성 (⌘N)" : "ocul-pm 활성화 후 사용 가능"}
        >
          <Plus size={15} /> 새 일지
        </button>
      </Toolbar>

      <div className="scroll" ref={scrollRef}>
        <div className="journal-wrap">
          <div className="journal-col fade-in">
            {error ? (
              <div className="card card-pad" style={{ marginBottom: 16 }}>
                <div className="stat-top" style={{ color: "var(--t-bug)" }}>
                  <TriangleAlert size={14} /> 일지를 불러오지 못했어요
                </div>
                <div className="today-date" style={{ marginTop: 8 }}>{error}</div>
                <button className="btn sm" style={{ marginTop: 12 }} onClick={refresh}>
                  다시 시도
                </button>
              </div>
            ) : null}

            {loading && days == null ? (
              <OculSpinner label="불러오는 중…" />
            ) : !oculpmReady ? (
              <div className="empty-hint">ocul-pm이 활성화되면 일지가 여기에 표시됩니다.</div>
            ) : filteredDays && filteredDays.length > 0 ? (
              filteredDays.map((day, idx) => {
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
                      <span className="day-head-count">{day.entries.length}건</span>
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
                              onOpenDiff={onOpenDiff}
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : total > 0 ? (
              <div className="empty-hint">
                {search || filter !== "all"
                  ? "조건에 맞는 일지가 없어요."
                  : "표시할 일지가 없어요."}
              </div>
            ) : (
              <div className="empty-hint">
                아직 일지가 없어요. AI 에이전트에게 작업을 요청하면 Ocul-PM이 자동으로 기록합니다.
              </div>
            )}
          </div>

          {filteredDays && filteredDays.length > 1 ? (
            <nav className="date-rail" aria-label="날짜로 이동">
              {filteredDays.map((day) => (
                <button
                  key={day.workday}
                  type="button"
                  className={"date-rail-item" + (activeWorkday === day.workday ? " active" : "")}
                  onClick={() => jumpToDay(day.workday)}
                  title={`${day.label} · ${day.entries.length}건`}
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
          onCreated={(entry) => {
            void refresh();
            toast.info(`일지를 작성했어요: ${entry.title}`);
          }}
          onClose={() => setManualOpen(false)}
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
