import { memo, useCallback, useMemo, useRef } from "react";
import { ChevronDown, ChevronRight, Lock, Search, TriangleAlert, X } from "@/components/Icons";
import type { PlanSummary } from "@/lib/bindings";
import {
  groupPlans,
  relDay,
  searchPlans,
  sortPlans,
  type PlanFacet,
  type PlanGroup,
  type PlanSort,
} from "./planList";

/**
 * Planner 좌측 계획 레일 — 계획 목록을 '선택기' 에서 '포트폴리오 뷰' 로 올린다.
 *
 * 2026-07-30 스케일 라운드 이전에는 계획이 전부 `.plan-chip-row` 의 랩되는
 * 칩이었다. 칩은 `white-space:nowrap; flex:none` 이라 제목 길이만큼 그대로
 * 밀려나고 행 수에 상한이 없어서, 계획이 15개쯤 되면 본문을 접힘선 아래로
 * 밀어내는 벽이 됐다. 검색·정렬·묶기도 없어 '무엇이 남았나' 를 알 방법이
 * 없었다. 세로로 자라는 목록은 계획 수와 무관하게 높이가 일정하다.
 *
 * 껍데기 규격은 이미 검증된 Discussion/Skills/Docs 의 2-pane 을 따르고,
 * 파생 로직은 전부 `planList.ts` (순수·테스트됨) 에 있다. 이 파일은 그리기만 한다.
 */

/** 이 수 미만이면 컨트롤 바(검색·정렬·묶기)를 숨긴다 — 셋뿐인 계획엔 과하다. */
const CONTROLS_MIN_PLANS = 6;
/** 이 수 미만이면 섹션 헤더 없이 평평한 목록으로 그린다. */
const SECTIONS_MIN_PLANS = 4;

interface PlanRailProps {
  plans: readonly PlanSummary[];
  facets: ReadonlyMap<string, PlanFacet>;
  selectedId: string | null;
  onSelect: (planId: string) => void;
  sort: PlanSort;
  onSortChange: (sort: PlanSort) => void;
  group: PlanGroup;
  onGroupChange: (group: PlanGroup) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /**
   * 사용자가 명시적으로 여닫은 섹션 (key → 펼침). 없는 key 는 섹션 자신의
   * 기본값을 따른다 — '닫힌 목록' 방식이면 기본이 닫힘인 섹션(완료·보관)을
   * 열 방법이 사라진다.
   */
  openOverride: Readonly<Record<string, boolean>>;
  onToggleSection: (key: string, nextOpen: boolean) => void;
  now: number;
}

