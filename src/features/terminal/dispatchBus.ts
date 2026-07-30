// IN2 (#in2-dispatch) — 플래너 → 터미널 프리필 핸드오프. 모듈 싱글턴 1칸,
// 1회 소비, 영속 없음 (새로고침에 살아남을 이유가 없는 순간 상태라
// WorkspaceContext/localStorage 대상이 아니다).

let pending: string | null = null;

export function setPendingDispatch(command: string): void {
  pending = command;
}

/** 대기 중 명령을 꺼내며 비운다 (1회 소비). */
export function consumePendingDispatch(): string | null {
  const p = pending;
  pending = null;
  return p;
}

export function hasPendingDispatch(): boolean {
  return pending != null;
}
