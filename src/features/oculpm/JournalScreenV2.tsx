import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorCard } from "@/components/ErrorCard";
import { Toolbar } from "@/components/Toolbar";
import { SkeletonList } from "@/components/ui/Skeleton";
import { ArrowLeft, NotebookText, Plus, SearchIcon, X } from "@/components/Icons";
import { oculpmApi } from "@/api/oculpm";
import type { EntryFilters, EntryType, JournalEntrySummary } from "@/lib/bindings";
import { useT, type I18nKey } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { isModChord } from "@/lib/kbd";
import { consumeManualEntryRequest, onManualEntryRequest, type ManualEntrySeed } from "@/lib/journalCompose";
import { requestOculpmActivate } from "@/lib/projectActions";
import { toast } from "@/lib/toast";
import { JournalDetail } from "./JournalDetail";
import { JournalList, ROW_LIMIT } from "./JournalList";
import { ManualEntryModalV2 } from "./ManualEntryModalV2";
import { isEvidenceMissing } from "./evidenceState";
import { JOURNAL_PAGE_SIZE, useJournalDays, type JournalDay } from "./useJournalDays";
import { normalizeJournalRef, useJournalPlanLinks } from "./useJournalPlanLinks";
import { useJournalSearch } from "./useJournalSearch";
import { useJournalTotal } from "./useJournalTotal";
import "./journal.css";

// 작업 일지 (4.0) — 왼쪽 목록 + 오른쪽 상세. 일지 검색은 이 화면이 집이다 (검색 화면은 사라졌다).
//
// 목록은 평소 최근 14일이고, 필터·검색을 걸면 전체 기간으로 넓어진다. 「증거 없음」 은 화면이
// 거르는 필터다 — 결함·기능·리팩토링인데 검증 칸에 돌린 명령이 없고 사람 확인도 없는 일지.
// 키는 이 화면의 컨테이너가 듣는다 (j/k 이동 · Enter 상세로 · / 검색) — 전역 keydown 이 아니다.
// ⌘N(새 일지)·⌘F(검색)만 수식키 조합이라 창에서 듣는다.

type Filter = "all" | "fix" | "feature" | "refactor" | "chore" | "noevidence";

const FILTERS: { id: Filter; labelKey: I18nKey; types: EntryType[] }[] = [
  { id: "all", labelKey: "journal.filter.all", types: [] },
  { id: "fix", labelKey: "journal.filter.fix", types: ["bug", "error"] },
  { id: "feature", labelKey: "journal.filter.feature", types: ["feature"] },
  { id: "refactor", labelKey: "journal.filter.refactor", types: ["refactor"] },
  { id: "chore", labelKey: "journal.filter.chore", types: ["chore"] },
  { id: "noevidence", labelKey: "journal.filterNoEvidence", types: [] },
];

