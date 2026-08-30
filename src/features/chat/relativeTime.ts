// PR-ACP8 — 목록용 짧은 상대 시각 ("17m" · "2h" · "3d").
//
// 구현은 `lib/format.relativeTime` 의 compact 모드로 합쳤다 (Phase 4). 이 파일은
// `null` 반환 계약(파싱 실패는 자리를 비운다)을 지키는 얇은 겉면이다.
import { relativeTime as format, toEpochMs } from "@/lib/format";

/**
 * ISO 8601 문자열을 짧은 상대 시각으로. 파싱 실패는 `null` — 화면에서 그 자리를
 * 비우는 편이 "Invalid Date" 를 보여 주는 것보다 낫다. `now` 를 인자로 받는 건
 * 목록 전체가 **같은 기준**으로 계산돼야 렌더 도중 순서가 흔들리지 않아서다.
 */
export function relativeTime(iso: string | null | undefined, now: number): string | null {
  if (toEpochMs(iso) == null) return null;
  return format(iso, now, { style: "compact" });
}
