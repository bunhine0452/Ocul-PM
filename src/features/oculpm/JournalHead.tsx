import type { RefObject } from "react";
import { ArrowLeft } from "@/components/Icons";
import { RadioSeg } from "@/components/RadioSeg";
import { useT, type I18nKey } from "@/i18n";
import type { EntryType } from "@/lib/bindings";
import { JournalSearchInput } from "./JournalSearchInput";

// 일지 목록 칸의 머리 (11-15) — 검색칸 줄(돌아가기 · 검색 · 기간/순서), 그리고 종류 · 거르기 · 숫자가 흐르는 줄.
// 검색과 필터는 목록을 거르므로 목록 위에 산다 — 셸 윗줄에 두면 탭 넷과 한 줄을 다퉜다 (4.0 윗줄 개편).

// 종류와 「검증 없는 것만」 은 다른 축이라 따로 건다 — 한 줄 세그먼트에 섞여 있을 때는 「검증 없는 버그」를
// 고를 수 없었다 (화면 검사 {#journal-filter}).
export type Filter = "all" | "fix" | "feature" | "refactor" | "chore";

export const FILTERS: { id: Filter; labelKey: I18nKey; types: EntryType[] }[] = [
  { id: "all", labelKey: "journal.filter.all", types: [] },
  { id: "fix", labelKey: "journal.filter.fix", types: ["bug", "error"] },
  { id: "feature", labelKey: "journal.filter.feature", types: ["feature"] },
  { id: "refactor", labelKey: "journal.filter.refactor", types: ["refactor"] },
  { id: "chore", labelKey: "journal.filter.chore", types: ["chore"] },
];

// 하나를 고르는 칸들은 앱의 한 벌(`RadioSeg`)이다 (11-15 RC-19) — 여기서 같은 것을 다시 짠 지역 라디오를 걷었다.
// 막힌 칸(종류 · 검증으로 거르는 동안의 「최근 14일」)은 `blockedReason` 으로 그대로 막힌다.

export function JournalHead({
  searchRef,
  onQuery,
  onFirst,
  onLeaveSearch,
  searching,
  filter,
  onFilter,
  onlyMissing,
  missingCount,
  onToggleMissing,
  dayLabel = null,
  dayOnly = false,
  onToggleDay,
  allPeriod,
  periodLocked,
  onPeriod,
  rank,
  onRank,
  countText,
  onBack,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  onQuery: (query: string) => void;
  onFirst: (query: string) => void;
  onLeaveSearch: () => void;
  searching: boolean;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onlyMissing: boolean;
  /** 켜졌을 때 걸린 수 — warn 숫자로 선다. */
  missingCount: number | null;
  onToggleMissing: () => void;
  /**
   * 「검증 없는 것만」 에 실어 온 날이 있으면 그 날의 말(「오늘만」) — 그 날로 좁히고 넓히는 전환 단추다. 눌러도
   * 사라지지 않고 눌림만 바뀐다(포커스가 단추에 남는다).
   */
  dayLabel?: string | null;
  /** 지금 그 날로 좁혔는가 — 좁힌 동안은 기간 라디오가 서지 않는다(목록은 하루치인데 「전체 기간」 이 고른 채였다). */
  dayOnly?: boolean;
  onToggleDay?: () => void;
  allPeriod: boolean;
  /** 종류 · 검증으로 거르는 동안은 전체 기간에서만 찾는다 — 「최근 14일」 이 막힌다. */
  periodLocked: boolean;
  onPeriod: (all: boolean) => void;
  /** 검색 결과의 순서 — 관련도(기본) / 최신. */
  rank: boolean;
  onRank: (rank: boolean) => void;
  /** 숫자 한 줄 — 「조건에 맞는 312 · 표시 200」. 거르지 않으면 없다. */
  countText: string | null;
  /** 다른 화면에서 건너왔을 때 — 출발 화면으로. */
  onBack?: () => void;
}) {
  const { t } = useT();
  return (
    <div className="jl-head">
      <div className="jl-head-row">
        {onBack ? (
          <button type="button" className="iconbtn sm" onClick={onBack} aria-label={t("journal.backToPlan")} title={t("journal.backToPlan")}>
            <ArrowLeft size={15} />
          </button>
        ) : null}
        <JournalSearchInput inputRef={searchRef} onQuery={onQuery} onFirst={onFirst} onLeave={onLeaveSearch} />
        {searching ? (
          <RadioSeg
            label={t("journal.orderAria")}
            value={rank ? "rank" : "recent"}
            options={[
              { id: "rank", label: t("journal.order.rank") },
              { id: "recent", label: t("journal.order.recent") },
            ]}
            onChange={(id) => onRank(id === "rank")}
          />
        ) : dayOnly ? null : (
          <RadioSeg
            label={t("journal.periodAria")}
            value={allPeriod ? "all" : "recent"}
            options={[
              { id: "recent", label: t("journal.period.recent"), blockedReason: periodLocked ? t("journal.period.locked") : null },
              { id: "all", label: t("journal.period.all") },
            ]}
            onChange={(id) => onPeriod(id === "all")}
          />
        )}
      </div>
      {/* 종류 · 「검증 없는 것만」 · 수가 한 줄에 흐른다 — 목록 칸(320)에서는 단추가 다음 줄로 내려가고, 좁은 창에서
          칸이 위아래로 쌓여 넓어지면 한 줄에 서서 머리가 한 줄 준다(목록이 그만큼 더 보인다). */}
      <div className="jl-head-row jl-head-wrap">
        <RadioSeg
          label={t("journal.typeFilterAria")}
          value={filter}
          options={FILTERS.map((f) => ({ id: f.id, label: t(f.labelKey) }))}
          onChange={onFilter}
        />
        <button
          type="button"
          className="jl-only"
          aria-pressed={onlyMissing}
          title={t("journal.filterNoEvidenceTitle")}
          onClick={onToggleMissing}
        >
          {t("journal.filterNoEvidence")}
          {onlyMissing && missingCount != null ? (
            <>
              {" "}
              <span className="jl-warn-n">{missingCount}</span>
            </>
          ) : null}
        </button>
        {onlyMissing && dayLabel ? (
          <button
            type="button"
            className="jl-only"
            aria-pressed={dayOnly}
            title={t(dayOnly ? "journal.dayScopeTitle" : "journal.dayScopeOffTitle")}
            onClick={onToggleDay}
          >
            {dayLabel}
          </button>
        ) : null}
        {countText ? <span className="jl-count">{countText}</span> : null}
      </div>
    </div>
  );
}
