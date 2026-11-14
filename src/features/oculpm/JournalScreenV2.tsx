import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorCard } from "@/components/ErrorCard";
import { Toolbar } from "@/components/Toolbar";
import { SkeletonList } from "@/components/ui/Skeleton";
import { Plus } from "@/components/Icons";
import { oculpmApi } from "@/api/oculpm";
import type { EntryFilters, JournalEntrySummary } from "@/lib/bindings";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { isModChord, readChord } from "@/lib/kbd";
import { requestOculpmActivate } from "@/lib/projectActions";
import { toast } from "@/lib/toast";
import { JournalDetail, type JournalDetailActions } from "./JournalDetail";
import { FILTERS, JournalHead, type Filter } from "./JournalHead";
import { JournalList } from "./JournalList";
import { ManualEntryModalV2 } from "./ManualEntryModalV2";
import { isEvidenceMissing } from "./evidenceState";
import { foldedDayOf, ROW_LIMIT, visibleOrder } from "./journalOrder";
import { rememberedJournal, rememberJournal } from "./journalMemory";
import { consumeOnlyMissing, onOnlyMissing } from "./onlyMissing";
import { JOURNAL_PAGE_SIZE, useJournalDays, type JournalDay } from "./useJournalDays";
import { normalizeJournalRef, useJournalPlanLinks } from "./useJournalPlanLinks";
import { useGoneJournals } from "./useGoneJournals";
import { SEARCH_LIMIT, useJournalSearch } from "./useJournalSearch";
import { useJournalTotal } from "./useJournalTotal";
import "./journal.css";

/** 시험이 화면 사이에 남은 모듈 기억을 비운다 (`journalMemory`). */
export { __resetJournalMemory } from "./journalMemory";

// 작업 일지 (4.0) — 왼쪽 목록 + 오른쪽 상세. 일지 검색은 이 화면이 집이다 (검색 화면은 사라졌다).
//
// 목록은 평소 최근 14일이고, 「전체」 · 필터 · 검색을 걸면 전체 기간으로 넓어진다. 「검증 없음」 은 화면이
// 거르는 필터다 — 결함·기능·리팩토링인데 검증 칸에 돌린 명령이 없고 사람의 읽음도 없는 일지.
//
// 키는 이 화면의 컨테이너가 듣는다 (11-15): j/k · ↑↓ · Home/End 이동, Enter 상세로, Esc 목록으로, / 검색,
// v 읽음, [ ] 변경 파일. 전역 keydown 이 아니다. ⌘N(새 일지)·⌘F(검색)만 수식키 조합이라 창에서 듣는다.
// 화면 순서는 `visibleOrder` 하나가 정한다 — 그리기 · 이동 · 자동 선택이 같은 줄을 본다.

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
  /** 계획에서 건너왔을 때 「계획으로 돌아가기」 가 가는 곳. */
  onReturnToOrigin?: () => void;
  /** 이 탭이 화면에 보이는가 — 비활성 탭도 마운트된 채라 창 전역 인텐트는 활성 탭만 듣는다. */
  active?: boolean;
}

