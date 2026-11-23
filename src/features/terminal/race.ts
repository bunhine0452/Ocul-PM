/**
 * 같은 일을 worktree 여럿에서 (2026-10-30, Orca 「Parallel Worktrees」 벤치마킹) — 창 하나에 하나.
 *
 * 레인 목록은 git 이 들고 있고(`raceApi.lanes`), 여기는 레인 ↔ 터미널 세션의 짝만 기억한다.
 * 세션은 창과 함께 끝나므로 짝도 이 창 안에서만 산다. 앱을 다시 켜면 레인은 남고 세션은 없다 —
 * 띠가 「세션 없음」으로 보이고, 변경 보기 · 가져오기 · 정리는 그대로 된다.
 *
 * xterm 을 들이지 않는다 — 세션 이름(`status.ts` 의 「시도 n」)과 「Claude 에게 보내기」 대화상자가
 * 첫 청크에서 이 짝을 읽는다. 세션을 열고 닫을 때만 저장소를 지연 로드한다(`runPrompt.ts` 와 같은 길).
 */
import { useSyncExternalStore } from "react";

import { raceApi, type RaceLane } from "@/api/race";
import { t } from "@/i18n";

interface RaceState {
  lanes: RaceLane[];
  /** 레인 경로 → 그 레인에서 연 세션 id. */
  sessions: ReadonlyMap<string, number>;
  /** 터미널 위 띠를 시도마다 한 줄씩 펼쳤는가 — 화면을 오가도 그대로(창 하나에 하나). */
  expanded: boolean;
}

let state: RaceState = { lanes: [], sessions: new Map(), expanded: false };
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

/** 띠를 펼치거나 접는다. */
export function setRaceExpanded(expanded: boolean) {
  if (state.expanded !== expanded) set({ expanded });
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

/** 세션이 레인의 것이면 그 레인 경로 — 그 칸을 나누면 새 칸도 같은 worktree 에서 뜬다(Orca 「cwd 이어받기」). */
export function lanePathOf(sessionId: number): string | null {
  for (const [path, id] of state.sessions) if (id === sessionId) return path;
  return null;
}

/**
 * 세션이 레인의 것이면 그 레인 — 일지 수는 레인 worktree 의 것이다. 탭이 원래 프로젝트의 일지를 세면
 * 띠는 「일지 없음」, 탭은 「일지 4건」으로 같은 레인을 다르게 말했다.
 */
export function laneOf(sessionId: number): RaceLane | null {
  const path = lanePathOf(sessionId);
  return path == null ? null : (state.lanes.find((l) => l.path === path) ?? null);
}

/** 끝난 레인 세션을 다시 열었다 — 짝을 새 세션으로 옮긴다(띠 · 탭의 「시도 n」 이 그대로 따라간다). */
export function rebindLane(from: number, to: number) {
  const path = lanePathOf(from);
  if (path == null) return;
  const sessions = new Map(state.sessions);
  sessions.set(path, to);
  set({ sessions });
}

export async function refreshRace(projectId: number): Promise<void> {
  const lanes = await raceApi.lanes(projectId);
  set({ lanes: Array.isArray(lanes) ? lanes : [] });
}

/**
 * 레인을 만들고 레인마다 그 프롬프트로 claude 를 연다. 돌려주는 것은 첫 레인의 세션 id 와, `.worktreeinclude` 로
 * 레인에 복사한 git 무시 파일의 이름(레인마다 같다 — 첫 레인 것). 내용은 백엔드가 싣지 않는다.
 */
export async function startRace(
  projectId: number,
  prompt: string,
  count: number,
): Promise<{ first: number | null; included: string[] }> {
  const lanes = await raceApi.start(projectId, count);
  const included = lanes[0]?.included ?? [];
  const { openTerm } = await import("./termStore");
  const sessions = new Map(state.sessions);
  set({ lanes });
  let first: number | null = null;
  for (const lane of lanes) {
    const id = await openTerm(projectId, prompt, lane.path);
    sessions.set(lane.path, id);
    first ??= id;
    set({ sessions: new Map(sessions) });
  }
  return { first, included };
}

/** 토스트에 싣는 이름 수 — 넘으면 「외 n개」 로 센다. */
const INCLUDED_SHOWN = 3;

/** 복사한 파일 이름을 한 줄로 — 처음 몇 개 + 나머지 수. 없으면 `null`(알릴 것이 없다). */
export function includedLine(included: readonly string[]): string | null {
  if (included.length === 0) return null;
  const shown = included.slice(0, INCLUDED_SHOWN).join(", ");
  const rest = included.length - INCLUDED_SHOWN;
  const names = rest > 0 ? t("race.includedMore", { names: shown, n: rest }) : shown;
  return t("race.included", { names });
}

/** 레인을 모두 지운다 — 그 안의 세션부터 닫는다(셸이 지워진 폴더에 남지 않게). */
export async function clearRace(projectId: number): Promise<number> {
  const { closeTerm } = await import("./termStore");
  for (const id of state.sessions.values()) closeTerm(id);
  set({ sessions: new Map() });
  const n = await raceApi.clear(projectId);
  await refreshRace(projectId).catch(() => set({ lanes: [] }));
  return n;
}

/** 테스트 전용 — 창 하나의 수명을 흉내 낸다. */
export function __resetRaceForTests() {
  state = { lanes: [], sessions: new Map(), expanded: false };
}

/** 테스트 전용 — 레인과 짝을 바로 놓는다. */
export function __setRaceForTests(lanes: RaceLane[], sessions: ReadonlyMap<string, number>) {
  set({ lanes, sessions: new Map(sessions) });
}
