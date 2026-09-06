// 스레드 스크롤 — 따라가기·"맨 아래로"·다시 보일 때 바닥 되잡기.
//
// `AcpConversation.tsx` 에서 갈라 나온 조각이다 (v3-surface {#acp-split}).
// 순수 이동이며 동작 변경은 없다.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * "바닥에 있다"로 볼 여유 (px).
 *
 * 정확히 0 을 요구하면 안 된다 — 글이 흐르는 동안 마지막 줄이 자라면서 몇 px
 * 씩 어긋나고, 그때마다 따라가기가 꺼져 버린다.
 */
export const STICK_SLACK_PX = 64;

/**
 * 스트리밍 중에는 맨 아래를 따라간다 — **사용자가 바닥에 있을 때만.**
 *
 * 예전에는 턴이 바뀔 때마다 무조건 바닥으로 끌어내렸다. 그래서 답이 흐르는
 * 동안 위로 올려 앞의 도구 카드를 읽는 것이 불가능했다 — 올리자마자 다시
 * 내려갔다. 바닥 근처에 있었으면 따라가고, 일부러 올라가 있으면 그 자리를
 * 지킨다 (다시 바닥까지 내리면 따라가기가 저절로 켜진다).
 *
 * 인자 둘은 "이것이 바뀌면 바닥을 다시 잡는다"의 재료다 (턴 목록·승인 카드).
 */
export function useThreadScroll(turns: unknown, permission: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  /** 바닥에서 떨어져 있는가 — FAB("맨 아래로")를 보일지의 근거. */
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  const onThreadScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const stick = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK_PX;
    stickRef.current = stick;
    // FAB 의 근거 — ref 와 달리 화면이 알아야 하는 값이라 상태로도 든다.
    setAwayFromBottom(!stick);
  }, []);

  /** "맨 아래로" — 위에서 읽다 돌아오는 한 번의 길. 누르면 따라가기도 다시 켜진다. */
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setAwayFromBottom(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  /**
   * "이제부터 바닥이 관심사다" — 대화를 옮기거나 말을 걸 때.
   *
   * 스크롤을 당장 움직이지는 않는다. 아래의 layout effect 와 ResizeObserver 가
   * 다음 그림에서 알아서 잡는다 — 여기서 직접 움직이면 아직 안 그려진 내용의
   * 높이를 기준으로 잡게 된다.
   */
  const followBottom = useCallback(() => {
    stickRef.current = true;
    setAwayFromBottom(false);
  }, []);

  /**
   * 스크롤러를 붙잡는 ref — 크기 변화도 함께 듣는다.
   *
   * 이 화면은 keep-alive 라 다른 화면에 가 있는 동안에도 글이 쌓이는데, 그때는
   * `display:none` 이라 레이아웃이 없어 `scrollTop` 을 써도 0 에 머문다. 돌아오면
   * 맨 위가 보였다. 크기가 0 → 실제로 돌아오는 순간이 곧 "다시 보인다"라서,
   * 그때 바닥을 다시 잡는다.
   */
  const threadResizeRef = useRef<ResizeObserver | null>(null);
  const attachThread = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    threadResizeRef.current?.disconnect();
    threadResizeRef.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current && el.clientHeight > 0) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    threadResizeRef.current = observer;
  }, []);
  useEffect(() => () => threadResizeRef.current?.disconnect(), []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [turns, permission]);

  return { attachThread, onThreadScroll, jumpToBottom, followBottom, awayFromBottom };
}
