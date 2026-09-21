/**
 * 「새 일지」 토스트의 문지기 (2026-09-22).
 *
 * 워처의 JournalAdded 는 "캐시에 새 행" 이지 "사용자에게 새 소식" 이 아니다.
 * 백엔드가 `created_at` 으로 재출현(git 체크아웃이 폴더째 되살린 옛 일지)을
 * 갈라 조용한 갱신으로 내보내지만, 프론트에도 같은 문지기를 둔다 — 옛 빌드의
 * 워처와 섞여 돌 때, 그리고 **정당한 폭주**(백필·에이전트 여럿이 동시에 기록)
 * 를 한 장으로 접기 위해서다. 18장이 쌓인 토스트 더미는 알림이 아니라 벽이다.
 *
 * 순수 함수 — 시계와 최근 표시 시각 목록을 인자로 받는다.
 */

/** 이보다 오래된 `created_at` 은 새 소식이 아니다 (백엔드의 창과 같은 값). */
export const FRESH_ENTRY_WINDOW_MS = 30 * 60_000;
/** 이 창 안에 이미 이만큼 띄웠으면 다음 것부터 한 장으로 접는다. */
export const BURST_WINDOW_MS = 5_000;
export const BURST_THRESHOLD = 3;

export type EntryToastDecision = "show" | "fold" | "skip";

/**
 * @param createdAt 프론트매터 `created_at` (RFC3339). 못 읽으면 새것으로 본다.
 * @param now `Date.now()`.
 * @param recentShows 최근에 실제로 띄운 시각들 — **이 함수가 제자리에서 정리한다**
 *   (창 밖은 버린다). 호출자는 `show` 를 받으면 `now` 를 여기에 밀어 넣는다.
 */
export function decideEntryToast(
  createdAt: string,
  now: number,
  recentShows: number[],
): EntryToastDecision {
  const created = Date.parse(createdAt);
  if (!Number.isNaN(created) && now - created > FRESH_ENTRY_WINDOW_MS) return "skip";
  // 창 밖의 표시는 잊는다 — 제자리 정리라 호출자의 배열이 곧 상태다.
  let keep = 0;
  for (const t of recentShows) if (now - t <= BURST_WINDOW_MS) recentShows[keep++] = t;
  recentShows.length = keep;
  return recentShows.length >= BURST_THRESHOLD ? "fold" : "show";
}
