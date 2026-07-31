// IN2 (#in2-dispatch) — 디스패치 → 터미널 프리필 핸드오프. 모듈 싱글턴 1칸,
// 1회 소비, 영속 없음 (새로고침에 살아남을 이유가 없는 순간 상태라
// WorkspaceContext/localStorage 대상이 아니다).
//
// 생산자는 여럿(플래너 ▶실행, 회고 "Claude Code 로", Greenfield 킥오프)이고
// 슬롯은 하나 — **마지막 의도가 이긴다**. 미소비 명령이 남은 채 다른 화면에서
// 디스패치하면 이전 것은 조용히 교체되는데, 각 생산자가 곧바로 터미널로
// 이동시키므로 실사용에서 미소비 잔류는 짧다. 큐가 필요해지면 디스패치 v2 에서.

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

/** 대기 중 명령을 비우지 않고 본다 — 쓰기 성공 후에만 consume 하기 위해. */
export function peekPendingDispatch(): string | null {
  return pending;
}
