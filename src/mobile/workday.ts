// 모바일 셸의 workday 헬퍼 (#mb3-screens).
//
// oculpm 의 workday 는 "YYYYMMDD" (OS 로컬). 데스크톱 useJournalDays 는
// WorkspaceContext 에 묶여 있어, 폰에서는 이 순수 헬퍼 셋만 쓴다.

export function todayWorkday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function shiftWorkday(workday: string, delta: number): string {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6)) - 1;
  const d = Number(workday.slice(6, 8));
  const date = new Date(y, m, d);
  date.setDate(date.getDate() + delta);
  return todayWorkday(date);
}

/** "20260824" → "8/24 (일)" 표시용. locale 은 브라우저 설정을 따른다. */
export function workdayLabel(workday: string, locale?: string): string {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6)) - 1;
  const d = Number(workday.slice(6, 8));
  return new Date(y, m, d).toLocaleDateString(locale, {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}
