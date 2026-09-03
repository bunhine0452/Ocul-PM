import { useCallback, useSyncExternalStore } from "react";

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
 * 세션 줄이 읽는 스냅샷 (Phase 3 `#active-rows`).
 *
 * `useSyncExternalStore` 는 **같은 상태면 같은 참조**를 요구한다 — 훅 안에서
 * 매번 새 Map 을 만들면 무한 렌더가 된다. 그래서 상태가 바뀔 때만 새로 짓고,
 * 그 사이에는 같은 객체를 돌려준다. 프로젝트별로 가르지 않는 이유도 같다:
 * 인자를 받아 걸러 주면 호출마다 새 객체가 나온다. 키에 이미 프로젝트가
 * 들어 있으므로(`acpWorkingKey`) 거르는 일은 렌더가 한다.
 */
export interface AcpRowStates {
  working: ReadonlySet<string>;
  attention: ReadonlySet<string>;
}

let rowStates: AcpRowStates = { working: new Set(), attention: new Set() };

function rebuildRowStates(): void {
  rowStates = { working: new Set(working), attention: new Set(attention) };
}

export function acpWorkingKey(
  projectId: number,
  sessionId: string | null,
  provider: "claude" | "codex" = "claude",
): string {
  return `${projectId}:${provider}:${sessionId ?? "new"}`;
}

/** 턴 시작/종료를 알린다. 같은 상태면 아무 일도 하지 않는다(무한 렌더 방지). */
export function setAcpWorking(key: string, on: boolean): void {
  if (on === working.has(key)) return;
  if (on) working.add(key);
  else working.delete(key);
  rebuildRowStates();
  for (const listener of [...listeners]) listener();
}

/** 승인 대기 시작/해소를 알린다. 같은 상태면 아무 일도 하지 않는다. */
export function setAcpAttention(key: string, on: boolean): void {
  if (on === attention.has(key)) return;
  if (on) attention.add(key);
  else attention.delete(key);
  rebuildRowStates();
  for (const listener of [...listeners]) listener();
}

function countIn(
  set: ReadonlySet<string>,
  projectId: number,
  provider?: "claude" | "codex",
): number {
  const prefix = provider ? `${projectId}:${provider}:` : `${projectId}:`;
  let n = 0;
  for (const key of set) if (key.startsWith(prefix)) n += 1;
  return n;
}

/** 이 프로젝트에서 돌고 있는 세션 수 — 훅이 아니라 즉시 읽기 (탭 닫기 문지기). */
export function countAcpWorkingFor(projectId: number, provider?: "claude" | "codex"): number {
  return countIn(working, projectId, provider);
}

/** 이 프로젝트에서 승인을 기다리는 세션 수. */
export function countAcpAttentionFor(projectId: number, provider?: "claude" | "codex"): number {
  return countIn(attention, projectId, provider);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 이 프로젝트에서 지금 돌고 있는 세션 수. 0 이면 조용하다.
 *
 * `projectId` 를 받는다 (2026-09-01): 예전엔 `working.size` 를 그대로 돌려줘,
 * 탭마다 서는 사이드바가 **모든 프로젝트의 합**을 자기 「Claude Code」 배지에
 * 그렸다 — 아무것도 안 도는 A 탭이 "2 실행 중" 이라 우겼다. 스냅샷이 숫자라
 * 매번 세도 `Object.is` 비교가 안전하다 (`AcpRowStates` 처럼 새 객체가 나오는
 * 경우가 아니다).
 */
export function useAcpWorkingCount(
  projectId: number | null,
  provider?: "claude" | "codex",
): number {
  const snapshot = useCallback(
    () => (projectId == null ? 0 : countAcpWorkingFor(projectId, provider)),
    [projectId, provider],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 이 프로젝트에서 승인을 기다리며 멈춰 있는 세션 수. 0 이 아니면 사용자가 눌러야 풀린다. */
export function useAcpAttentionCount(
  projectId: number | null,
  provider?: "claude" | "codex",
): number {
  const snapshot = useCallback(
    () => (projectId == null ? 0 : countAcpAttentionFor(projectId, provider)),
    [projectId, provider],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 테스트 전용 — 창을 새로 여는 것과 같은 상태로 되돌린다. */
export function resetAcpWorking(): void {
  working.clear();
  attention.clear();
  rebuildRowStates();
  for (const listener of [...listeners]) listener();
}

function rowStatesSnapshot(): AcpRowStates {
  return rowStates;
}

/**
 * 세션 줄의 상태 — `실행 중…` / `입력을 기다립니다` 를 그리는 재료.
 * 키는 [`acpWorkingKey`] 가 만든 `projectId:sessionId` 다.
 */
export function useAcpRowStates(): AcpRowStates {
  return useSyncExternalStore(subscribe, rowStatesSnapshot, rowStatesSnapshot);
}

/** 한 세션의 상태 한 낱말. 없으면 `null` (= 유휴, 상대 시각을 그린다). */
export type AcpRowState = "working" | "attention";

export function acpRowStateOf(
  states: AcpRowStates,
  projectId: number,
  sessionId: string,
  provider: "claude" | "codex" = "claude",
): AcpRowState | null {
  const key = acpWorkingKey(projectId, sessionId, provider);
  // 승인 대기가 이긴다 — 둘 다 참일 때 사용자가 해야 할 일은 기다리는 것이
  // 아니라 누르는 것이다.
  if (states.attention.has(key)) return "attention";
  if (states.working.has(key)) return "working";
  return null;
}
