/**
 * ⌘K 팔레트를 화면 트리 밖에서 연다 — 툴바의 「찾기」 버튼이 쏘고, 팔레트를 가진
 * 프로젝트 창(`windows/ProjectWindow`)이 듣는다. 키보드로는 ⌘K 가 같은 일을 한다.
 */
const EVENT = "oculpm:open-palette";

export function requestOpenPalette(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function onOpenPaletteRequest(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
