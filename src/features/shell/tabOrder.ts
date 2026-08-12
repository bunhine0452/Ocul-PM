/**
 * 탭 스트립의 순수 계산 — 드래그 순서 변경의 산술만 떼어냈다.
 * DOM·포인터 이벤트 없이 단위 테스트할 수 있어야 경계 버그가 안 남는다.
 */

/**
 * 포인터 x 가 놓일 **삽입 인덱스** (0..centers.length).
 *
 * `centers` 는 탭들의 중심 x 좌표를 화면 순서대로 담는다. 중심을 기준으로
 * 하면 탭 폭이 서로 달라도(이름 길이가 다르다) 사람이 기대하는 지점에서
 * 자리가 바뀐다 — 가장자리 기준이면 넓은 탭 위에서 이상하게 늦게 바뀐다.
 */
export function tabDropIndex(centers: readonly number[], x: number): number {
  let i = 0;
  while (i < centers.length && x > centers[i]) i += 1;
  return i;
}

/**
 * `from` 위치의 탭을 **원본 좌표계의** `to` 앞으로 옮긴 새 배열.
 *
 * `to` 가 `from` 오른쪽이면 항목을 먼저 빼면서 인덱스가 하나 당겨지므로
 * 보정한다 — 이 보정을 빼먹으면 오른쪽으로 한 칸 옮기는 조작이 아무 일도
 * 하지 않는 것처럼 보인다(가장 흔한 재배열 버그).
 */
export function reorderTabs<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order];
  if (from < 0 || from >= next.length) return next;
  const [moved] = next.splice(from, 1);
  const clamped = Math.max(0, Math.min(next.length, to > from ? to - 1 : to));
  next.splice(clamped, 0, moved);
  return next;
}

/** 스트립 세로 범위를 이만큼 벗어나면 "떼어내기" 로 본다 (CSS px). */
export const DETACH_THRESHOLD_PX = 44;

/** 이 거리 전에는 클릭으로 본다 — 탭 클릭이 미세 떨림으로 드래그가 되면 안 된다. */
export const DRAG_START_PX = 4;

/**
 * 지금 포인터가 떼어내기 자세인가. 스트립 위/아래 어느 쪽으로 벗어나도
 * 성립하고, 가로로만 움직이는 동안에는 절대 성립하지 않는다.
 */
export function isDetachGesture(
  strip: { top: number; bottom: number },
  pointerY: number,
): boolean {
  return (
    pointerY < strip.top - DETACH_THRESHOLD_PX || pointerY > strip.bottom + DETACH_THRESHOLD_PX
  );
}
