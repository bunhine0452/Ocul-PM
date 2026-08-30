// 워크데이 키(`YYYYMMDD`) 산술 — 세 군데(Today·일지·모바일)가 같은 함수를 각자
// 들고 있었다 (완성도 라운드 Phase 4). **오늘이 무엇인지는 여기서 정하지
// 않는다** — 그것은 프로젝트 tz·`day_starts_at` 을 아는 백엔드의
// `OculpmStatus.current_workday` / `oculpm_current_workday` 다. 여기는 그 키를
// 앞뒤로 옮기는 달력 산술뿐이다.

export function isWorkdayKey(s: string | null | undefined): s is string {
  return typeof s === "string" && /^\d{8}$/.test(s);
}

/** `Date` → 로컬 달력의 `YYYYMMDD`. 백엔드 키가 없을 때(모바일)만 쓴다. */
export function localWorkdayKey(date = new Date()): string {
  const yy = date.getFullYear().toString().padStart(4, "0");
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/** 키를 `delta` 일만큼 옮긴다 — 월말·윤년은 `Date` 가 넘긴다. */
export function shiftWorkday(workday: string, delta: number): string {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6)) - 1;
  const d = Number(workday.slice(6, 8));
  const dt = new Date(y, m, d);
  dt.setDate(dt.getDate() + delta);
  return localWorkdayKey(dt);
}

/** 오늘부터 거꾸로 `n` 개, 오래된 것이 앞. */
export function recentWorkdays(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftWorkday(today, -(n - 1 - i)));
}
