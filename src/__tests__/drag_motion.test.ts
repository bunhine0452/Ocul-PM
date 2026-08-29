/**
 * 끌리는 물체의 감쇠 — 터미널 세션 고스트가 손을 따라오는 산술.
 *
 * 프레임 루프 안에서만 쓰이므로 화면으로는 "어쩐지 이상하다" 밖에 안 남는다.
 * 여기서 못 박는 성질은 둘이다: 오버슈트가 없을 것, 반드시 손 밑에 앉을 것.
 */
import { describe, it, expect } from "vitest";
import { advanceGhost, GHOST_TILT_MAX } from "@/lib/dragMotion";

describe("고스트 감쇠", () => {
  it("목표를 지나치지 않는다 — 관성이 아니라 감쇠다", () => {
    let pose = { x: 0, y: 0, tilt: 0 };
    const target = { x: 100, y: 40 };
    for (let i = 0; i < 60; i += 1) {
      pose = advanceGhost(pose, target).pose;
      expect(pose.x).toBeLessThanOrEqual(target.x);
      expect(pose.y).toBeLessThanOrEqual(target.y);
    }
  });

  it("몇 프레임 안에 손 밑에 앉고, 앉으면 반듯해진다", () => {
    let pose = { x: 0, y: 0, tilt: 0 };
    const target = { x: 100, y: 40 };
    let frames = 0;
    let settled = false;
    while (!settled && frames < 120) {
      const step = advanceGhost(pose, target);
      pose = step.pose;
      settled = step.settled;
      frames += 1;
    }
    expect(settled).toBe(true);
    // 60fps 기준 반 초 안 — 이보다 늦으면 "따라온다"가 아니라 "느리다"가 된다.
    expect(frames).toBeLessThan(30);
    expect(pose).toEqual({ x: 100, y: 40, tilt: 0 });
  });

  it("기울기는 벌어진 거리에서 나오고 상한을 넘지 않는다", () => {
    let pose = { x: 0, y: 0, tilt: 0 };
    // 매 프레임 목표가 멀리 달아나는 상황 — 지연이 계속 크게 유지된다.
    for (let i = 0; i < 40; i += 1) {
      pose = advanceGhost(pose, { x: i * 200, y: 0 }).pose;
      expect(Math.abs(pose.tilt)).toBeLessThanOrEqual(GHOST_TILT_MAX);
    }
    expect(pose.tilt).toBeGreaterThan(0);
  });

  it("목표가 이미 손 밑이면 첫 프레임에 앉는다", () => {
    const step = advanceGhost({ x: 10, y: 10, tilt: 0 }, { x: 10, y: 10 });
    expect(step.settled).toBe(true);
  });
});