interface JournalScreenV2Props {
  projectId: number;
  /** Current workday key (YYYYMMDD). */
  todayKey: string | null;
  oculpmReady: boolean;
  /** 변경 화면으로 건너가 이 일지의 파일을 연다. */
  onOpenDiff: (entry: JournalEntrySummary) => void;
  /** One-shot: Today 에서 건너온 일지의 relative_path — 열어서 고른다. */
  focusPath: string | null;
  /** 초점을 적용했으니 부모가 비워도 된다. */
  onFocusConsumed: () => void;
  /** One-shot: 계획의 📓 에서 건너온 일지 — 14일 창 밖이어도 그날 목록에서 찾아 연다. */
  openEntryPath?: string | null;
  onOpenEntryConsumed?: () => void;
  /** 계획에서 건너왔을 때 「돌아가기」 가 가는 곳. */
  onReturnToOrigin?: () => void;
  /** 이 탭이 화면에 보이는가 — 비활성 탭도 마운트된 채라 창 전역 인텐트는 활성 탭만 듣는다. */
  active?: boolean;
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
  active = true,
}: JournalScreenV2Props) {
  const { t } = useT();
  // 필터·검색은 화면 지역 상태다 — "어제 걸어 둔 필터 때문에 오늘 일지가 안 보인다" 가 이 화면에서
  // 가장 비싼 착각이라 열 때마다 전체로 시작한다.
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [rowLimit, setRowLimit] = useState(ROW_LIMIT);
  const [selected, setSelected] = useState<JournalEntrySummary | null>(null);
  const [fromExternal, setFromExternal] = useState(false);
  const [manualSeed, setManualSeed] = useState<ManualEntrySeed | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // 검색은 디바운스한다 — 키 입력마다 전체 기간을 묻지 않는다. 비면 곧바로 평소 목록이다.
  useEffect(() => {
    if (search.trim() === "") {
      setDebounced("");
      return;
    }
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = debounced.trim();
  const searching = query !== "";
  const def = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const typeStrings = useMemo(() => def.types as readonly string[], [def]);

  const allPeriod = showAll || filter !== "all";
  const backendFilters = useMemo<EntryFilters | null>(
    () =>
      allPeriod
        ? {
            types: def.types,
            verified_only: false,
            unverified_only: false,
            mismatch_only: false,
            unfinished_only: false,
            search: null,
          }
        : null,
    [allPeriod, def],
  );
  const feed = useJournalDays(projectId, todayKey, oculpmReady && !searching, {
    filters: backendFilters,
    allPeriod,
  });
  const found = useJournalSearch(projectId, todayKey, oculpmReady && searching, query, typeStrings);
  const total = useJournalTotal(projectId, oculpmReady);
  const planLinks = useJournalPlanLinks(projectId, oculpmReady);

  const rawDays: JournalDay[] | null = searching ? found.days : feed.days;
  const loading = searching ? found.loading : feed.loading;
  const error = searching ? found.error : feed.error;
  const refresh = searching ? found.refresh : feed.refresh;

  const days = useMemo(() => {
    if (!rawDays) return null;
    if (filter !== "noevidence") return rawDays;
    return rawDays
      .map((d) => ({ ...d, entries: d.entries.filter(isEvidenceMissing) }))
      .filter((d) => d.entries.length > 0);
  }, [rawDays, filter]);
  const flat = useMemo(() => (days ?? []).flatMap((d) => d.entries), [days]);

  // 툴바의 건수는 **지금 보이는 것**을 센다 — 전체를 세고 목록은 일부만 그리면 검색이 뭔가를 삼킨 걸로 읽힌다.
  const visibleCount = flat.length;
  const countText = total != null ? t("journal.count", { n: visibleCount, total }) : t("journal.countOnly", { n: visibleCount });

  // 상한에 걸려 못 받은 것이 남았는가 — 몇 건 중 몇 건을 보고 있는지는 목록 위에 먼저 말한다.
  const pageTotal = searching ? found.total : feed.total;
  const pageLoaded = searching ? found.loaded : feed.loaded;
  const truncated = pageTotal != null && pageLoaded != null && pageLoaded < pageTotal;
  const remaining = Math.min(JOURNAL_PAGE_SIZE, (pageTotal ?? 0) - (pageLoaded ?? 0));
  const canLoadMore = !searching && feed.canLoadMore;

  // 고른 일지. `pin` 은 목록 밖에서 열었다는 뜻이다 (14일 창 밖의 일지 등) — 목록이 갱신돼도 그 일지를 지키고,
  // 사용자가 목록에서 다른 줄을 고르는 순간 풀린다.
  const pinnedRef = useRef<string | null>(null);
  const choose = useCallback(
    (entry: JournalEntrySummary | null, opts?: { pin?: boolean; external?: boolean }) => {
      pinnedRef.current = opts?.pin && entry ? entry.relative_path : null;
      setSelected(entry);
      setFromExternal(!!opts?.external);
    },
    [],
  );

  // 목록이 자리 잡으면 첫 줄을 고른다 — 오른쪽이 빈 채로 시작하지 않게. 필터·검색으로 고른 줄이
  // 목록에서 사라졌을 때도 같다. 갱신 중(`loading`)에는 옛 목록을 보고 판단하지 않는다.
  useEffect(() => {
    if (loading || !days || openEntryPath || focusPath) return;
    if (selected && (pinnedRef.current === selected.relative_path || flat.some((e) => e.relative_path === selected.relative_path))) return;
    choose(flat[0] ?? null);
  }, [loading, days, flat, selected, openEntryPath, focusPath, choose]);

  const changeFilter = (next: Filter) => {
    setFilter(next);
    setRowLimit(ROW_LIMIT);
  };

  // `.oculpm/journal/` 기준 경로(또는 `.oculpm/journal/…` 접두형)를 요약으로 풀어 연다. 날짜 폴더가
  // 조회 키라 14일 창 밖의 일지도 열린다. 계획의 📓·Today·관련 링크가 같은 길을 쓴다.
  const openByPath = useCallback(
    async (rawPath: string, external: boolean, isCancelled: () => boolean) => {
      const path = normalizeJournalRef(rawPath);
      const workday = path.split("/")[0];
      try {
        if (!/^\d{8}$/.test(workday)) {
          toast.warning(t("journal.resolveFailed"));
          return;
        }
        const list = await oculpmApi.listJournalEntries(projectId, workday);
        if (isCancelled()) return;
        const base = path.split("/").pop();
        const hit =
          list.find((e) => e.relative_path === path) ??
          list.find((e) => e.relative_path.split("/").pop() === base);
        if (hit) choose(hit, { pin: true, external });
        else toast.warning(t("journal.linkNotFound"));
      } catch {
        if (!isCancelled()) toast.warning(t("journal.linkOpenFailed"));
      }
    },
    [projectId, t, choose],
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

  useEffect(() => {
    if (!focusPath) return;
    let cancelled = false;
    void openByPath(focusPath, false, () => cancelled).finally(() => {
      if (!cancelled) onFocusConsumed();
    });
    return () => {
      cancelled = true;
    };
  }, [focusPath, openByPath, onFocusConsumed]);

  // 고른 줄이 목록에서 보이게 — 키보드로 옮기거나 다른 화면에서 건너왔을 때.
  useEffect(() => {
    if (!selected) return;
    const rows = listRef.current?.querySelectorAll<HTMLElement>(".jl-item");
    for (const row of rows ?? []) {
      if (row.dataset.path === selected.relative_path) {
        row.scrollIntoView?.({ block: "nearest" });
        break;
      }
    }
  }, [selected]);

  // 화면에 들어오면 컨테이너가 키를 받게 한다 — 사이드바를 누르고 들어와도 바로 j/k 와 / 가 먹는다.
  useEffect(() => {
    if (!active) return;
    const el = document.activeElement as HTMLElement | null;
    const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    if (!typing) splitRef.current?.focus({ preventScroll: true });
  }, [active]);

  // 수식키 조합만 창에서 듣는다: ⌘F 검색 포커스 · ⌘N 새 일지 (비-mac 의 Ctrl+Shift+N 은 새 창이라 아니다).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isModChord(e)) return;
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

  // 화면 밖에서 온 「일지 작성기 열기」 요청 — ⌘K 팔레트의 '새 일지'. 다른 화면에 있을 때는 이 화면이
  // 언마운트돼 이벤트를 놓치므로, 구독과 함께 대기분도 한 번 회수한다.
  useEffect(() => {
    if (!active) return;
    const pending = consumeManualEntryRequest();
    if (pending) setManualSeed(pending);
    return onManualEntryRequest((seed) => setManualSeed(seed));
  }, [active]);

  const move = useCallback(
    (delta: number) => {
      if (flat.length === 0) return;
      const cur = selected ? flat.findIndex((e) => e.relative_path === selected.relative_path) : -1;
      const next = Math.min(Math.max(cur + delta, 0), flat.length - 1);
      if (next >= rowLimit) setRowLimit((n) => n + ROW_LIMIT);
      choose(flat[next]);
      // 포커스도 따라간다 — 안 그러면 이전 줄에 남은 포커스에서 Enter 가 옛 줄을 다시 고른다.
      requestAnimationFrame(() => {
        const rows = listRef.current?.querySelectorAll<HTMLElement>(".jl-item");
        for (const row of rows ?? []) {
          if (row.dataset.path === flat[next].relative_path) row.focus({ preventScroll: true });
        }
      });
    },
    [flat, selected, rowLimit, choose],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement;
    const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    if (typing) return;
    if (e.key === "Escape" && el.closest(".jd")) {
      // 상세에서 목록으로 — Enter 의 반대 방향.
      e.preventDefault();
      for (const row of listRef.current?.querySelectorAll<HTMLElement>(".jl-item") ?? []) {
        if (row.dataset.path === selected?.relative_path) row.focus({ preventScroll: true });
      }
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    } else if (e.key === "j" || e.key === "k") {
      e.preventDefault();
      move(e.key === "j" ? 1 : -1);
    } else if (e.key === "Enter") {
      const row = el.closest<HTMLElement>(".jl-item");
      if (!row) return;
      e.preventDefault();
      const hit = flat.find((x) => x.relative_path === row.dataset.path);
      if (hit) choose(hit);
      detailRef.current?.focus({ preventScroll: true });
    }
  };

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

  const newEntry = (
    <button
      type="button"
      className="btn primary"
      onClick={() => setManualSeed({})}
      {...blocked(todayKey ? null : t("journal.newDisabled"), t("journal.newTitle"))}
    >
      <Plus size={15} /> {t("journal.new")}
    </button>
  );

  const nothingYet = oculpmReady && !loading && !error && rawDays != null && rawDays.length === 0 && !searching && filter === "all" && !showAll;
  const filtered = searching || filter !== "all";

  // 「자동으로 기록합니다」 는 거짓이었다 — 일지를 쓰는 것은 에이전트다. 첫날 이 화면을 살리는
  // 구체적인 행동은 둘뿐: 지난 커밋에서 만들거나, 지금 한 건을 직접 쓰거나.
  const firstDay = (
    <EmptyState
      density="rich"
      icon={NotebookText}
      title={t("journal.emptyTitle")}
      actions={
        <>
          {newEntry}
          <button type="button" className="btn" disabled={backfilling} onClick={runGitBackfill}>
            {backfilling ? t("journal.backfill.busy") : t("journal.backfill.action")}
          </button>
          {/* 최근 14일이 비어도 예전 기록으로 갈 길이 있어야 한다 — 두 주 넘게 쉬었다 돌아온 경우. */}
          {total == null || total > 0 ? (
            <button type="button" className="btn" onClick={() => setShowAll(true)}>
              {t("journal.loadMore")}
            </button>
          ) : null}
        </>
      }
    >
      {t("journal.empty")}
    </EmptyState>
  );

  return (
    <>
      <Toolbar
        title={t("nav.journal")}
        leading={
          fromExternal && onReturnToOrigin ? (
            <button type="button" className="iconbtn" onClick={onReturnToOrigin} aria-label={t("entry.back")} title={t("entry.back")}>
              <ArrowLeft size={15} />
            </button>
          ) : undefined
        }
      >
        {newEntry}
      </Toolbar>

      {!oculpmReady ? (
        <div className="scroll">
          <div className="page">
            <EmptyState
              actions={
                <button type="button" className="btn primary" onClick={requestOculpmActivate}>
                  {t("today.activateNow")}
                </button>
              }
            >
              {t("journal.notActive")}
            </EmptyState>
          </div>
        </div>
      ) : nothingYet ? (
        <div className="scroll">
          <div className="page">{firstDay}</div>
        </div>
      ) : (
        <div className="jl-split" ref={splitRef} tabIndex={-1} onKeyDown={onKeyDown}>
          {/* 목록 칸 = 머리(검색 · 종류) + 목록. 검색과 필터는 목록을 거르므로 목록 위에 산다 —
              셸 윗줄에 두면 탭 넷과 한 줄을 다퉜다 (4.0 윗줄 개편). */}
          <div className="jl-col">
            <div className="jl-head">
              <div className="search-box jl-search">
                <SearchIcon size={15} color="var(--text-3)" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    e.stopPropagation();
                    if (search) setSearch("");
                    else {
                      e.currentTarget.blur();
                      splitRef.current?.focus({ preventScroll: true });
                    }
                  }}
                  placeholder={t("journal.searchPlaceholder")}
                  aria-label={t("journal.searchAria")}
                  spellCheck={false}
                />
                {search ? (
                  <button type="button" className="iconbtn sm" onClick={() => setSearch("")} aria-label={t("journal.clearSearch")}>
                    <X size={13} />
                  </button>
                ) : (
                  <span className="kbd">/</span>
                )}
              </div>
              <div className="seg" role="tablist" aria-label={t("journal.typeFilterAria")}>
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    className="seg-item"
                    onClick={() => changeFilter(f.id)}
                    title={f.id === "noevidence" ? t("journal.filterNoEvidenceTitle") : undefined}
                  >
                    {t(f.labelKey)}
                  </button>
                ))}
              </div>
              {filtered ? <span className="jl-count">{countText}</span> : null}
            </div>
            <JournalList
              days={days ?? []}
              todayKey={todayKey}
              selectedPath={selected?.relative_path ?? null}
              onSelect={(e) => choose(e)}
              limit={rowLimit}
              onMore={() => setRowLimit((n) => n + ROW_LIMIT)}
              listRef={listRef}
              notice={
                <>
                  {error ? <ErrorCard title={t("journal.loadFailed")} error={error} onRetry={refresh} style={{ margin: 12 }} /> : null}
                  {truncated ? (
                    <div className="jl-notice">
                      <span>{t("journal.limited", { loaded: pageLoaded ?? 0, total: pageTotal ?? 0 })}</span>
                      {canLoadMore ? (
                        <button type="button" className="btn sm" onClick={feed.loadMore}>
                          {t("journal.loadMorePage", { n: remaining })}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              }
              empty={
                loading && days == null ? (
                  <SkeletonList rows={4} height={44} />
                ) : (
                  <p className="jl-empty">{filtered ? t("journal.noMatch") : t("journal.empty")}</p>
                )
              }
              footer={
                !allPeriod && !searching && !(loading && days == null) ? (
                  <button type="button" className="btn sm jl-more" onClick={() => setShowAll(true)}>
                    {t("journal.loadMore")}
                  </button>
                ) : null
              }
            />
          </div>
          {selected ? (
            <JournalDetail
              ref={detailRef}
              projectId={projectId}
              entry={selected}
              planLinks={planLinks.get(selected.relative_path) ?? []}
              onOpenDiff={onOpenDiff}
              onOpenRelated={(p) => void openByPath(p, false, () => false)}
            />
          ) : (
            <div className="jd-empty">{t("journal.pickOne")}</div>
          )}
        </div>
      )}

      {manualSeed && todayKey ? (
        <ManualEntryModalV2
          projectId={projectId}
          workday={todayKey}
          seedTitle={manualSeed.title}
          seedBody={manualSeed.body}
          seedType={manualSeed.type}
          onCreated={(entry) => {
            refresh();
            toast.info(t("journal.written", { title: entry.title }));
          }}
          onClose={() => setManualSeed(null)}
        />
      ) : null}
    </>
  );
}
