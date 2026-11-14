// 같은 날은 어디서나 같은 말 (11-15 합류 G-09) — 일지 목록의 날짜 머리가 ⌘K 의 일지 줄 · 시작 창과 같은 함수
// (`lib/workdayLabel`)로 선다. 예전엔 목록만 자기 방식(「11/13」 · 「2025-11-13」)이었고, 아무도 읽지 않는 ISO
// 이름표(「오늘 · 2026-05-31」)도 따로 만들었다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { JournalList } from "@/features/oculpm/JournalList";
import type { DayView } from "@/features/oculpm/journalOrder";
import { setLangSetting, t } from "@/i18n";
import { localWorkdayKey, shiftWorkday } from "@/lib/workday";
import { dayWord, workdayDate } from "@/lib/workdayLabel";

const today = localWorkdayKey();
const lastYear = String(Number(today.slice(0, 4)) - 1);
// 오늘 · 어제 · 지난주 어느 날 · 지난해 — ⌘K 가 일지를 찾아 줄 수 있는 날들.
const DAYS = [today, shiftWorkday(today, -1), shiftWorkday(today, -5), `${lastYear}1104`];

const view = (workday: string): DayView => ({ workday, count: 1, missing: 0, shown: [], folded: [], open: false });

function headings(): string[] {
  const { container } = render(
    <JournalList
      views={DAYS.map(view)}
      todayKey={today}
      selectedPath={null}
      onSelect={vi.fn()}
      onToggleDay={vi.fn()}
      listRef={{ current: null }}
      showAgent={false}
    />,
  );
  return DAYS.map((d) => container.querySelector(`#jl-day-${d}-name`)?.textContent ?? "");
}

afterEach(() => {
  cleanup();
  setLangSetting("ko");
});

describe("journal day headings speak the palette's date words", () => {
  it.each(["ko", "en"] as const)("%s", (lang) => {
    setLangSetting(lang);
    const [onToday, onYesterday, lastWeek, lastYearDay] = headings();
    // ⌘K 의 일지 줄은 `dayWord` 로 날을 부른다 — 날짜로 부르는 날은 글자까지 같다.
    expect(lastWeek).toBe(dayWord(DAYS[2], lang, t));
    expect(lastYearDay).toBe(dayWord(DAYS[3], lang, t));
    // 오늘 · 어제는 그 낱말 뒤에 같은 함수의 날짜.
    expect(onToday).toBe(`${dayWord(today, lang, t)} · ${workdayDate(today, lang)}`);
    expect(onYesterday).toBe(`${dayWord(DAYS[1], lang, t)} · ${workdayDate(DAYS[1], lang)}`);
    // 지난해의 날에는 연도가 붙고, 숫자만의 표기(2026-11-13 · 11/13)는 어디에도 없다.
    expect(lastYearDay).toContain(lastYear);
    for (const h of [onToday, onYesterday, lastWeek, lastYearDay]) expect(h).not.toMatch(/\d{4}-\d{2}-\d{2}|\d+\/\d+/);
  });
});
