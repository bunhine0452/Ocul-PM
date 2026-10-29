/**
 * 「이 세션을 보여 줘」 — 오늘의 「Claude 가 기다려요」 줄이 터미널 탭의 특정 세션을 고르게 한다.
 *
 * 터미널 화면은 늦게 실리는 덩어리(xterm)라 요청이 화면보다 먼저 올 수 있다 — 받아 둔 id 를
 * 화면이 설 때 꺼내고, 이미 서 있으면 사건으로 바로 받는다. xterm 을 들이지 않는다.
 */
const EVENT = "ocul:term-focus";
let pending: number | null = null;

export function requestTermFocus(id: number): void {
  pending = id;
  window.dispatchEvent(new CustomEvent<number>(EVENT, { detail: id }));
}

/** 받아 둔 요청을 꺼낸다 — 한 번만. */
export function takeTermFocus(): number | null {
  const id = pending;
  pending = null;
  return id;
}

export function onTermFocus(fn: (id: number) => void): () => void {
  const handler = () => {
    const id = takeTermFocus();
    if (id != null) fn(id);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
