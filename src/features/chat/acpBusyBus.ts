import { useSyncExternalStore } from "react";

// 지금 **정말로 돌고 있는** Claude Code 세션의 수 (2026-08-16).
//
// 사이드바가 알아야 하는데, 대화 화면은 사이드바의 형제도 자식도 아니다.
// WorkspaceContext 로 올리는 방법도 있지만 그쪽은 **영속되는 값**의 자리라
// (localStorage 로 내려간다) 앱을 껐다 켜면 "작업 중"이 되살아난다. 진행
// 상태는 프로세스가 사는 동안만 참이므로 메모리 버스가 맞다 (usageBus.ts 와
// 같은 판단).
//
// 열려 있기만 한 세션은 세지 않는다 — 사용자가 보고 싶은 것은 "내가 기다리고
// 있는 것이 몇 개인가"다.

type Listener = () => void;

/** 도는 중인 턴의 키 (`projectId:sessionId`). 프로젝트 탭이 여럿이면 여럿 찬다. */
const working = new Set<string>();
/**
 * **승인을 기다리며 멈춰 있는** 세션의 키.
 *
 * "작업 중"과 다르다: 작업 중은 기다리면 되지만, 승인 대기는 **사용자가 눌러야**
 * 풀린다. 다른 화면에 가 있는 동안 이 상태가 안 보이면, 에이전트가 일하는 줄
 * 알고 기다리다 몇 분을 통째로 잃는다.
 */
const attention = new Set<string>();
const listeners = new Set<Listener>();

/**
 * `useSyncExternalStore` 는 스냅샷이 **같은 값이면 같아야** 한다 — `working.size`
 * 를 매번 읽어도 숫자라 안전하지만, 캐시해 두면 구독자 수만큼의 Set 조회가 없다.
 */
let count = 0;
let attentionCount = 0;

export function acpWorkingKey(projectId: number, sessionId: string | null): string {
  return `${projectId}:${sessionId ?? "new"}`;
}

/** 턴 시작/종료를 알린다. 같은 상태면 아무 일도 하지 않는다(무한 렌더 방지). */
export function setAcpWorking(key: string, on: boolean): void {
  if (on === working.has(key)) return;
  if (on) working.add(key);
  else working.delete(key);
  count = working.size;
  for (const listener of [...listeners]) listener();
}

/** 승인 대기 시작/해소를 알린다. 같은 상태면 아무 일도 하지 않는다. */
export function setAcpAttention(key: string, on: boolean): void {
  if (on === attention.has(key)) return;
  if (on) attention.add(key);
  else attention.delete(key);
  attentionCount = attention.size;
  for (const listener of [...listeners]) listener();
}

/** 이 프로젝트에서 돌고 있는 세션 수 — 훅이 아니라 즉시 읽기 (탭 닫기 문지기). */
export function countAcpWorkingFor(projectId: number): number {
  const prefix = `${projectId}:`;
  let n = 0;
  for (const key of working) if (key.startsWith(prefix)) n += 1;
  return n;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): number {
  return count;
}

/** 지금 돌고 있는 세션 수. 0 이면 조용하다. */
export function useAcpWorkingCount(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function attentionSnapshot(): number {
  return attentionCount;
}

/** 승인을 기다리며 멈춰 있는 세션 수. 0 이 아니면 사용자가 눌러야 풀린다. */
export function useAcpAttentionCount(): number {
  return useSyncExternalStore(subscribe, attentionSnapshot, attentionSnapshot);
}

/** 테스트 전용 — 창을 새로 여는 것과 같은 상태로 되돌린다. */
export function resetAcpWorking(): void {
  working.clear();
  attention.clear();
  count = 0;
  attentionCount = 0;
  for (const listener of [...listeners]) listener();
}