export function PlanRail({
  plans,
  facets,
  selectedId,
  onSelect,
  sort,
  onSortChange,
  group,
  onGroupChange,
  query,
  onQueryChange,
  openOverride,
  onToggleSection,
  now,
}: PlanRailProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  const showControls = plans.length >= CONTROLS_MIN_PLANS;
  const showSections = plans.length >= SECTIONS_MIN_PLANS;
  const searching = query.trim().length > 0;

  const sections = useMemo(() => {
    const found = searchPlans(plans, query);
    const sorted = sortPlans(found, sort, facets);
    return groupPlans(sorted, showSections ? group : "none", facets, now);
  }, [plans, query, sort, group, facets, now, showSections]);

  const isOpen = useCallback(
    (key: string, defaultOpen: boolean) =>
      // 검색 중에는 접힌 섹션도 강제로 펼친다 — 일치하는 계획이 접힌 섹션
      // 안에 있으면 "일치 없음" 처럼 보여 검색이 고장난 것으로 읽힌다.
      searching || (openOverride[key] ?? defaultOpen),
    [searching, openOverride],
  );

  /** 현재 화면에 실제로 보이는 순서 — ↑/↓ 이동의 기준. */
  const visible = useMemo(
    () => sections.flatMap((s) => (isOpen(s.key, s.defaultOpen) ? s.plans : [])),
    [sections, isOpen],
  );

  // ↑/↓ 는 목록 위에서만 동작한다. 컨트롤 바의 네이티브 <select> 는 ↑/↓ 로
  // 값을 바꾸는 것이 표준 동작이므로 절대 가로채지 않는다.
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (visible.length === 0) return;
    e.preventDefault();
    const cur = visible.findIndex((p) => p.plan_id === selectedId);
    const step = e.key === "ArrowDown" ? 1 : -1;
    const next = cur === -1 ? 0 : Math.min(visible.length - 1, Math.max(0, cur + step));
    const target = visible[next];
    if (!target) return;
    onSelect(target.plan_id);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-plan-id="${CSS.escape(target.plan_id)}"]`)
      ?.focus();
  };

  return (
    <div className="pln-rail">
      {showControls ? (
        <div className="pln-rail-controls">
          <div className="search-box pln-rail-search">
            <Search size={13} />
            <input
              aria-label="계획 검색"
              placeholder="계획 검색"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
            />
            {query ? (
              <button
                type="button"
                className="pln-rail-clear"
                aria-label="검색어 지우기"
                onClick={() => onQueryChange("")}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
          <div className="pln-rail-selects">
            <select
              className="set-input"
              aria-label="계획 정렬"
              value={sort}
              onChange={(e) => onSortChange(e.target.value as PlanSort)}
            >
              <option value="recent">최근순</option>
              <option value="progress">진척순</option>
              <option value="remaining">남은 일 순</option>
              <option value="title">이름순</option>
            </select>
            <select
              className="set-input"
              aria-label="계획 묶기"
              value={group}
              onChange={(e) => onGroupChange(e.target.value as PlanGroup)}
            >
              <option value="status">상태별</option>
              <option value="recency">최근활동별</option>
              <option value="agent">작성자별</option>
              <option value="none">묶지 않음</option>
            </select>
          </div>
        </div>
      ) : null}

      <div className="pln-rail-list" ref={listRef} onKeyDown={onListKeyDown}>
        {sections.length === 0 ? (
          <div className="pln-rail-empty">
            {searching ? "일치하는 계획이 없어요." : "계획이 없어요."}
          </div>
        ) : null}

        {sections.map((sec) => {
          const open = isOpen(sec.key, sec.defaultOpen);
          const flat = !showSections && sec.key === "all";
          return (
            <div key={sec.key} className="pln-sec">
              {flat ? null : (
                <button
                  type="button"
                  className="pln-sec-head"
                  aria-expanded={open}
                  onClick={() => onToggleSection(sec.key, !open)}
                >
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span>{sec.label}</span>
                  <span className="pln-sec-count">{sec.plans.length}</span>
                </button>
              )}
              {open
                ? sec.plans.map((p) => (
                    <PlanRailRow
                      key={p.plan_id}
                      plan={p}
                      facet={facets.get(p.plan_id)}
                      selected={p.plan_id === selectedId}
                      onSelect={onSelect}
                      now={now}
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PlanRailRowProps {
  plan: PlanSummary;
  facet: PlanFacet | undefined;
  selected: boolean;
  onSelect: (planId: string) => void;
  now: number;
}

/**
 * 한 계획 행. 제목 · 진행 바 · 완료수 · 마지막 활동(또는 멈춤 배지).
 *
 * 행 전체가 버튼 하나다 — 안에 두 번째 버튼을 넣으면 중첩 인터랙티브가 되어
 * 접근성 검사가 실패한다.
 */
const PlanRailRow = memo(function PlanRailRow({
  plan,
  facet,
  selected,
  onSelect,
  now,
}: PlanRailRowProps) {
  const pct = facet?.pct ?? Math.round((plan.progress ?? 0) * 100);
  const locked = plan.status !== "active";
  const stale = facet?.staleDays ?? null;
  const when = relDay(facet?.touchedAt ?? null, now);

  return (
    <button
      type="button"
      data-plan-id={plan.plan_id}
      className={"pln-row" + (selected ? " on" : "")}
      aria-current={selected ? "true" : undefined}
      title={`${locked ? "완료·잠금 · " : ""}${plan.done_count}/${plan.item_count} · ${pct}%`}
      onClick={() => onSelect(plan.plan_id)}
    >
      <span className="pln-row-top">
        <span className="pln-row-title">{plan.title}</span>
        {locked ? <Lock size={11} className="pln-row-lock" aria-label="완료·잠금" /> : null}
      </span>
      {/* 진행 바는 meta 줄 안에 짧게 둔다. 제목 바로 밑에 전폭으로 깔면
          밑줄·구분선으로 읽혀 제목과 수치가 갈라져 보인다 (하네스에서 확인). */}
      <span className="pln-row-meta">
        <span className="pln-row-count">
          {plan.done_count}/{plan.item_count}
        </span>
        {stale != null ? (
          <span className="pln-row-stale">
            <TriangleAlert size={10} />
            {stale}일째 멈춤
          </span>
        ) : when ? (
          <span>{when}</span>
        ) : null}
        <span className="pln-row-bar" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
      </span>
    </button>
  );
});
