// 대화별로 갈라 두는 화면 상태 — 작업중·실패·사용량·승인 요청.
//
// AcpConversation.tsx 에서 갈라 나온 조각이다. 훅 호출 순서와 로직은 그대로이며,
// 호출부는 예전과 같은 이름들을 구조분해로 받는다.

import { useCallback, useState } from "react";

import { type PermissionState } from "./shared";

export interface UsageState {
  used: number;
  size: number;
  costUsd: number | null;
}

/** 대화별 칸의 빈 초기값 — 렌더마다 새로 만들지 않는다. */
export const NO_SESSIONS: ReadonlySet<string> = new Set();
export const NOTHING_BY_SESSION: Readonly<Record<string, never>> = {};

/**
 * 대화별 칸 하나를 채우거나(값) 비운다(null).
 *
 * 바뀐 것이 없으면 **같은 객체를 돌려준다** — 답이 흐르는 동안 초당 수십 번
 * 불리는 자리라, 매번 새 객체를 만들면 화면 전체가 그만큼 다시 그려진다.
 */
export function assignBySession<T>(
  prev: Readonly<Record<string, T>>,
  id: string,
  value: T | null,
): Readonly<Record<string, T>> {
  if (value === null) {
    if (!(id in prev)) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
  }
  if (prev[id] === value) return prev;
  return { ...prev, [id]: value };
}

/**
 * 지금 보고 있는 대화(`activeId`)의 몫을 함께 돌려준다 — 화면의 나머지는
 * 예전처럼 `busy`/`error`/`usage`/`permission` 만 본다.
 */
export function useSessionMaps(activeId: string) {
  /**
   * **대화별로 갈라 두는 것들.**
   *
   * 하나로 두면 옆 대화의 일이 이 화면에 나타난다. 대화를 나란히 돌릴 수 있게
   * 되면서 갈랐다 — 특히 승인 카드가 그렇다: 뒤에서 돌던 대화가 물어본 것을
   * 보고 있던 대화에 띄우면 **무엇을 허용하는지 못 본 채** 허용을 누르게 된다.
   * 작업 중 표시도 마찬가지다. 하나뿐이면 A 가 도는 동안 B 의 입력이 잠긴다 —
   * 그것이 곧 "멀티 세션이 안 된다"의 정체였다.
   */
  const [busySessions, setBusySessions] = useState<ReadonlySet<string>>(NO_SESSIONS);
  const [errors, setErrors] =
    useState<Readonly<Record<string, string>>>(NOTHING_BY_SESSION);
  const [usages, setUsages] =
    useState<Readonly<Record<string, UsageState>>>(NOTHING_BY_SESSION);
  const [permissions, setPermissions] =
    useState<Readonly<Record<string, PermissionState>>>(NOTHING_BY_SESSION);

  /** 지금 보고 있는 대화의 몫 — 화면의 나머지는 예전처럼 이 이름들만 본다. */
  const busy = busySessions.has(activeId);
  const error = errors[activeId] ?? null;
  const usage = usages[activeId] ?? null;
  /**
   * 승인 대기 중인 권한 요청. 응답할 때까지 **에이전트는 멈춰 있다** — 그래서
   * 카드를 모달이 아니라 대화 흐름에 인라인으로 둔다(D4). 모달로 가리면
   * 무엇을 승인하는지 보여 주는 도구 카드가 함께 가려진다.
   */
  const permission = permissions[activeId] ?? null;

  /** 이 대화가 도는 중인가를 켜고 끈다. */
  const markBusy = useCallback((id: string, on: boolean) => {
    setBusySessions((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const putError = useCallback(
    (id: string, message: string | null) => setErrors((prev) => assignBySession(prev, id, message)),
    [],
  );
  const putUsage = useCallback(
    (id: string, value: UsageState | null) => setUsages((prev) => assignBySession(prev, id, value)),
    [],
  );
  const putPermission = useCallback(
    (id: string, value: PermissionState | null) =>
      setPermissions((prev) => assignBySession(prev, id, value)),
    [],
  );

  return {
    busySessions,
    permissions,
    busy,
    error,
    usage,
    permission,
    markBusy,
    putError,
    putUsage,
    putPermission,
  };
}
