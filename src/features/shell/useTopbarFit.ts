/**
 * 윗줄 접기 단계 — 폭 숫자가 아니라 **실제로 들어가는지**로 정한다 (11-04).
 *
 * 화면마다 윗줄의 「화면 동작」 폭이 다르다 — 작업 일지는 「+ 새 일지」 86px, 터미널은 「+ 새 세션 ⌘T · 나란히 ·
 * 위아래 · 여럿에서」 283px. 640 · 780 · 900 같은 @media 선 하나로는 한쪽에 맞추면 다른 쪽이 깨졌다: 터미널 창
 * 800 에서 프로젝트 이름이 0px 로 짓눌렸고, 그 아래에서는 「새 세션 ⌘T」 가 잘렸다(사용자 스크린숏 11-04).
 *
 * 그래서 단계를 하나씩 올린다 — 들어가지 않으면 다음 단계, 앞 단계가 다시 들어갈 자리가 생기면 내린다.
 *   0  전부
 *   1  단축키 표시(⌘T · ⌘K)를 감추고 찾기는 돋보기
 *   2  탭 이름을 아이콘으로
 *   3  화면 동작을 「⋯」 메뉴로
 * 「들어간다」 는 프로젝트 이름이 제 폭(길면 NAME_GOAL)을 받고도 줄이 넘치지 않는다는 뜻이다.
 * 단계마다 잰 필요 폭을 기억해 두고 내릴 때 쓴다. 화면 동작의 내용이 바뀌면(화면 전환) 처음부터 다시 잰다.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export const FIT_MAX = 3;
/** 이름이 길면 이만큼은 보여야 들어갔다고 본다 — 그 뒤는 … 로 준다. */
const NAME_GOAL = 140;
/** 내릴 때의 여유 — 경계에서 단계가 오락가락하지 않게. */
const SLACK = 12;

/** 지금 단계에서 이 줄이 넘치지 않으려면 필요한 폭. */
export function neededWidth(bar: HTMLElement): number {
  const cs = getComputedStyle(bar);
  const gap = parseFloat(cs.columnGap) || 0;
  let sum = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  let shown = 0;
  for (const child of Array.from(bar.children) as HTMLElement[]) {
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
  return sum + gap * Math.max(0, shown - 1);
}

export function useTopbarFit(bar: RefObject<HTMLElement | null>, slot: RefObject<HTMLElement | null>): number {
  const [fit, setFit] = useState(0);
  /** 내용이 바뀐 횟수 — 단계가 이미 0 이어도 다시 재게 한다. */
  const [epoch, setEpoch] = useState(0);
  const need = useRef<number[]>([]);
  const fitRef = useRef(0);
  fitRef.current = fit;

  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const check = () => {
      const avail = el.clientWidth;
      if (!avail) return; // 아직 그려지지 않았다(테스트의 jsdom 도 여기서 멈춘다)
      const f = fitRef.current;
      const n = neededWidth(el);
      need.current[f] = n;
      if (n > avail + 0.5 && f < FIT_MAX) setFit(f + 1);
      else if (f > 0 && need.current[f - 1] != null && need.current[f - 1] + SLACK <= avail) setFit(f - 1);
    };
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bar, fit, epoch]);

  // 화면 동작의 내용이 바뀌면 단계별 필요 폭이 달라진다 — 처음부터 다시 잰다. CSS 로 감추는 것(⌘T)은
  // 내용이 아니라 바뀌지 않는다(바뀌면 단계 ↔ 내용이 서로를 다시 부른다).
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el || typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() => {
      need.current = [];
      setFit(0);
      setEpoch((e) => e + 1);
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [slot]);

  return fit;
}
