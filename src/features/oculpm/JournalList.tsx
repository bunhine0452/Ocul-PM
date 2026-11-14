import { memo, type ReactNode, type Ref, type UIEvent } from "react";
import { Disclosure } from "@/components/Disclosure";
import { useT, type Lang } from "@/i18n";
import { dayWord, workdayDate } from "@/lib/workdayLabel";
import type { JournalEntrySummary } from "@/lib/bindings";
import { JournalRow } from "./JournalRow";
import type { DayView } from "./journalOrder";

export { ROW_LIMIT } from "./journalOrder";

/**
 * 날짜 머리 — 「오늘 · 11월 15일」 · 「어제 · 11월 14일」 · 「11월 13일」(올해가 아니면 연도). 날짜 말은 ⌘K 의 일지 줄 ·
 * 시작 창과 같은 함수(`workdayLabel`)다 — 이 목록만 「11/13」 · 「2025-11-13」 처럼 따로 쓰던 때가 있었다.
 */
function dayHeading(workday: string, todayKey: string | null, lang: Lang, t: ReturnType<typeof useT>["t"]): string {
  const today = todayKey ?? undefined;
  const date = workdayDate(workday, lang, today);
  const word = dayWord(workday, lang, t, today);
  return word === date ? date : `${word} · ${date}`;
}

interface JournalListProps {
  /** 화면 순서(`visibleOrder`)가 정한 날들 — 그리기와 j/k 가 같은 것을 본다. */
  views: DayView[];
  /** 관련도 순서 — 날짜 머리 없이 한 묶음, 줄의 오른쪽 칸은 날짜. */
  ranked?: boolean;
  todayKey: string | null;
  selectedPath: string | null;
  /** 줄을 눌렀다 — 화면이 고정된 함수를 준다(줄이 memo 다). */
  onSelect: (entry: JournalEntrySummary) => void;
  /** 사라진 코드의 일지 접힘을 사람이 열고 닫았다. */
  onToggleDay: (workday: string, open: boolean) => void;
  listRef: Ref<HTMLDivElement>;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  showAgent: boolean;
  /** 검색 발췌 (경로 → 한 줄). */
  excerpts?: ReadonlyMap<string, string>;
  query?: string;
  /** 「검증 없는 것만」 이 켜졌다 — 줄이 전부 그것이라 날짜 머리의 「검증 없음 N」 은 같은 말이다. */
  onlyMissing?: boolean;
  /** 목록 아래 손잡이(더 보기) — 화면이 정한다. */
  footer?: ReactNode;
  /** 목록 위 고지(못 읽었다). */
  notice?: ReactNode;
  empty?: ReactNode;
}

/**
 * 일지 목록 (4.0 → 11-15). 날마다 listbox 하나 — 날짜 묶음은 group 이고 그 안의 줄이 option 이다. 사라진
 * 코드의 일지는 그날 끝의 접힘(`Disclosure`) 안에 따로 listbox 로 선다: 접는 손잡이는 단추라 listbox 안에
 * 둘 수 없다(option 만 둔다).
 *
 * memo 다 — 검색칸에 글자를 칠 때 목록 전체가 다시 그려지지 않게. 화면은 고정된 콜백을 준다.
 */
export const JournalList = memo(function JournalList({
  views,
  ranked = false,
  todayKey,
  selectedPath,
  onSelect,
  onToggleDay,
  listRef,
  onScroll,
  showAgent,
  excerpts,
  query,
  onlyMissing = false,
  footer,
  notice,
  empty,
}: JournalListProps) {
  const { t, lang } = useT();
  // 로빙 tabindex — Tab 이 멈출 줄 하나. 고른 일지가 목록에 그려져 있지 않으면(계획에서 연 14일 밖 일지 ·
  // 닫힌 접힘 안 · 그린 줄 상한 밖) 화면 순서의 첫 줄이 받는다 — 안 그러면 Tab 으로 목록에 들어갈 수 없다.
  const drawn = views.flatMap((v) => (v.open ? [...v.shown, ...v.folded] : v.shown));
  const tabPath = drawn.some((e) => e.relative_path === selectedPath) ? selectedPath : (drawn[0]?.relative_path ?? null);
  const row = (e: JournalEntrySummary) => (
    <JournalRow
      key={e.relative_path}
      entry={e}
      selected={e.relative_path === selectedPath}
      tabbable={e.relative_path === tabPath}
      onSelect={onSelect}
      showAgent={showAgent}
      excerpt={excerpts?.get(e.relative_path)}
      query={query}
      withDate={ranked}
    />
  );
  return (
    <div className="jl-list" ref={listRef} onScroll={onScroll}>
      {notice}
      {views.length === 0 ? empty : null}
      {views.map((v) => {
        const heading = ranked ? t("journal.searchResults") : dayHeading(v.workday, todayKey, lang, t);
        const headId = `jl-day-${v.workday || "ranked"}`;
        // 머리의 수는 다른 곳이 말하지 않는 것만 — 관련도 묶음의 건수는 숫자 줄(「조건에 맞는 N」)이, 「검증 없는
        // 것만」 이 켜진 동안의 검증 없음 수는 그 단추가 이미 말한다.
        const showCount = !ranked;
        const showMissing = v.missing > 0 && !onlyMissing;
        return (
          <section key={v.workday || "ranked"} className="jl-day" role="group" aria-labelledby={headId}>
            <h3 className="jl-dayh" id={headId}>
              <span id={`${headId}-name`}>{heading}</span>
              <span className="jl-dayn">
                {showCount ? v.count : null}
                {showMissing ? (
                  <>
                    {showCount ? " · " : null}
                    {t("journal.evidence.missing")} <b className="jl-warn-n">{v.missing}</b>
                  </>
                ) : null}
              </span>
            </h3>
            {/* 날마다 선 목록의 이름은 그 날 — 모두 같은 「일지 목록」 이면 스크린 리더가 같은 이름을 날 수만큼 읽었다. */}
            <div role="listbox" aria-labelledby={`${headId}-name`} className="jl-rows">
              {v.shown.map(row)}
            </div>
            {v.folded.length > 0 ? (
              <Disclosure
                className="jl-gone"
                label={t("journal.goneFoldLabel")}
                count={v.folded.length}
                title={t("journal.goneFoldTitle")}
                open={v.open}
                onToggle={(open) => onToggleDay(v.workday, open)}
              >
                <div role="listbox" aria-label={`${heading} · ${t("journal.goneFoldLabel")}`} className="jl-rows">
                  {v.folded.map(row)}
                </div>
              </Disclosure>
            ) : null}
          </section>
        );
      })}
      {footer}
    </div>
  );
});
