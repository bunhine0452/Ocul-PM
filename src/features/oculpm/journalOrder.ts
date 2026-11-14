import type { JournalEntrySummary } from "@/lib/bindings";
import type { JournalDay } from "./useJournalDays";

/** 한 번에 그리는 행 수 — 하루 60건을 쓰는 사용자에게도 마운트 수가 건수에 비례하지 않게 한다. */
export const ROW_LIMIT = 150;

/** 날 하나가 화면에 서는 모양. */
export interface DayView {
  workday: string;
  /** 그날 건수(접힌 것 포함, 상한에 잘리기 전). */
  count: number;
  /** 그날 검증 없음 수 — 날짜 머리의 warn 숫자. */
  missing: number;
  /** 목록에 바로 서는 줄. */
  shown: JournalEntrySummary[];
  /** 사라진 코드의 일지 — 그날 끝에 한 줄로 접힌다. */
  folded: JournalEntrySummary[];
  /** 접힘이 열려 있는가 — 사람이 연 날만 열린다. */
  open: boolean;
}

export interface VisibleOrder {
  views: DayView[];
  /** 화면에 보이는 순서 그대로의 줄 — j/k · ↑↓ · 자동 선택이 이 배열을 따른다. 닫힌 접힘 안은 없다. */
  order: JournalEntrySummary[];
  /** 그린 줄(상한 안) 수. */
  drawn: number;
  /** 상한에 잘리기 전 전체 줄 수. */
  total: number;
}

/**
 * 화면 순서 하나 (11-15) — 그리기 · j/k 이동 · 자동 선택이 같은 이 함수를 지난다.
 *
 * 예전엔 j/k 가 날짜 묶음의 원래 순서(사라진 코드의 일지가 섞여 있는)를 따랐다. 그래서 선택이 접힘
 * 안팎을 지그재그로 오갔고, 「고른 것이 접힌 쪽이면 펴 둔다」 가 접힘을 저절로 열었다 닫았다. 이제
 * 접힘의 열림은 사람이 연 날(`opened`)로만 정하고, 닫힌 접힘 안의 줄은 순서에 없다.
 *
 * `gone` 이 없으면 접지 않는다(찾거나 거르는 중). 전부가 사라진 코드의 일지면 접지 않는다 — 날짜 머리만
 * 남은 목록은 목록이 아니다. `isMissing` 은 날짜 머리의 수를 센다(화면이 읽음을 먼저 반영한 판정을 준다).
 */
export function visibleOrder(
  days: readonly JournalDay[],
  gone: ReadonlySet<string> | undefined,
  opened: ReadonlySet<string>,
  limit: number,
  isMissing: (e: JournalEntrySummary) => boolean,
): VisibleOrder {
  const fold = gone != null && gone.size > 0 && days.some((d) => d.entries.some((e) => !gone.has(e.relative_path)));
  const views: DayView[] = [];
  const order: JournalEntrySummary[] = [];
  let drawn = 0;
  let total = 0;
  for (const day of days) {
    total += day.entries.length;
    if (drawn >= limit) continue;
    const rows = day.entries.slice(0, limit - drawn);
    drawn += rows.length;
    const folded = fold ? rows.filter((e) => gone.has(e.relative_path)) : [];
    const shown = fold ? rows.filter((e) => !gone.has(e.relative_path)) : rows;
    const open = folded.length > 0 && opened.has(day.workday);
    views.push({
      workday: day.workday,
      count: day.entries.length,
      missing: day.entries.filter(isMissing).length,
      shown,
      folded,
      open,
    });
    order.push(...shown);
    if (open) order.push(...folded);
  }
  return { views, order, drawn, total };
}

/** 이 일지가 어느 날의 접힘 안에 있는가 — 밖에서 건너와 고르면 그날 접힘을 연다. */
export function foldedDayOf(views: readonly DayView[], path: string): string | null {
  for (const v of views) {
    if (v.folded.some((e) => e.relative_path === path)) return v.workday;
  }
  return null;
}
