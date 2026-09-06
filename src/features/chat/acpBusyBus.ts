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
 * 바쁨 신호가 **어디서** 왔나 (플랜 `v3-surface` `{#working-source}`).
 *
 * 지금까지 `working` 은 참/거짓 하나였다. 그래서 **스트림이 끊긴 것과 진짜로
 * 도는 것을 구별하지 못했다** — 어댑터가 조용히 죽어도, 30분째 안 끝나는
 * Bash 가 걸려 있어도 화면은 똑같이 "실행 중"이라고 말한다. 그건 모르는 것을
 * 아는 척한 것이다.
 *
 * 그래서 세 상태로 가른다:
 *  - `typing`   글자가 흐르고 있다. 가장 강한 근거.
 *  - `observer` 백엔드 이벤트가 최근에 왔다 (도구 상태·계획 갱신 …).
 *  - `none`     턴은 열려 있는데 최근 신호가 없다. **모른다**는 뜻이고,
 *               화면은 모른다고 말한다 (「신호 없음」).
 */
export type BusySource = "typing" | "observer" | "none";

/**
 * 신호가 이만큼 없으면 「모른다」로 내려간다.
 *
 * 15초는 셸 통합이 쓰는 문턱과 같다. 짧게 잡으면 생각이 긴 턴이 매번 깜빡이고,
 * 길게 잡으면 죽은 세션이 한참 동안 살아 있다고 우긴다.
 */
export const SILENCE_MS = 15_000;

const sources = new Map<string, BusySource>();
/** 침묵 강등 타이머 — 키마다 하나. 턴이 끝나면 반드시 걷는다. */
const decayTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearDecay(key: string): void {
  const timer = decayTimers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    decayTimers.delete(key);
  }
}

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
  /** 도는 세션마다 그 바쁨이 **어디서 온 신호인가**. 없으면 `none` 취급. */
  sources: ReadonlyMap<string, BusySource>;
}

let rowStates: AcpRowStates = { working: new Set(), attention: new Set(), sources: new Map() };

function rebuildRowStates(): void {
  rowStates = {
    working: new Set(working),
    attention: new Set(attention),
    sources: new Map(sources),
  };
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function acpWorkingKey(
  projectId: number,
  sessionId: string | null,
  provider: "claude" | "codex" = "claude",
): string {
  return `${projectId}:${provider}:${sessionId ?? "new"}`;
}

/**
 * 턴 시작/종료를 알린다. 같은 상태면 아무 일도 하지 않는다(무한 렌더 방지).
 *
 * 시작 직후의 출처는 **`none`** 이다 — 아직 아무 신호도 못 받았으니까.
 * 첫 이벤트가 `noteAcpSignal` 로 올려 준다.
 */
export function setAcpWorking(key: string, on: boolean): void {
  if (on === working.has(key)) return;
  if (on) {
    working.add(key);
    sources.set(key, "none");
  } else {
    working.delete(key);
    sources.delete(key);
    clearDecay(key);
  }
  rebuildRowStates();
  notify();
}

/**
 * 이 세션에서 **신호를 하나 받았다**.
 *
 * 도는 세션에만 붙는다 — 끝난 턴에 늦게 도착한 이벤트가 죽은 줄을 되살리면
 * 안 된다. 매번 침묵 타이머를 새로 건다: 신호가 멎으면 그 타이머가 출처를
 * `none` 으로 내리고, 그 순간 화면은 "돌고 있다" 대신 "모른다"를 말한다.
 */
export function noteAcpSignal(key: string, typing: boolean): void {
  if (!working.has(key)) return;
  const next: BusySource = typing ? "typing" : "observer";
  clearDecay(key);
  decayTimers.set(
    key,
    setTimeout(() => {
      decayTimers.delete(key);
      if (!working.has(key) || sources.get(key) === "none") return;
      sources.set(key, "none");
      rebuildRowStates();
      notify();
    }, SILENCE_MS),
  );
  if (sources.get(key) === next) return;
  sources.set(key, next);
  rebuildRowStates();
  notify();
}

/** 승인 대기 시작/해소를 알린다. 같은 상태면 아무 일도 하지 않는다. */
export function setAcpAttention(key: string, on: boolean): void {
  if (on === attention.has(key)) return;
  if (on) attention.add(key);
  else attention.delete(key);
  rebuildRowStates();
  notify();
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
  sources.clear();
  for (const key of [...decayTimers.keys()]) clearDecay(key);
  rebuildRowStates();
  notify();
}

function rowStatesSnapshot(): AcpRowStates {
  return rowStates;
}

/**
 * 훅 없이 즉시 읽기 (`countAcpWorkingFor` 와 같은 성격).
 *
 * 렌더 밖에서 상태를 물어야 하는 자리 — 탭 닫기 문지기, 그리고 테스트 —
 * 를 위한 것이다. 반환값은 **읽기 전용 스냅샷**이므로 고쳐 쓰지 않는다.
 */
export function acpRowStatesNow(): AcpRowStates {
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

/**
 * 이 세션의 바쁨이 **어디서 온 신호인가**.
 *
 * 안 도는 세션도 `none` 이다 — 「모른다」와 「안 돈다」를 부르는 이름이 같아도
 * 되는 이유는, 이 값을 읽는 자리가 이미 `working` 을 확인한 뒤이기 때문이다.
 */
export function acpRowSourceOf(
  states: AcpRowStates,
  projectId: number,
  sessionId: string,
  provider: "claude" | "codex" = "claude",
): BusySource {
  return states.sources.get(acpWorkingKey(projectId, sessionId, provider)) ?? "none";
}
