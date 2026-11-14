import { useRef, type KeyboardEvent, type RefObject } from "react";
import { ArrowLeft } from "@/components/Icons";
import { useT, type I18nKey } from "@/i18n";
import type { EntryType } from "@/lib/bindings";
import { blocked } from "@/lib/blocked";
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

/**
 * 하나를 고르는 칸들 — radiogroup. 고른 칸만 Tab 이 멈추고, 화살표가 칸을 옮긴다(옮기면 곧 고른다).
 * 화살표는 여기서 멈춘다 — 화면 컨테이너의 ↑↓(일지 사이 이동)까지 내려가지 않게.
 */
function Radios<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string; blockedReason?: string | null }[];
  onChange: (id: T) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const open = options.filter((o) => !o.blockedReason);
    const at = open.findIndex((o) => o.id === value);
    const next = open[(at + dir + open.length) % open.length];
    if (!next) return;
    onChange(next.id);
    refs.current[options.indexOf(next)]?.focus();
  };
  return (
    <div className="seg" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          tabIndex={value === o.id ? 0 : -1}
          className="seg-item"
          {...blocked(o.blockedReason ?? null)}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
          <Radios
            label={t("journal.orderAria")}
            value={rank ? "rank" : "recent"}
            options={[
              { id: "rank", label: t("journal.order.rank") },
              { id: "recent", label: t("journal.order.recent") },
            ]}
            onChange={(id) => onRank(id === "rank")}
          />
        ) : (
          <Radios
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
        <Radios
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
        {countText ? <span className="jl-count">{countText}</span> : null}
      </div>
    </div>
  );
}
