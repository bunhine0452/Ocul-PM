/**
 * 같은 일을 worktree 여럿에서 (Orca 벤치마킹 #worktree-race) — 레인 명령의 래퍼.
 * 레인은 `ocul-race/` 가지의 worktree 이고 상태는 git 이 들고 있다(`src-tauri/src/git/race.rs`).
 */
import { commands, type RaceLane } from "@/lib/bindings";
import { call } from "./invoke";

export type { RaceLane };

export const raceApi = {
  /** 지금 `HEAD` 에서 레인 `count` 개(2~4)를 만든다. */
  start: (projectId: number, count: number) => call<RaceLane[]>("race_start", commands.raceStart(projectId, count)),
  /** 지금 있는 레인과 각 변경의 크기. */
  lanes: (projectId: number) => call<RaceLane[]>("race_lanes", commands.raceLanes(projectId)),
  /** 레인 하나의 변경(보기용 diff). */
  patch: (projectId: number, path: string) => call<string>("race_patch", commands.racePatch(projectId, path)),
  /** 고른 레인의 변경을 원래 작업 폴더에 커밋 전 변경으로. */
  take: (projectId: number, path: string) => call<null>("race_take", commands.raceTake(projectId, path)),
  /** 레인을 모두 지운다(worktree · 가지). */
  clear: (projectId: number) => call<number>("race_clear", commands.raceClear(projectId)),
};
