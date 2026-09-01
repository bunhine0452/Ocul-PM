// IN2 (#in2-dispatch) — 디스패치 → 터미널 프리필 핸드오프. 모듈 싱글턴 1칸,
// 1회 소비, 영속 없음 (새로고침에 살아남을 이유가 없는 순간 상태라
// WorkspaceContext/localStorage 대상이 아니다).
//
// 생산자는 여럿(플래너 ▶실행, 회고 "Claude Code 로", Greenfield 킥오프)이고
// 슬롯은 하나 — **마지막 의도가 이긴다**. 미소비 명령이 남은 채 다른 화면에서
// 디스패치하면 이전 것은 조용히 교체되는데, 각 생산자가 곧바로 터미널을
// 보여주므로 실사용에서 미소비 잔류는 짧다. 큐가 필요해지면 디스패치 v2 에서.
//
// 2026-08-23 — 이 슬롯은 이제 **차선책**이다. 셸이 이미 살아 있으면 생산자가
// `handoffDispatch` 로 그 PTY 에 직접 써 넣고, 여기까지 오는 건 "터미널이 아직
// 없다" 는 경우뿐이다 (`dispatchTarget.ts` 참조).

/** 터미널로 넘길 한 건. 대상이 무엇이냐에 따라 둘 중 하나가 쓰인다. */
export interface PendingDispatch {
  /**
   * 이 건의 주인. 크롬식 탭은 프로젝트 여럿을 동시에 물고 터미널 면도 탭마다
   * 마운트돼 있어(도크를 열어 둔 탭 + 터미널 화면인 탭), 주인이 없으면 **남의
   * 프로젝트 면**이 먼저 집어 그 셸(cwd = 남의 루트)에 프리필하거나 그 페인의
   * 에이전트에 다른 프로젝트 프롬프트를 붙여넣는다.
   *
   * `null` 은 "아직 주인이 없다" — Greenfield 킥오프처럼 프로젝트 탭이 서기
   * 전에 예약된 건이라 누가 집어도 된다.
   */
  projectId: number | null;
  /** 셸 프롬프트에 프리필할 한 줄 명령 (`claude "$(cat '…')"`). */
  command: string;
  /**
   * 프롬프트 **본문**. 대상 페인에서 이미 코딩 에이전트가 돌고 있으면 새
   * 프로세스를 띄우는 대신 이걸 그대로 붙여넣는다. 본문을 못 실어 보내는
   * 생산자는 `null` — 그럼 언제나 명령 쪽이다.
   */
  prompt: string | null;
}

let pending: PendingDispatch | null = null;
const listeners = new Set<() => void>();

export function setPendingDispatch(next: PendingDispatch): void {
  pending = next;
  // 이미 마운트된 터미널 면에게 알린다. 마운트 시점에만 보던 예전 구조에서는
  // **도크를 열어 둔 채** 디스패치하면 아무 일도 일어나지 않았다 (그때는
  // 무조건 터미널 화면으로 이동시켜 새 마운트를 만들었기 때문에 가려져 있던
  // 구멍이다).
  for (const fn of [...listeners]) fn();
}

/** 대기 중 명령을 꺼내며 비운다 (1회 소비). */
export function consumePendingDispatch(): PendingDispatch | null {
  const p = pending;
  pending = null;
  return p;
}

export function hasPendingDispatch(): boolean {
  return pending != null;
}

/** 이 프로젝트가 집어도 되는 대기 건이 있나 (주인 없는 건은 누구든 집는다). */
export function hasPendingDispatchFor(projectId: number | null): boolean {
  if (pending == null) return false;
  return pending.projectId == null || pending.projectId === projectId;
}

/** 대기 중 명령을 비우지 않고 본다 — 쓰기 성공 후에만 consume 하기 위해. */
export function peekPendingDispatch(): PendingDispatch | null {
  return pending;
}

/** 새 대기 명령이 들어올 때 호출된다. 반환값은 구독 해제. */
export function subscribePendingDispatch(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
