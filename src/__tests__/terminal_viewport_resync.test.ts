/**
 * 숨었다 돌아온 터미널의 뷰포트 되맞춤 (2026-08-20).
 *
 * 오른쪽 도크에서 에이전트를 돌려 두고 다른 프로젝트 탭에 갔다 오면 화면이
 * 출력을 못 따라와 잘린 채 굳었다. 근거는 `viewportResync.ts` 주석에 있다 —
 * 여기서는 두 조각만 못박는다.
 *
 *  1) 판정 — "같은 크기로 돌아온" 경우를 놓치지 않는가 (리사이즈가 안 일어나
 *     `ResizeObserver` 로는 못 잡던 바로 그 경로)
 *  2) 되맞춤 — Viewport 가 `syncScrollArea()` 를 돌게 만드는 자극을 실제로
 *     주는가, 그리고 버퍼(스크롤백 한도)를 원래대로 되돌려 놓는가
 */
import { describe, it, expect } from "vitest";

import {
  nextRevealState,
  resyncViewport,
  type ResyncTarget,
} from "@/features/terminal/viewportResync";

const entry = (isIntersecting: boolean) =>
  ({ isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }) as IntersectionObserverEntry;

describe("다시 보임 판정", () => {
  it("숨었다 보이면 되맞춤 대상", () => {
    expect(nextRevealState(false, entry(true))).toEqual({ visible: true, revealed: true });
  });

  it("계속 보이는 중이면 아무것도 하지 않는다", () => {
    expect(nextRevealState(true, entry(true))).toEqual({ visible: true, revealed: false });
  });

  it("숨는 순간은 되맞춤이 아니라 상태만 내린다", () => {
    expect(nextRevealState(true, entry(false))).toEqual({ visible: false, revealed: false });
  });

  it("isIntersecting 이 없는 구현에서는 비율로 판정한다", () => {
    const ratioOnly = { intersectionRatio: 0.4 } as IntersectionObserverEntry;
    expect(nextRevealState(false, ratioOnly)).toEqual({ visible: true, revealed: true });
  });
});

/** `options.scrollback` 대입 순서를 그대로 기록하는 가짜 터미널. */
function fakeTerm(scrollback: number | undefined, rows = 24) {
  const writes: number[] = [];
  const refreshed: [number, number][] = [];
  const options = {
    get scrollback() {
      return scrollback;
    },
    set scrollback(v: number | undefined) {
      scrollback = v;
      if (v !== undefined) writes.push(v);
    },
  };
  const term = {
    options,
    rows,
    refresh: (start: number, end: number) => refreshed.push([start, end]),
  } as unknown as ResyncTarget;
  return { term, writes, refreshed, current: () => scrollback };
}

describe("뷰포트 되맞춤", () => {
  it("scrollback 을 한 칸 올렸다 되돌려 Viewport 를 다시 계산시킨다", () => {
    const f = fakeTerm(3000);
    resyncViewport(f.term);
    // 두 번의 변화가 있어야 onSpecificOptionChange 가 실제로 발화한다 —
    // 같은 값을 다시 넣는 것만으로는 아무 일도 일어나지 않는다.
    expect(f.writes).toEqual([3001, 3000]);
  });

  it("스크롤백 한도를 원래대로 돌려놓는다 (버퍼를 깎지 않는다)", () => {
    const f = fakeTerm(500);
    resyncViewport(f.term);
    expect(f.current()).toBe(500);
  });

  it("scrollback 이 보고되지 않으면 xterm 기본값으로 되돌린다", () => {
    const f = fakeTerm(undefined);
    resyncViewport(f.term);
    expect(f.writes).toEqual([1001, 1000]);
    expect(f.current()).toBe(1000);
  });

  it("멈춰 있던 렌더를 한 번 다시 그린다", () => {
    const f = fakeTerm(1000, 30);
    resyncViewport(f.term);
    expect(f.refreshed).toEqual([[0, 29]]);
  });

  it("행이 0 이어도 음수 범위를 넘기지 않는다", () => {
    const f = fakeTerm(1000, 0);
    resyncViewport(f.term);
    expect(f.refreshed).toEqual([[0, 0]]);
  });
});
