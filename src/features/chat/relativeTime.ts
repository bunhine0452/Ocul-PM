// PR-ACP8 — 목록용 짧은 상대 시각 ("17m" · "2h" · "3d").
//
// 절대 시각(`2026-08-14 13:50`)은 한 줄을 통째로 먹으면서 정작 알고 싶은 것을
// 안 알려 준다 — 목록에서 필요한 건 "얼마나 오래됐나"이지 "몇 시였나"가 아니다.
// 상대 시각은 짧아서 제목과 같은 줄에 들어간다.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * ISO 8601 문자열을 짧은 상대 시각으로. 파싱 실패는 `null` — 화면에서 그 자리를
 * 비우는 편이 "Invalid Date" 를 보여 주는 것보다 낫다.
 *
 * `now` 를 인자로 받는 건 테스트 때문만이 아니다 — 목록 전체가 **같은 기준**
 * 으로 계산돼야 렌더 도중 분이 넘어가며 순서가 흔들리지 않는다.
 */
export function relativeTime(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;

  const diff = now - at;
  // 시계가 어긋나 미래로 찍힌 항목은 "방금"으로 눕힌다 (음수 표기는 버그로 읽힌다).
  if (diff < MINUTE) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  return `${Math.floor(diff / DAY)}d`;
}
