/**
 * 작업일 키(`YYYYMMDD`)의 사람 말 — 앱 공통 표기: 오늘 · 어제 · 11월 4일 (11-15). `20261115` 원본은 사람이 읽는
 * 글이 아니다. ⌘K 의 일지 줄 · 시작 창의 날짜 칸 · 일지 목록의 날짜 머리가 같은 함수를 쓴다(시작 창은 오늘 · 어제에
 * 건수를, 일지 목록은 오늘 · 어제 뒤에 날짜를 붙인다). 올해가 아니면 연도를 붙인다 — 일지 목록이 따로 갖던 규칙을
 * 여기로 옮겼다(검색 · 「전체」 는 지난해의 일지까지 닿는다).
 * 키 산술은 `./workday` 가 갖는다 — 여기는 그 키를 말로 옮기기만 한다.
 */
import type { I18nKey, Lang, TVars } from "@/i18n";
import { localWorkdayKey, shiftWorkday } from "./workday";

type Tr = (key: I18nKey, vars?: TVars) => string;

/** 달력 날짜만 — 「11월 4일」 · 「November 4」, 올해(`today` 의 해)가 아니면 「2025년 11월 4일」. 키가 깨졌으면 빈 글자. */
export function workdayDate(workday: string, lang: Lang, today = localWorkdayKey()): string {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6));
  const d = Number(workday.slice(6, 8));
  if (!y || !m || !d) return "";
  const year = workday.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric";
  return new Date(y, m - 1, d).toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", { year, month: "long", day: "numeric" });
}

/** 오늘 · 어제 · 그 밖은 날짜. */
export function dayWord(workday: string, lang: Lang, t: Tr, today = localWorkdayKey()): string {
  if (workday === today) return t("journal.day.today");
  if (workday === shiftWorkday(today, -1)) return t("journal.day.yesterday");
  return workdayDate(workday, lang, today);
}
