/**
 * 시각 한 줄 — 오늘 화면과 계획 화면이 판정·일지 시각을 같은 모양으로 말한다.
 *
 * 오늘이면 `14:12`, 어제면 `어제 22:40`, 그 전이면 `10월 26일 09:03`. 「N분 전」 같은
 * 상대 시각(`lib/format.relativeTime`)이 아니라 벽시계다 — 판정이 **언제** 났는지가
 * 다음 결정의 재료라서다.
 */

import { getLang, t } from "@/i18n";

/** ISO 시각 → 로컬 `HH:MM`. 못 읽으면 빈 문자열. */
export function clockOf(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function whenLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const at = new Date(ms);
  const time = clockOf(iso);
  const today = new Date(now);
  if (sameDay(at, today)) return time;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(at, yesterday)) return t("time.yesterdayAt", { time });
  const date = new Intl.DateTimeFormat(getLang(), { month: "short", day: "numeric" }).format(at);
  return `${date} ${time}`;
}
