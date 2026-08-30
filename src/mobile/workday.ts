// 모바일 셸의 workday 헬퍼 (#mb3-screens).
//
// oculpm 의 workday 는 "YYYYMMDD" (OS 로컬). 데스크톱 useJournalDays 는
// WorkspaceContext 에 묶여 있어, 폰에서는 이 순수 헬퍼 셋만 쓴다.

import { localWorkdayKey, shiftWorkday as shift } from "@/lib/workday";

export function todayWorkday(now: Date = new Date()): string {
  return localWorkdayKey(now);
}

export const shiftWorkday = shift;

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
