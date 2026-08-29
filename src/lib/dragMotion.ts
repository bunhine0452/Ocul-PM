/**
 * 끌리는 물체의 감쇠 — 터미널 세션 고스트와 창 탭 고스트가 **같은 손맛**을 쓴다.
 *
 * 원래는 터미널 안에만 있었다. 탭 떼어내기에도 고스트가 생기면서 값이 갈라질
 * 자리가 생겼는데, 두 물체가 다른 속도로 따라오면 같은 앱에서 손이 두 가지를
 * 배워야 한다 — 그래서 상수도 계산도 여기 하나로 둔다.
 *
 * 관성이 아니라 **감쇠**다: 매 프레임 남은 거리의 일부만 좁히므로 오버슈트가
 * 없고, 몇 프레임 안에 손 밑으로 정확히 들어와 앉는다.
 */

/** 매 프레임 좁히는 거리 비율. 1 이면 커서에 그대로 박히고, 낮을수록 늘어진다. */
export const GHOST_FOLLOW = 0.55;
/** 기울기 상한(도) — 이 이상 누우면 물체가 아니라 이펙트로 보인다. */
export const GHOST_TILT_MAX = 6;
/** 벌어진 가로 거리 1px 당 기울기(도). 기울기는 **지연에서 파생**한다. */
export const GHOST_TILT_PER_PX = 0.35;
/** 기울기 자체의 따라오기 비율 — 위치보다 느려야 흔들리지 않는다. */
export const GHOST_TILT_FOLLOW = 0.3;
/** 이만큼 가까우면 앉은 것으로 본다 (px / 도). */
export const GHOST_SETTLED_PX = 0.2;
export const GHOST_SETTLED_DEG = 0.05;

export interface GhostPose {
  x: number;
  y: number;
  tilt: number;
}

export const wantsReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 한 프레임만큼 목표에 다가간 자세.
 *
 * `settled` 면 좌표를 목표에 **정확히** 맞추고 기울기를 편다 — 부르는 쪽은 그때
 * 프레임을 놓으면 된다 (멈춘 물체를 60fps 로 다시 그릴 이유가 없다). 마지막
 * 프레임에서 스스로 반듯해지므로 "거의 다 왔는데 미세하게 기운 채 멎는" 자리가
 * 남지 않는다.
 */
export function advanceGhost(
  pose: GhostPose,
  target: { x: number; y: number },
): { pose: GhostPose; settled: boolean } {
  const x = pose.x + (target.x - pose.x) * GHOST_FOLLOW;
  const y = pose.y + (target.y - pose.y) * GHOST_FOLLOW;
  const lag = target.x - x;
  const want = Math.max(-GHOST_TILT_MAX, Math.min(GHOST_TILT_MAX, lag * GHOST_TILT_PER_PX));
  const tilt = pose.tilt + (want - pose.tilt) * GHOST_TILT_FOLLOW;
  const settled =
    Math.abs(target.x - x) < GHOST_SETTLED_PX &&
    Math.abs(target.y - y) < GHOST_SETTLED_PX &&
    Math.abs(tilt) < GHOST_SETTLED_DEG;
  if (settled) return { pose: { x: target.x, y: target.y, tilt: 0 }, settled: true };
  return { pose: { x, y, tilt }, settled: false };
}

/** 고스트의 `transform` 문자열 — 좌표는 소수 한 자리면 충분하다(서브픽셀). */
export function ghostTransform(pose: GhostPose): string {
  return (
    `translate3d(${pose.x.toFixed(1)}px, ${pose.y.toFixed(1)}px, 0)` +
    ` rotate(${pose.tilt.toFixed(2)}deg)`
  );
}
