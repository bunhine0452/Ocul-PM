import { t } from "@/i18n";

// 표시용 포매터 — 여섯 군데의 relativeTime 과 세 군데의 formatBytes 를 하나로
// (완성도 라운드 Phase 4 #bus-and-helpers). 같은 임계값·같은 사전 키(`time.*`).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface RelativeTimeOptions {
  /** `words` = "3시간 전"(i18n), `compact` = "3h"(목록·배지). */
  style?: "words" | "compact";
  /** 파싱 실패·없음일 때 돌려줄 값. */
  fallback?: string;
  /** 이 일수 이상 지났으면 상대 시각 대신 날짜(`toLocaleDateString`). */
  beyondDays?: number;
}

/** ISO 문자열·unix ms·unix 초(1e11 미만) 를 ms 로. 실패는 `null`. */
export function toEpochMs(at: string | number | null | undefined): number | null {
  if (at == null || at === "") return null;
  if (typeof at === "number") return Number.isFinite(at) ? (at > 1e11 ? at : at * 1000) : null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 상대 시각. `now` 를 인자로 받는 이유는 목록 전체가 **같은 기준**으로 계산돼야
 * 렌더 도중 분이 넘어가며 순서가 흔들리지 않기 때문이다. 미래로 찍힌 값은
 * "방금" 으로 눕힌다 (음수 표기는 버그로 읽힌다).
 */
export function relativeTime(
  at: string | number | null | undefined,
  now: number,
  opts: RelativeTimeOptions = {},
): string {
  const ms = toEpochMs(at);
  if (ms == null) return opts.fallback ?? "";
  const diff = Math.max(0, now - ms);
  const style = opts.style ?? "words";
  if (opts.beyondDays != null && diff >= opts.beyondDays * DAY) {
    return new Date(ms).toLocaleDateString();
  }
  if (style === "compact") {
    if (diff < MINUTE) return "now";
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
    if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
    return `${Math.floor(diff / DAY)}d`;
  }
  if (diff < MINUTE) return t("time.justNow");
  if (diff < HOUR) return t("time.minutesAgo", { n: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t("time.hoursAgo", { n: Math.floor(diff / HOUR) });
  return t("time.daysAgo", { n: Math.floor(diff / DAY) });
}

/** 사람 눈에 맞는 파일 크기 — B / KB / MB, 소수 한 자리. 없으면 `fallback`. */
export function formatBytes(n: number | null | undefined, fallback = "—"): string {
  if (n == null || !Number.isFinite(n)) return fallback;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
