/**
 * 윗줄까지 가지 않고 화면을 오가기 (ocul-next #nav-cycle).
 *
 * - ⌃Tab / ⌃⇧Tab — 다섯 화면을 차례로(설정에서는 첫 화면 · 끝 화면으로). 브라우저 탭 순환과 같은
 *   손이다. 캡처 단계에서 받는다 — 터미널(xterm)이 Tab 을 먼저 먹지 않게. 모달이 열려 있으면 둔다.
 * - 트랙패드 두 손가락 가로 쓸기 — 화면 뒤로/앞으로(`useNavHistory`, ⌘[ / ⌘] 와 같다). 가로로
 *   굴릴 수 있는 칸(긴 diff 줄 · 표) 안이나 터미널 위에서는 그 칸의 몫이라 보지 않는다.
 */
import { useEffect } from "react";

import type { UiV2View } from "@/contexts/uiV2View";
import { NAV_ENTRIES } from "@/lib/navRegistry";

/** 다음(1) · 앞(-1) 화면. 다섯 화면 밖(설정)이면 첫 화면 · 끝 화면. */
export function nextScreen(current: UiV2View, dir: 1 | -1): UiV2View {
  const ids = NAV_ENTRIES.map((e) => e.id);
  const at = ids.indexOf(current);
  if (at < 0) return dir === 1 ? ids[0] : ids[ids.length - 1];
  return ids[(at + dir + ids.length) % ids.length];
}

export function useScreenCycle(current: UiV2View, setView: (v: UiV2View) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      setView(nextScreen(current, e.shiftKey ? -1 : 1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [current, setView, enabled]);
}

/** 한 몸짓으로 볼 가로 이동 — 이만큼 모이면 넘긴다. */
export const SWIPE_PX = 140;
/** 바퀴 사건 사이가 이만큼 벌어지면 새 몸짓이다. */
const GAP_MS = 180;
/** 넘긴 뒤 관성 바퀴가 그칠 때까지 — 한 번 쓸어 두 화면을 넘지 않게. */
const LOCK_MS = 450;

export interface WheelSample {
  dx: number;
  dy: number;
  /** 핀치(⌃ + 바퀴) — 확대다, 쓸기가 아니다. */
  pinch: boolean;
  /** 가로로 굴릴 수 있는 칸 · 터미널 위 — 그 칸의 몫. */
  sideways: boolean;
  now: number;
}

/** 바퀴 사건을 모아 「뒤로 · 앞으로」를 가른다. 손가락이 오른쪽으로(내용이 왼쪽으로 굴러 dx<0) = 뒤로. */
export class SwipeTracker {
  private acc = 0;
  private last = -Infinity;
  private lockedUntil = -Infinity;

  feed(s: WheelSample): "back" | "forward" | null {
    if (s.now - this.last > GAP_MS) this.acc = 0;
    this.last = s.now;
    if (s.now < this.lockedUntil) {
      this.lockedUntil = s.now + LOCK_MS;
      return null;
    }
    if (s.pinch || s.sideways || Math.abs(s.dx) <= Math.abs(s.dy) * 1.5) {
      this.acc = 0;
      return null;
    }
    this.acc += s.dx;
    if (Math.abs(this.acc) < SWIPE_PX) return null;
    const dir = this.acc < 0 ? "back" : "forward";
    this.acc = 0;
    this.lockedUntil = s.now + LOCK_MS;
    return dir;
  }
}

/** 사건 자리에서 위로 — 터미널이거나 가로로 굴릴 수 있는 칸이 있으면 참. */
function scrollsSideways(target: EventTarget | null): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (el.classList.contains("xterm")) return true;
    if (el.scrollWidth > el.clientWidth && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

export function useSwipeNav(onBack: () => void, onForward: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const tracker = new SwipeTracker();
    const onWheel = (e: WheelEvent) => {
      const dir = tracker.feed({
        dx: e.deltaX,
        dy: e.deltaY,
        pinch: e.ctrlKey,
        sideways: e.deltaX !== 0 && scrollsSideways(e.target),
        now: performance.now(),
      });
      if (dir === "back") onBack();
      else if (dir === "forward") onForward();
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [onBack, onForward, enabled]);
}
