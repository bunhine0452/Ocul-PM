// PR-ACP12 — 사용량 위젯 열기 신호.
//
// 컴포저(`/usage` 입력·버튼)와 툴바 위젯은 형제 컴포넌트라 서로를 직접 부를
// 수 없다. 상태를 WorkspaceContext 로 올리는 방법도 있지만, 이건 **영속할
// 값이 아니라 한 번 스치는 사건**이다 — 상태로 만들면 "열림"이 저장돼 다음
// 진입 때 뜬금없이 열려 있다.

type Listener = () => void;

const listeners = new Set<Listener>();

/** 위젯을 열어 달라고 알린다 (듣는 이가 없으면 조용히 사라진다). */
export function requestUsagePanel(): void {
  for (const listener of [...listeners]) listener();
}

/** 구독. 반환값을 부르면 해지된다 (effect cleanup 에 그대로 쓴다). */
export function onUsagePanel(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
