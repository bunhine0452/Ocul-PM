/**
 * 작업일 키(`YYYYMMDD`)의 사람 말 — 앱 공통 표기: 오늘 · 어제 · 11월 4일 (11-15). `20261115` 원본은 사람이 읽는
 * 글이 아니다. ⌘K 의 일지 줄과 시작 창의 날짜 칸이 같은 함수를 쓴다(시작 창은 오늘 · 어제에 건수를 붙인다).
 * 키 산술은 `./workday` 가 갖는다 — 여기는 그 키를 말로 옮기기만 한다.
 */
import type { I18nKey, Lang, TVars } from "@/i18n";
import { localWorkdayKey, shiftWorkday } from "./workday";

type Tr = (key: I18nKey, vars?: TVars) => string;

/** 달력 날짜만 — 「11월 4일」 · 「November 4」. 키가 깨졌으면 빈 글자. */
export function workdayDate(workday: string, lang: Lang): string {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6));
  const d = Number(workday.slice(6, 8));
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", { month: "long", day: "numeric" });
}

/** 오늘 · 어제 · 그 밖은 날짜. */
export function dayWord(workday: string, lang: Lang, t: Tr, today = localWorkdayKey()): string {
  if (workday === today) return t("journal.day.today");
  if (workday === shiftWorkday(today, -1)) return t("journal.day.yesterday");
  return workdayDate(workday, lang);
}