/** 줄 하나에 포커스(와 화면 안으로) — 키로 옮기거나 다른 화면에서 건너왔을 때. 줄을 못 찾으면 `false`. */
function focusRow(list: HTMLElement | null, path: string | null): boolean {
  if (!list || !path) return false;
  for (const row of list.querySelectorAll<HTMLElement>(".jl-item")) {
    if (row.dataset.path === path) {
      row.focus({ preventScroll: true });
      row.scrollIntoView?.({ block: "nearest" });
      return true;
    }
  }
  return false;
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
  // 가장 비싼 착각이라 열 때마다 전체로 시작한다. 고른 일지와 스크롤만 앱이 켜 있는 동안 기억한다.
  const memory = useRef(rememberedJournal(projectId));
  const [filter, setFilter] = useState<Filter>("all");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [rank, setRank] = useState(true);
  const [rowLimit, setRowLimit] = useState(ROW_LIMIT);
  // 고른 일지는 **경로**로 든다 — 요약은 매 렌더 새 목록에서 찾는다(에이전트가 제목을 고치면 따라온다).
  const [selectedPath, setSelectedPath] = useState<string | null>(memory.current?.path ?? null);
  // 목록 밖에서 연 일지(14일 창 밖 등) — 목록이 갱신돼도 그 일지를 지키고, 목록에서 다른 줄을 고르면 풀린다.
  const [pinned, setPinned] = useState<JournalEntrySummary | null>(null);
  const [fromExternal, setFromExternal] = useState(false);
  // 사라진 코드의 일지 — 사람이 연 날만 열린다. 선택이 나가도 닫히지 않는다.
  const [openedDays, setOpenedDays] = useState<ReadonlySet<string>>(() => new Set());
  // 방금 읽음을 바꾼 일지 — 디스크가 다시 읽히기 전에 「검증 없는 것만」 목록에 반영한다.
  const [localVerified, setLocalVerified] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [manualOpen, setManualOpen] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const detailActions = useRef<JournalDetailActions | null>(null);
  const scrollTopRef = useRef(memory.current?.scrollTop ?? 0);
  const lastIndexRef = useRef(0);
  const revealRef = useRef<string | null>(null);
  const pendingFirstRef = useRef<string | null>(null);
  const focusDetailRef = useRef(false);

  const searching = query !== "";
  const def = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const typeStrings = useMemo(() => def.types as readonly string[], [def]);

  const allPeriod = showAll || filter !== "all" || onlyMissing;
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
  const gone = useGoneJournals(projectId, oculpmReady);

  // 검색 중 기본 순서는 백엔드가 준 관련도 그대로 — 날짜 머리 없이 한 묶음이다.
  const rawDays: JournalDay[] | null = useMemo(() => {
    if (!searching) return feed.days;
    if (!rank) return found.days;
    return found.ranked ? (found.ranked.length ? [{ workday: "", entries: found.ranked }] : []) : null;
  }, [searching, rank, feed.days, found.days, found.ranked]);
  const loading = searching ? found.loading : feed.loading;
  const error = searching ? found.error : feed.error;
  const refresh = searching ? found.refresh : feed.refresh;

  // 디스크가 다시 읽혔으면 화면의 읽음 덧칠은 걷는다 — 이제 목록이 그 사실을 안다.
  useEffect(() => setLocalVerified((prev) => (prev.size === 0 ? prev : new Map())), [feed.days, found.days]);

  const days = useMemo(() => {
    if (!rawDays) return null;
    const mapped =
      localVerified.size === 0
        ? rawDays
        : rawDays.map((d) => ({
            ...d,
            entries: d.entries.map((e) => {
              const v = localVerified.get(e.relative_path);
              return v === undefined ? e : { ...e, verified_by_user: v, verified_stale: false };
            }),
          }));
    if (!onlyMissing) return mapped;
    return mapped
      .map((d) => ({ ...d, entries: d.entries.filter(isEvidenceMissing) }))
      .filter((d) => d.entries.length > 0);
  }, [rawDays, onlyMissing, localVerified]);
  const allEntries = useMemo(() => (days ?? []).flatMap((d) => d.entries), [days]);

  const filtered = searching || filter !== "all" || onlyMissing;
  const foldSet = filtered ? undefined : gone;
  const vis = useMemo(
    () => visibleOrder(days ?? [], foldSet, openedDays, rowLimit, isEvidenceMissing),
    [days, foldSet, openedDays, rowLimit],
  );
  const order = vis.order;

  const selected = useMemo<JournalEntrySummary | null>(() => {
    if (!selectedPath) return null;
    return allEntries.find((e) => e.relative_path === selectedPath) ?? (pinned?.relative_path === selectedPath ? pinned : null);
  }, [selectedPath, allEntries, pinned]);

  const choose = useCallback((entry: JournalEntrySummary | null, opts?: { pin?: boolean; external?: boolean }) => {
    setSelectedPath(entry?.relative_path ?? null);
    setPinned(opts?.pin && entry ? entry : null);
    setFromExternal(!!opts?.external);
    revealRef.current = opts?.pin && entry ? entry.relative_path : null;
  }, []);
  // 줄 누름 — 고정된 함수라야 memo 줄이 다시 그려지지 않는다.
  const onSelectRow = useCallback((entry: JournalEntrySummary) => choose(entry), [choose]);
  const onToggleDay = useCallback((workday: string, open: boolean) => {
    setOpenedDays((prev) => {
      const next = new Set(prev);
      if (open) next.add(workday);
      else next.delete(workday);
      return next;
    });
  }, []);
  const onVerifiedChange = useCallback((path: string, verified: boolean) => {
    setLocalVerified((prev) => new Map(prev).set(path, verified));
  }, []);

  // 고른 줄의 화면 순서 자리 — 그 줄이 목록에서 빠지면(「검증 없는 것만」 에서 읽음) 같은 자리의 줄을 고른다.
  useEffect(() => {
    const i = selectedPath ? order.findIndex((e) => e.relative_path === selectedPath) : -1;
    if (i >= 0) lastIndexRef.current = i;
  }, [order, selectedPath]);
  // 거르는 조건이 바뀌면 새 목록의 첫 줄부터.
  useEffect(() => {
    lastIndexRef.current = 0;
  }, [filter, onlyMissing, query, showAll, rank]);

  // 밖에서 건너와 고른 일지가 접힌 날 안이면 그날 접힘을 연다(한 번 — 그 뒤로는 사람이 연다).
  useEffect(() => {
    const path = revealRef.current;
    if (!path) return;
    const day = foldedDayOf(vis.views, path);
    if (day) {
      revealRef.current = null;
      if (!openedDays.has(day)) onToggleDay(day, true);
    } else if (order.some((e) => e.relative_path === path)) {
      revealRef.current = null;
    }
  }, [vis.views, order, openedDays, onToggleDay]);

  // 목록이 자리 잡으면 첫 줄을 고른다 — 오른쪽이 빈 채로 시작하지 않게. 고른 줄이 목록에서 빠지면
  // 같은 자리(끝이었으면 바로 위)의 줄을 고른다. 갱신 중(`loading`)에는 옛 목록을 보고 판단하지 않는다.
  useEffect(() => {
    if (loading || !days || openEntryPath || focusPath) return;
    if (selectedPath && (pinned?.relative_path === selectedPath || allEntries.some((e) => e.relative_path === selectedPath))) return;
    const i = Math.min(lastIndexRef.current, order.length - 1);
    const next = i >= 0 ? order[i] : null;
    choose(next);
    if (!selectedPath) return;
    // 고른 줄이 빠졌다(「검증 없는 것만」 에서 읽음). 포커스를 쥔 줄이나 상세(일지마다 새로 선다)가 사라지면
    // 포커스가 body 로 떨어져, 키를 듣는 컨테이너 밖이 되고 다음 j/k/v 가 먹지 않았다 — j → v → j 가 끊겼다.
    // body 로 떨어졌을 때만 새 줄로 옮긴다: 그새 사람이 검색칸 · 필터를 눌렀으면 건드리지 않는다.
    requestAnimationFrame(() => {
      const at = document.activeElement;
      if (at && at !== document.body) return;
      if (!focusRow(listRef.current, next?.relative_path ?? null)) splitRef.current?.focus({ preventScroll: true });
    });
  }, [loading, days, allEntries, order, selectedPath, pinned, openEntryPath, focusPath, choose]);

  // 앱이 켜 있는 동안 기억한다 — 화면을 떠났다 돌아오면 같은 일지 · 같은 자리.
  useEffect(() => {
    rememberJournal(projectId, { path: selectedPath });
  }, [projectId, selectedPath]);
  useEffect(() => () => rememberJournal(projectId, { scrollTop: scrollTopRef.current }), [projectId]);
  const restoredRef = useRef(false);
  useLayoutEffect(() => {
    if (restoredRef.current || !days || !listRef.current) return;
    restoredRef.current = true;
    listRef.current.scrollTop = scrollTopRef.current;
  }, [days]);
  const onListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    scrollTopRef.current = e.currentTarget.scrollTop;
  }, []);

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

  // 오늘의 「N건 더」 가 「검증 없는 것만」 을 켜고 보냈다(`onlyMissing.ts`) — 설 때 회수하고, 서 있는 동안 온 요청은
  // 구독으로 받는다. 거르기는 그대로 이 화면의 지역 상태다(다음에 열면 「전체」 로 시작한다).
  useEffect(() => {
    if (!active) return;
    if (consumeOnlyMissing()) setOnlyMissing(true);
    return onOnlyMissing(() => setOnlyMissing(true));
  }, [active]);

  // Enter 로 고른 일지 — 새 상세가 선 다음에 포커스를 넘긴다.
  useEffect(() => {
    if (!focusDetailRef.current || !selected) return;
    focusDetailRef.current = false;
    detailRef.current?.focus({ preventScroll: true });
  }, [selected]);

  // 고른 줄이 목록에서 보이게 — 키보드로 옮기거나 다른 화면에서 건너왔을 때.
  useEffect(() => {
    if (!selectedPath) return;
    for (const row of listRef.current?.querySelectorAll<HTMLElement>(".jl-item") ?? []) {
      if (row.dataset.path === selectedPath) {
        row.scrollIntoView?.({ block: "nearest" });
        break;
      }
    }
  }, [selectedPath]);

  // 화면에 들어오면 컨테이너가 키를 받게 한다 — 윗줄 탭을 누르고 들어와도 바로 j/k 와 / 가 먹는다.
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
        setManualOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const move = useCallback(
    (delta: number | "first" | "last") => {
      if (order.length === 0) return;
      const cur = selectedPath ? order.findIndex((e) => e.relative_path === selectedPath) : -1;
      let next: number;
      if (delta === "first") next = 0;
      else if (delta === "last") next = order.length - 1;
      else {
        // 고른 줄이 닫힌 접힘 안에 숨었으면 그 줄이 섰던 자리에서 잇는다.
        const base = cur >= 0 ? cur : delta > 0 ? lastIndexRef.current - 1 : lastIndexRef.current;
        next = Math.min(Math.max(base + delta, 0), order.length - 1);
      }
      if (next >= order.length - 1 && vis.drawn < vis.total) setRowLimit((n) => n + ROW_LIMIT);
      const target = order[next];
      choose(target);
      // 포커스도 따라간다 — 안 그러면 이전 줄에 남은 포커스에서 Enter 가 옛 줄을 다시 고른다.
      requestAnimationFrame(() => focusRow(listRef.current, target.relative_path));
    },
    [order, selectedPath, vis.drawn, vis.total, choose],
  );

  // 검색칸 ↓ · Enter — 지금 글자로 찾은 첫 결과로. 결과가 아직 오는 중이면 오면 간다.
  const goFirst = useCallback(
    (q: string) => {
      if (q !== query || loading) {
        pendingFirstRef.current = q;
        return;
      }
      const first = order[0];
      if (!first) return;
      choose(first);
      requestAnimationFrame(() => focusRow(listRef.current, first.relative_path));
    },
    [query, loading, order, choose],
  );
  useEffect(() => {
    const pending = pendingFirstRef.current;
    if (pending == null) return;
    // 그새 다른 글자로 찾기 시작했으면 기다리던 것은 버린다 — 나중에 그 글자로 돌아왔을 때 저절로 뛰지 않게.
    // 못 읽었을 때도 버린다(다시 시도가 나중에 성공해도 그때 뛰지 않게).
    if (pending !== query || (!loading && error)) {
      pendingFirstRef.current = null;
      return;
    }
    // 결과가 **이 검색어의 것**일 때만 푼다. 고친 검색어를 디바운스 전에 Enter 하면, 다시 그린 첫 커밋에는 옛
    // 검색의 결과가 남아 있어 그 첫 줄을 골랐다(11-15). 검색이 아니면 평소 목록이 다시 읽힌 뒤에.
    if (loading || (searching ? found.forQuery !== pending : feed.days == null)) return;
    pendingFirstRef.current = null;
    const first = order[0];
    if (!first) return;
    choose(first);
    requestAnimationFrame(() => focusRow(listRef.current, first.relative_path));
  }, [query, error, loading, searching, found.forQuery, feed.days, order, choose]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const chord = readChord(e);
    if (chord.mod || e.altKey) return;
    const el = e.target as HTMLElement;
    const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    if (typing) return;
    const key = chord.key;
    // 화살표 · Home/End 는 목록에 있을 때만 — 상세 안에서는 상세가 스크롤한다.
    const inList = el === e.currentTarget || !!el.closest(".jl-list");
    if (key === "Escape" && el.closest(".jd")) {
      // 상세에서 목록으로 — Enter 의 반대 방향.
      e.preventDefault();
      focusRow(listRef.current, selectedPath);
      return;
    }
    if (key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    } else if (key === "j" || (inList && key === "ArrowDown")) {
      e.preventDefault();
      move(1);
    } else if (key === "k" || (inList && key === "ArrowUp")) {
      e.preventDefault();
      move(-1);
    } else if (inList && (key === "Home" || key === "End")) {
      e.preventDefault();
      move(key === "Home" ? "first" : "last");
    } else if (key === "v") {
      e.preventDefault();
      detailActions.current?.toggleVerified();
    } else if (key === "[" || key === "]") {
      e.preventDefault();
      detailActions.current?.stepFile(key === "]" ? 1 : -1);
    } else if (key === "Enter") {
      const row = el.closest<HTMLElement>(".jl-item");
      if (!row) return;
      e.preventDefault();
      const hit = allEntries.find((x) => x.relative_path === row.dataset.path);
      if (hit && hit.relative_path !== selectedPath) {
        // 상세는 일지마다 새로 선다(`key`) — 새 상세가 선 뒤에 포커스를 넘긴다.
        focusDetailRef.current = true;
        choose(hit);
      } else detailRef.current?.focus({ preventScroll: true });
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

  // 숫자 한 줄 — 거르거나 찾을 때, 또는 못 받은 쪽이 남았을 때만. 「조건에 맞는 312 · 표시 200」.
  const pageTotal = searching ? found.total : feed.total;
  const pageLoaded = searching ? found.loaded : feed.loaded;
  const morePages = !searching && feed.canLoadMore;
  const matched = onlyMissing || pageTotal == null ? vis.total : pageTotal;
  const capped = searching && (found.total ?? 0) > SEARCH_LIMIT;
  // 「검증 없는 것만」 단추가 걸린 수를 warn 으로 이미 말한다 — 숫자 줄은 단추가 모르는 것(더 받을 쪽 「+」 ·
  // 안 그린 줄 「표시 N」 · 검색 상한)이 있을 때만 선다. 같은 수가 두 곳에 서지 않게.
  const toggleSaysIt = onlyMissing && !morePages && vis.drawn >= matched && !capped;
  let countText: string | null = null;
  // 아직 결과가 없으면(첫 검색을 읽는 중) 세지 않는다 — 「조건에 맞는 0」 이 한 박자 서면 없는 줄 안다.
  if (days != null && !toggleSaysIt && (filtered || (pageTotal != null && pageLoaded != null && pageLoaded < pageTotal))) {
    countText =
      onlyMissing && morePages
        ? t("journal.countMatchMore", { n: matched })
        : vis.drawn < matched
          ? t("journal.countShown", { total: matched, shown: vis.drawn })
          : t("journal.countMatch", { n: matched });
    if (capped) countText = `${countText} · ${t("journal.narrowSearch")}`;
  }

  // 목록 바닥의 손잡이 하나 — 안 그린 줄이 있으면 그리고, 다 그렸으면 다음 쪽을 받는다. 바닥에 닿으면 저절로.
  const undrawn = vis.total - vis.drawn;
  const moreN =
    undrawn > 0
      ? Math.min(ROW_LIMIT, undrawn)
      : morePages
        ? Math.min(JOURNAL_PAGE_SIZE, (pageTotal ?? 0) - (pageLoaded ?? 0))
        : 0;
  const onMore = useCallback(() => {
    const next = rowLimit + ROW_LIMIT;
    setRowLimit(next);
    if (next > vis.total && morePages) feed.loadMore();
  }, [rowLimit, vis.total, morePages, feed]);
  const onMoreRef = useRef(onMore);
  onMoreRef.current = onMore;
  useEffect(() => {
    const el = moreRef.current;
    if (!el || moreN === 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) onMoreRef.current();
      },
      { root: listRef.current, rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [moreN, vis.drawn]);

  // 윗줄의 보통 단추 — 일지는 에이전트가 쓰고 직접 쓰기는 드문 예외다. 채운 단추는 화면에 하나,
  // 그 화면의 다음 행동(빈 화면의 「커밋에서 일지 만들기」)에만 (영수증 규칙 3, 11-04).
  const newEntry = (
    <button
      type="button"
      className="btn"
      onClick={() => setManualOpen(true)}
      {...blocked(todayKey ? null : t("journal.newDisabled"), t("journal.newTitle"))}
    >
      <Plus size={15} /> {t("journal.new")}
    </button>
  );

  const nothingYet =
    oculpmReady && !loading && !error && rawDays != null && rawDays.length === 0 && !searching && filter === "all" && !onlyMissing && !showAll;

  // 「자동으로 기록합니다」 는 거짓이었다 — 일지를 쓰는 것은 에이전트다. 첫날 이 화면을 살리는
  // 구체적인 행동은 둘뿐: 지난 커밋에서 만들거나, 지금 한 건을 직접 쓰거나.
  // 문장 하나 · 버튼 하나 (화면 검사 #empty-one). 예전 기록이 있으면 그리로, 정말 처음이면 커밋에서
  // 첫 일지를 만드는 길 하나 — 새 일지 쓰기는 윗줄 단추가 늘 있다.
  const hasOlder = total != null && total > 0;
  const firstDay = (
    <EmptyState
      density="rich"
      actions={
        hasOlder ? (
          <button type="button" className="btn primary" onClick={() => setShowAll(true)}>
            {t("journal.loadMore")}
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={backfilling} onClick={runGitBackfill}>
            {backfilling ? t("journal.backfill.busy") : t("journal.backfill.action")}
          </button>
        )
      }
    >
      {hasOlder ? t("journal.emptyRecent") : t("journal.empty")}
    </EmptyState>
  );

  const showAgent = useMemo(() => new Set(allEntries.map((e) => e.agent_id)).size > 1, [allEntries]);
  const ranked = searching && rank;

  return (
    <>
      <Toolbar title={t("nav.journal")}>{newEntry}</Toolbar>

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
          <div className="jl-col">
            <JournalHead
              searchRef={searchRef}
              onQuery={setQuery}
              onFirst={goFirst}
              onLeaveSearch={() => splitRef.current?.focus({ preventScroll: true })}
              searching={searching}
              filter={filter}
              onFilter={(next) => {
                setFilter(next);
                setRowLimit(ROW_LIMIT);
              }}
              onlyMissing={onlyMissing}
              missingCount={onlyMissing && days ? vis.total : null}
              onToggleMissing={() => {
                setOnlyMissing((v) => !v);
                setRowLimit(ROW_LIMIT);
              }}
              allPeriod={allPeriod}
              periodLocked={filter !== "all" || onlyMissing}
              onPeriod={(all) => {
                setShowAll(all);
                setRowLimit(ROW_LIMIT);
              }}
              rank={rank}
              onRank={setRank}
              countText={countText}
              onBack={fromExternal ? onReturnToOrigin : undefined}
            />
            <JournalList
              views={vis.views}
              ranked={ranked}
              todayKey={todayKey}
              selectedPath={selectedPath}
              onSelect={onSelectRow}
              onToggleDay={onToggleDay}
              listRef={listRef}
              onScroll={onListScroll}
              showAgent={showAgent}
              excerpts={searching ? found.excerpts : undefined}
              query={searching ? query : undefined}
              onlyMissing={onlyMissing}
              notice={error ? <ErrorCard title={t("journal.loadFailed")} error={error} onRetry={refresh} style={{ margin: 12 }} /> : null}
              empty={
                // 못 불러왔는데 「일지가 없어요」 를 같이 띄우면 없는 건지 못 읽은 건지 모른다.
                error ? null : loading && days == null ? (
                  <SkeletonList rows={4} height={36} />
                ) : (
                  <p className="jl-empty">{filtered ? t("journal.noMatch") : t("journal.empty")}</p>
                )
              }
              footer={
                moreN > 0 && !error ? (
                  <button ref={moreRef} type="button" className="btn sm jl-more" onClick={onMore}>
                    {t("journal.rowMore", { n: moreN })}
                  </button>
                ) : null
              }
            />
          </div>
          {selected ? (
            <JournalDetail
              key={selected.relative_path}
              ref={detailRef}
              projectId={projectId}
              entry={selected}
              planLinks={planLinks.get(selected.relative_path) ?? []}
              onOpenDiff={onOpenDiff}
              onOpenRelated={(p) => void openByPath(p, false, () => false)}
              actionsRef={detailActions}
              onVerifiedChange={onVerifiedChange}
            />
          ) : (
            <div className="jd-empty">{t("journal.pickOne")}</div>
          )}
        </div>
      )}

      {manualOpen && todayKey ? (
        <ManualEntryModalV2
          projectId={projectId}
          workday={todayKey}
          onCreated={(entry) => {
            refresh();
            toast.info(t("journal.written", { title: entry.title }));
          }}
          onClose={() => setManualOpen(false)}
        />
      ) : null}
    </>
  );
}
