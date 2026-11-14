import type { Ref } from "react";
import { ChevronRight } from "@/components/Icons";
import { useT } from "@/i18n";
import { shiftWorkday } from "@/lib/workday";
import type { JournalEntrySummary } from "@/lib/bindings";
import { JournalRow } from "./JournalRow";
import type { JournalDay } from "./useJournalDays";

/** 한 번에 그리는 행 수 — 하루 60건을 쓰는 사용자에게도 마운트 수가 건수에 비례하지 않게 한다. */
export const ROW_LIMIT = 150;

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
  days: JournalDay[];
  todayKey: string | null;
  selectedPath: string | null;
  onSelect: (entry: JournalEntrySummary) => void;
  /** 그릴 수 있는 행의 상한 — 넘으면 「더 보기」 행이 선다. */
  limit: number;
  onMore: () => void;
  listRef: Ref<HTMLDivElement>;
  /** 목록 아래에 붙는 손잡이(전체 기간·다음 쪽) — 화면이 정한다. */
  footer?: React.ReactNode;
  /** 목록 위에 붙는 고지(상한에 걸렸다). */
  notice?: React.ReactNode;
  empty?: React.ReactNode;
  /**
   * 사라진 코드의 일지(건드린 파일이 지금 하나도 없는 것)의 경로 — 날마다 한 줄로 접는다.
   * 주지 않으면 접지 않는다. 찾거나 거르는 중에는 화면이 주지 않는다: 그때 사람은 바로 그것을 찾는 중일 수 있다.
   */
  gone?: ReadonlySet<string>;
}

export function JournalList({
  days,
  todayKey,
  selectedPath,
  onSelect,
  limit,
  onMore,
  listRef,
  footer,
  notice,
  empty,
  gone,
}: JournalListProps) {
  const { t } = useT();
  let drawn = 0;
  const total = days.reduce((s, d) => s + d.entries.length, 0);
  const showAgent = new Set(days.flatMap((d) => d.entries.map((e) => e.agent_id))).size > 1;
  // 전부가 사라진 코드의 일지면 접지 않는다 — 날짜 머리만 남은 목록은 목록이 아니다
  // (경로를 다른 폴더 기준으로 적은 저장소가 그렇게 된다).
  const fold = gone != null && gone.size > 0 && days.some((d) => d.entries.some((e) => !gone.has(e.relative_path)));
  const row = (e: JournalEntrySummary) => (
    <JournalRow
      key={e.relative_path}
      entry={e}
      selected={e.relative_path === selectedPath}
      onSelect={onSelect}
      showAgent={showAgent}
    />
  );
  return (
    <div className="jl-list" ref={listRef} role="region" aria-label={t("journal.listAria")}>
      {notice}
      {days.length === 0 ? empty : null}
      {days.map((day) => {
        if (drawn >= limit) return null;
        const room = limit - drawn;
        const rows = day.entries.slice(0, room);
        drawn += rows.length;
        const folded = fold ? rows.filter((e) => gone.has(e.relative_path)) : [];
        const shown = fold ? rows.filter((e) => !gone.has(e.relative_path)) : rows;
        return (
          <section key={day.workday} aria-label={dayHeading(day.workday, todayKey, t)}>
            <h3 className="jl-dayh">{dayHeading(day.workday, todayKey, t)}</h3>
            {shown.map(row)}
            {folded.length > 0 ? (
              // 고른 일지가 접힌 쪽이면 펴 둔다 — 상세에 열린 것이 목록에 없으면 길을 잃는다.
              <details className="jl-gone" open={folded.some((e) => e.relative_path === selectedPath) || undefined}>
                <summary className="jl-gone-h" title={t("journal.goneFoldTitle")}>
                  <ChevronRight size={11} className="jl-gone-chev" aria-hidden="true" />
                  {t("journal.goneFold", { n: folded.length })}
                </summary>
                {folded.map(row)}
              </details>
            ) : null}
          </section>
        );
      })}
      {total > limit ? (
        <button type="button" className="btn sm jl-more" onClick={onMore}>
          {t("journal.rowMore", { n: Math.min(ROW_LIMIT, total - limit) })}
        </button>
      ) : null}
      {footer}
    </div>
  );
}
