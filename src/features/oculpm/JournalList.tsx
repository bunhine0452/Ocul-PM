import { memo, type ReactNode, type Ref, type UIEvent } from "react";
import { Disclosure } from "@/components/Disclosure";
import { useT } from "@/i18n";
import { shiftWorkday } from "@/lib/workday";
import type { JournalEntrySummary } from "@/lib/bindings";
import { JournalRow } from "./JournalRow";
import type { DayView } from "./journalOrder";

export { ROW_LIMIT } from "./journalOrder";

/** 날짜 머리 — 「오늘 · 10월 28일」 · 「어제 · 10월 27일」 · 「10월 24일」 (올해가 아니면 연도 포함). */
function dayHeading(
  workday: string,
  todayKey: string | null,
  t: ReturnType<typeof useT>["t"],
): string {
  const y = workday.slice(0, 4);
  const m = String(Number(workday.slice(4, 6)));
  const d = String(Number(workday.slice(6, 8)));
  const sameYear = todayKey ? y === todayKey.slice(0, 4) : true;
  const md = sameYear ? t("journal.dayMd", { m, d }) : t("journal.dayYmd", { y, m, d });
  if (todayKey && workday === todayKey) return `${t("journal.day.today")} · ${md}`;
  if (todayKey && workday === shiftWorkday(todayKey, -1)) return `${t("journal.day.yesterday")} · ${md}`;
  return md;
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
  footer,
  notice,
  empty,
}: JournalListProps) {
  const { t } = useT();
  const row = (e: JournalEntrySummary) => (
    <JournalRow
      key={e.relative_path}
      entry={e}
      selected={e.relative_path === selectedPath}
      tabbable={e.relative_path === selectedPath}
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
        const heading = ranked ? t("journal.searchResults") : dayHeading(v.workday, todayKey, t);
        const headId = `jl-day-${v.workday || "ranked"}`;
        return (
          <section key={v.workday || "ranked"} className="jl-day" role="group" aria-labelledby={headId}>
            <h3 className="jl-dayh" id={headId}>
              <span>{heading}</span>
              <span className="jl-dayn">
                {v.count}
                {v.missing > 0 ? (
                  <>
                    {" · "}
                    {t("journal.evidence.missing")} <b className="jl-warn-n">{v.missing}</b>
                  </>
                ) : null}
              </span>
            </h3>
            <div role="listbox" aria-label={t("journal.listAria")} className="jl-rows">
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
                <div role="listbox" aria-label={t("journal.goneFoldLabel")} className="jl-rows">
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
