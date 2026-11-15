/**
 * 변경 화면이 **앱이 켜 있는 동안** 기억하는 것 셋 (11-15) — 모듈 범위, 창 하나에 하나. 화면을 옮겼다
 * 돌아와도 남고, 앱을 다시 켜면 비운다(영속은 WorkspaceContext 몫인데, 셋 다 그날의 검토 상태라
 * 다음 날까지 끌고 갈 것이 아니다).
 *
 *  - 공백 무시 — 보기 방식 옆 토글.
 *  - 봤음 — 파일마다 (그때 패치 해시 · 그때 변경 시각). 에이전트가 다시 고치면 풀려 예외로 다시 선다.
 *  - 맡김 — 「일지 맡기기」 로 보낸 일지 없는 파일 묶음. 일지가 와서 묶음이 바뀌면 저절로 풀린다.
 */
import { useSyncExternalStore } from "react";

import { createStore } from "@/lib/createStore";
import type { RecentChange } from "@/lib/recentChangesStore";

export const ignoreWhitespaceStore = createStore(false);

export interface Viewed {
  /** 그때 본 패치의 해시. */
  hash: string;
  /** 그때 목록이 준 변경 시각 — 워처가 더 늦은 시각을 주면 다시 바뀐 것이다. */
  ts: number;
  /** 그때 공백 무시였나 — 보기 방식이 달라 패치가 다른 것을 「바뀜」 으로 읽지 않게. */
  ws: boolean;
}

type ViewedMap = ReadonlyMap<string, Viewed>;
const EMPTY_VIEWED: ViewedMap = new Map();
const viewed = createStore<ReadonlyMap<number, ViewedMap>>(new Map());
const asked = createStore<ReadonlyMap<number, string>>(new Map());

/** 32비트 FNV-1a — 같은 패치인지만 가리면 된다. */
export function patchHash(patch: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < patch.length; i++) {
    h ^= patch.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** 봤음의 열쇠 — 기준선마다 다른 diff 다. */
export const viewedKey = (baseline: string, path: string) => `${baseline}\0${path}`;

export function setViewed(projectId: number, key: string, v: Viewed | null): void {
  viewed.update((all) => {
    const mine = new Map(all.get(projectId) ?? EMPTY_VIEWED);
    if (v) mine.set(key, v);
    else mine.delete(key);
    return new Map(all).set(projectId, mine);
  });
}

export function useViewed(projectId: number): ViewedMap {
  const get = () => viewed.get().get(projectId) ?? EMPTY_VIEWED;
  return useSyncExternalStore(viewed.subscribe, get, get);
}

export type ViewState = "viewed" | "changed" | "none";

/**
 * 봤음 · 본 뒤 바뀜 · 안 봄. 목록의 다른 파일은 패치를 모르니 시각으로만, 지금 보는 파일은 패치
 * 해시까지(같은 보기 방식일 때) 견준다.
 */
export function viewStateOf(
  v: Viewed | undefined,
  change: RecentChange | undefined,
  current?: { hash: string; ws: boolean } | null,
): ViewState {
  if (!v) return "none";
  if ((change?.ts ?? 0) > v.ts) return "changed";
  // 본문이 오기 전에 봤음을 누르면 해시를 모른다(빈 값) — 그때는 시각으로만 가린다.
  if (current && v.hash && current.ws === v.ws && current.hash !== v.hash) return "changed";
  return "viewed";
}

export function markAsked(projectId: number, unrecordedKey: string): void {
  asked.update((all) => new Map(all).set(projectId, unrecordedKey));
}

export function useAskedKey(projectId: number): string | null {
  const get = () => asked.get().get(projectId) ?? null;
  return useSyncExternalStore(asked.subscribe, get, get);
}

/** 테스트 격리용. */
export function resetDiffSession(): void {
  ignoreWhitespaceStore.set(false);
  viewed.set(new Map());
  asked.set(new Map());
}
