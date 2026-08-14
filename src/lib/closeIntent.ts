// ⌘W 의 "안쪽부터 닫기" 사슬.
//
// 브라우저에서 ⌘W 는 늘 **가장 안쪽에 열린 것**을 닫는다. 우리 창도 그렇게
// 겹쳐 있다: 창 → 프로젝트 탭 → (Claude Code 화면이면) 세션 탭. 어느 것이
// 열려 있는지는 화면만 알기 때문에, Rust 가 곧장 탭을 닫는 대신 이 사슬에
// 먼저 묻는다.
//
// 나중에 등록한 것이 먼저 답한다 — 나중에 열린 것이 더 안쪽이라는 뜻이다.

/** 닫을 것이 있었으면 `true` (소비). 없으면 `false` — 다음 차례로 넘어간다. */
type CloseHandler = () => boolean;

const handlers: CloseHandler[] = [];

/** 사슬에 넣는다. 반환값을 부르면 빠진다 (effect cleanup 에 그대로 쓴다). */
export function registerCloseHandler(handler: CloseHandler): () => void {
  handlers.push(handler);
  return () => {
    const at = handlers.lastIndexOf(handler);
    if (at !== -1) handlers.splice(at, 1);
  };
}

/**
 * 안쪽부터 물어본다. 아무도 안 받으면 `false` — 부르는 쪽이 탭을 닫는다.
 *
 * 사본을 뒤집어 도는 이유: 처리기가 자기 자신을 빼는 경우가 있어(마지막 세션
 * 탭을 닫으면 더 닫을 것이 없어진다) 원본을 순회하면 건너뛰게 된다.
 */
export function runCloseIntent(): boolean {
  for (const handler of [...handlers].reverse()) {
    if (handler()) return true;
  }
  return false;
}
