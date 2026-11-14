/**
 * 윗줄 접기 — 폭 숫자가 아니라 **실제로 들어가는지**로 정한다 (11-04 → 11-15).
 *
 * 화면마다 윗줄의 「화면 동작」 폭이 다르다 — 작업 일지는 「+ 새 일지」 86px, 터미널은 「+ 새 세션 ⌘T · 나란히 ·
 * 위아래 · 여럿에서」 283px. 640 · 780 · 900 같은 @media 선 하나로는 한쪽에 맞추면 다른 쪽이 깨졌다(11-04).
 *
 * 11-15: 접기를 두 갈래로 나눴다. 예전엔 한 사다리(0 → 3)를 화면마다 0 부터 다시 쟀고, 단계 3 이 gap · 여백 ·
 * ▾ 까지 줄여서, 같은 창 폭에서도 화면을 바꾸면 탭 줄이 20px 옆으로 뛰고 ▾ 가 사라졌다. 이제
 *   - `fit`(0 · 1 · 2)은 **화면 동작을 뺀** 줄 — 프로젝트 · 탭 · 찾기 · 설정 — 만으로 정한다. 화면마다 같은
 *     값이라 탭은 화면을 바꿔도 그 자리 그 모양이다.
 *       0  전부
 *       1  단축키 표시(⌘T · ⌘K)를 감춘다
 *       2  탭 이름을 아이콘으로
 *   - `fold` 는 그 단계에서 화면 동작이 남은 자리에 안 들어가면 「⋯」 메뉴로 접는다. 접어도 탭은 그대로다.
 * 단계마다 줄을 잠깐 그 단계로 그려 보고(속성을 걸어 재고 곧바로 되돌린다) 고르므로, 내용이 바뀌어도
 * 지금 단계에서 다시 잴 뿐 0 으로 돌아가지 않는다 — 열린 ⋯ 가 화면 동작이 바뀔 때마다 닫히던 것도 그 탓이었다.
 * 「들어간다」 는 프로젝트 이름이 제 폭(길면 NAME_GOAL)을 받고도 줄이 넘치지 않는다는 뜻이다.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export const FIT_MAX = 2;
/** 이름이 길면 이만큼은 보여야 들어갔다고 본다 — 그 뒤는 … 로 준다. */
const NAME_GOAL = 140;
/** 내릴 때(단계를 낮추거나 접은 것을 펼 때)의 여유 — 경계에서 오락가락하지 않게. */
const SLACK = 12;

export interface TopbarFit {
  fit: number;
  fold: boolean;
}

/**
 * 지금 그려진 대로 이 줄이 넘치지 않으려면 필요한 폭. `skipActions` 면 화면 동작과 「⋯」 를 빼고, 대신 「⋯」
 * 한 칸(설정 톱니와 같은 크기)을 늘 잡아 둔다 — 화면에 동작이 있든 없든 같은 값이 나와야 단계가 같다.
 */
export function neededWidth(bar: HTMLElement, skipActions = false): number {
  const cs = getComputedStyle(bar);
  const gap = parseFloat(cs.columnGap) || 0;
  let sum = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  let shown = 0;
  for (const child of Array.from(bar.children) as HTMLElement[]) {
    if (skipActions && (child.classList.contains("topbar-actions") || child.classList.contains("topbar-more"))) continue;
    const style = getComputedStyle(child);
    if (style.display === "none" || style.position === "absolute") continue;
    shown += 1;
    if (child.classList.contains("topbar-fill")) {
      sum += parseFloat(style.minWidth) || 0;
    } else if (child.classList.contains("proj-switch-wrap")) {
      const name = child.querySelector<HTMLElement>(".proj-name");
      const box = child.getBoundingClientRect().width;
      const natural = name ? box - name.clientWidth + name.scrollWidth : box;
      const label = name ? name.scrollWidth : 0;
      sum += label > NAME_GOAL ? natural - label + NAME_GOAL : natural;
    } else {
      sum += Math.max(child.getBoundingClientRect().width, child.scrollWidth);
    }
  }
  if (skipActions) {
    const more = bar.querySelector<HTMLElement>(".topbar-settings")?.getBoundingClientRect().width ?? 0;
    sum += more + gap;
    shown += 1;
  }
  return sum + gap * Math.max(0, shown - 1);
}

/** 단계 — 가장 낮은, 들어가는 단계. 지금보다 낮추려면 SLACK 만큼 여유가 있어야 한다. */
export function decideFit(needs: readonly number[], avail: number, current: number): number {
  for (let stage = 0; stage < FIT_MAX; stage++) {
    const room = stage < current ? avail - SLACK : avail + 0.5;
    if (needs[stage] <= room) return stage;
  }
  return FIT_MAX;
}

/** 접기 — 화면 동작까지 펼친 줄이 안 들어가면 접는다. 접힌 것을 펴려면 SLACK 만큼 여유가 있어야 한다. */
export function decideFold(full: number, avail: number, folded: boolean): boolean {
  return folded ? full + SLACK > avail : full > avail + 0.5;
}

/** 줄을 잠깐 그 단계 · 접기로 그려 재고 되돌린다 — React 가 다음에 그리기 전이라 화면에는 안 보인다. */
function probe<T>(bar: HTMLElement, fit: number, fold: boolean, read: () => T): T {
  const was = { fit: bar.getAttribute("data-fit"), fold: bar.getAttribute("data-fold") };
  const set = (name: string, value: string | null) => (value == null ? bar.removeAttribute(name) : bar.setAttribute(name, value));
  set("data-fit", fit ? String(fit) : null);
  set("data-fold", fold ? "" : null);
  try {
    return read();
  } finally {
    set("data-fit", was.fit);
    set("data-fold", was.fold);
  }
}

export function useTopbarFit(bar: RefObject<HTMLElement | null>, slot: RefObject<HTMLElement | null>): TopbarFit {
  const [state, setState] = useState<TopbarFit>({ fit: 0, fold: false });
  const stateRef = useRef(state);
  stateRef.current = state;

  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const check = () => {
      const avail = el.clientWidth;
      if (!avail) return; // 아직 그려지지 않았다(테스트의 jsdom 도 여기서 멈춘다)
      const now = stateRef.current;
      const needs = [0, 1, 2].map((stage) => probe(el, stage, true, () => neededWidth(el, true)));
      const fit = decideFit(needs, avail, now.fit);
      const empty = !slot.current || slot.current.childElementCount === 0;
      const fold = empty ? false : decideFold(probe(el, fit, false, () => neededWidth(el)), avail, now.fold);
      if (fit !== now.fit || fold !== now.fold) setState({ fit, fold });
    };
    check();
    const observers: Array<{ disconnect: () => void }> = [];
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(check);
      ro.observe(el);
      observers.push(ro);
    }
    // 화면 동작의 내용이 바뀌면(화면 전환 · 단추 글자) 지금 단계에서 다시 잰다.
    if (slot.current && typeof MutationObserver !== "undefined") {
      const mo = new MutationObserver(check);
      mo.observe(slot.current, { childList: true, subtree: true, characterData: true });
      observers.push(mo);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, [bar, slot]);

  return state;
}
