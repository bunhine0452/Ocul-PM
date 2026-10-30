/**
 * 같은 일을 worktree 여럿에서 (2026-10-30, Orca 「Parallel Worktrees」 벤치마킹) — 창 하나에 하나.
 *
 * 레인 목록은 git 이 들고 있고(`raceApi.lanes`), 여기는 레인 ↔ 터미널 세션의 짝만 기억한다.
 * 세션은 창과 함께 끝나므로 짝도 이 창 안에서만 산다. 앱을 다시 켜면 레인은 남고 세션은 없다 —
 * 띠가 「세션 없음」으로 보이고, 보기 · 이것으로 · 정리는 그대로 된다.
 */
import { useSyncExternalStore } from "react";

import { raceApi, type RaceLane } from "@/api/race";
import { closeTerm, openTerm } from "./termStore";

interface RaceState {
  lanes: RaceLane[];
  /** 레인 경로 → 그 레인에서 연 세션 id. */
  sessions: ReadonlyMap<string, number>;
}

let state: RaceState = { lanes: [], sessions: new Map() };
const subs = new Set<() => void>();

function set(next: Partial<RaceState>) {
  state = { ...state, ...next };
  for (const fn of subs) fn();
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useRace(): RaceState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** 세션이 레인의 것이면 그 레인의 순번(1부터). 탭 이름에 쓴다. */
export function laneNumberOf(sessionId: number): number | null {
  let i = 0;
  for (const lane of state.lanes) {
    i++;
    if (state.sessions.get(lane.path) === sessionId) return i;
  }
  return null;
}

export async function refreshRace(projectId: number): Promise<void> {
  const lanes = await raceApi.lanes(projectId);
  set({ lanes: Array.isArray(lanes) ? lanes : [] });
}

/** 레인을 만들고 레인마다 그 프롬프트로 claude 를 연다. 돌려주는 것은 첫 레인의 세션 id. */
export async function startRace(projectId: number, prompt: string, count: number): Promise<number | null> {
  const lanes = await raceApi.start(projectId, count);
  const sessions = new Map(state.sessions);
  set({ lanes });
  let first: number | null = null;
  for (const lane of lanes) {
    const id = await openTerm(projectId, prompt, lane.path);
    sessions.set(lane.path, id);
    first ??= id;
    set({ sessions: new Map(sessions) });
  }
  return first;
}

/** 레인을 모두 지운다 — 그 안의 세션부터 닫는다(셸이 지워진 폴더에 남지 않게). */
export async function clearRace(projectId: number): Promise<number> {
  for (const id of state.sessions.values()) closeTerm(id);
  set({ sessions: new Map() });
  const n = await raceApi.clear(projectId);
  await refreshRace(projectId).catch(() => set({ lanes: [] }));
  return n;
}

/** 테스트 전용 — 창 하나의 수명을 흉내 낸다. */
export function __resetRaceForTests() {
  state = { lanes: [], sessions: new Map() };
}
