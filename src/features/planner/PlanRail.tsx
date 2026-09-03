import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Archive, ChevronDown, ChevronRight, Lock, Search, TriangleAlert, X } from "@/components/Icons";
import type { PlanSummary } from "@/lib/bindings";
import {
  groupPlans,
  relDay,
  searchPlans,
  sortPlans,
  type PlanFacet,
  type PlanGroup,
  type PlanSection,
  type PlanSort,
} from "./planList";
import { useT } from "@/i18n";
import { stripInlineMarkdown } from "@/lib/inlineMarkdown";

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
/**
 * 한 섹션이 한 번에 그리는 최대 행 수. 넘는 만큼은 "N개 더" 뒤에 둔다.
 *
 * 월별로 쪼개도(`splitByMonth`) 한 달에 스무 개를 끝낸 달은 여전히 벽이다.
 * 상한은 그 벽을 접는 마지막 장치이고, 펼침은 섹션별로 따로 기억한다.
 */
const ROW_CAP = 10;

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
  /** 레일이 붙는 쪽. 오른쪽이면 구분선·여백이 반대로 간다. */
  side: "left" | "right";
  /**
   * 한 묶음을 통째로 보관으로 옮긴다 (완료 섹션에만 붙는다). 없으면 버튼도
   * 그리지 않는다 — 레일은 무엇을 할 수 있는지 스스로 정하지 않는다.
   */
  onArchiveSection?: (planIds: string[]) => void;
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
  side,
  onArchiveSection,
}: PlanRailProps) {
  const { t } = useT();
  const listRef = useRef<HTMLDivElement | null>(null);
  /** 상한을 풀어 둔 섹션 (세션 한정 — 영속할 만한 결정이 아니다). */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** 보관 확인을 기다리는 섹션. 한 번에 하나만. */
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

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

  /**
   * 섹션이 실제로 그리는 행. 상한(ROW_CAP)을 넘으면 앞쪽만 남긴다 — 검색
   * 중에는 걸지 않는다 (찾은 것을 숨기면 검색이 아니다).
   */
  const rowsOf = useCallback(
    (sec: PlanSection) =>
      !searching && !expanded[sec.key] && sec.plans.length > ROW_CAP
        ? sec.plans.slice(0, ROW_CAP)
        : sec.plans,
    [searching, expanded],
  );

  /** 현재 화면에 실제로 보이는 순서 — ↑/↓ 이동의 기준. 접힌 섹션도, 상한
   *  뒤에 숨은 행도 여기 없다 (없는 행으로 커서를 옮기면 포커스가 사라진다). */
  const visible = useMemo(
    () => sections.flatMap((s) => (isOpen(s.key, s.defaultOpen) ? rowsOf(s) : [])),
    [sections, isOpen, rowsOf],
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
    <div className={"pln-rail" + (side === "right" ? " on-right" : "")}>
      {showControls ? (
        <div className="pln-rail-controls">
          <div className="search-box pln-rail-search">
            <Search size={13} />
            <input
              aria-label={t("plan.rail.searchAria")}
              placeholder={t("plan.rail.searchAria")}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
            />
            {query ? (
              <button
                type="button"
                className="pln-rail-clear"
                aria-label={t("journal.clearSearch")}
                onClick={() => onQueryChange("")}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
          <div className="pln-rail-selects">
            <select
              className="set-input"
              aria-label={t("plan.rail.sortAria")}
              value={sort}
              onChange={(e) => onSortChange(e.target.value as PlanSort)}
            >
              <option value="recent">{t("plan.rail.sort.recent")}</option>
              <option value="progress">{t("plan.rail.sort.progress")}</option>
              <option value="remaining">{t("plan.rail.sort.remaining")}</option>
              <option value="title">{t("plan.rail.sort.title")}</option>
            </select>
            <select
              className="set-input"
              aria-label={t("plan.rail.groupAria")}
              value={group}
              onChange={(e) => onGroupChange(e.target.value as PlanGroup)}
            >
              <option value="status">{t("plan.rail.group.status")}</option>
              <option value="recency">{t("plan.rail.group.recency")}</option>
              <option value="agent">{t("plan.rail.group.agent")}</option>
              <option value="none">{t("plan.rail.group.none")}</option>
            </select>
          </div>
        </div>
      ) : null}

      <div className="pln-rail-list" ref={listRef} onKeyDown={onListKeyDown}>
        {sections.length === 0 ? (
          <div className="pln-rail-empty">
            {searching ? t("plan.rail.noMatch") : t("plan.rail.empty")}
          </div>
        ) : null}

        {sections.map((sec) => {
          const open = isOpen(sec.key, sec.defaultOpen);
          const flat = !showSections && sec.key === "all";
          const rows = rowsOf(sec);
          const hidden = sec.plans.length - rows.length;
          // 보관은 '끝난 것을 치우는' 동작이라 완료 묶음에만 붙인다. 이미
          // 보관된 묶음이나 진행 중에는 의미가 없다.
          const archivable =
            onArchiveSection != null && (sec.key === "done" || sec.key.startsWith("done:"));
          const confirming = confirmKey === sec.key;
          return (
            <div key={sec.key} className="pln-sec">
              {flat ? null : (
                <div className="pln-sec-head">
                  <button
                    type="button"
                    className="pln-sec-toggle"
                    aria-expanded={open}
                    onClick={() => onToggleSection(sec.key, !open)}
                  >
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className="pln-sec-label">{sec.label}</span>
                    <span className="pln-sec-count">{sec.plans.length}</span>
                  </button>
                  {archivable ? (
                    <button
                      type="button"
                      className="pln-sec-act"
                      aria-label={t("plan.rail.archiveAria", { n: sec.plans.length })}
                      title={t("plan.rail.archiveAria", { n: sec.plans.length })}
                      onClick={() => setConfirmKey(confirming ? null : sec.key)}
                    >
                      <Archive size={12} />
                    </button>
                  ) : null}
                </div>
              )}
              {confirming ? (
                <div className="pln-sec-confirm">
                  <span>{t("plan.rail.archiveQuestion", { n: sec.plans.length })}</span>
                  <button
                    type="button"
                    className="pln-textbtn"
                    onClick={() => {
                      setConfirmKey(null);
                      onArchiveSection?.(sec.plans.map((p) => p.plan_id));
                    }}
                  >
                    {t("plan.rail.archiveConfirm")}
                  </button>
                  <button type="button" className="pln-textbtn" onClick={() => setConfirmKey(null)}>
                    {t("common.cancel")}
                  </button>
                </div>
              ) : null}
              {open
                ? rows.map((p) => (
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
              {open && hidden > 0 ? (
                <button
                  type="button"
                  className="pln-sec-more"
                  onClick={() => setExpanded((e) => ({ ...e, [sec.key]: true }))}
                >
                  {t("plan.rail.more", { n: hidden })}
                </button>
              ) : null}
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
  const { t } = useT();
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
      title={`${locked ? t("plan.rail.lockedPrefix") : ""}${plan.done_count}/${plan.item_count} · ${pct}%`}
      onClick={() => onSelect(plan.plan_id)}
    >
      <span className="pln-row-top">
        {/* 행 전체가 버튼이라 앵커/강조 요소를 넣지 않는다 — 마크다운 기호만
            걷어낸 평문. 목차에는 `**` 노이즈가 없는 편이 읽기 좋다. */}
        <span className="pln-row-title">{stripInlineMarkdown(plan.title)}</span>
        {locked ? <Lock size={11} className="pln-row-lock" aria-label={t("plan.locked")} /> : null}
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
            {t("plan.rail.stale", { n: stale })}
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
