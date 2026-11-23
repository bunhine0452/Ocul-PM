/**
 * 변경 화면이 기억하는 것 셋 (11-15 → 11-23) — 모듈 범위, 창 하나에 하나.
 *
 *  - 공백 무시 — 보기 방식 옆 토글. 앱을 다시 켜면 꺼진다.
 *  - 봤음 — 「내가 본 뒤로」(11-23). 파일마다 (그때 **파일 내용**의 해시 · 그때 변경 시각). 에이전트가 다시
 *    고치면 풀려 예외로 다시 서고, 같은 내용으로 다시 쓰면 그대로 봤음이다. 앱을 다시 켜도 남는다 — 영속은
 *    WorkspaceContext(`diffViewed`, 프로젝트별)가 하고, 여기는 창 안의 런타임 사본이다(`diffNoteStore` 와 같은 꼴).
 *    하루 동안 쌓인 변경에서 「안 본 것」 만 남기려면 다시 켠 뒤에도 기억해야 한다.
 *  - 맡김 — 「일지 맡기기」 로 보낸 일지 없는 파일 묶음. 일지가 와서 묶음이 바뀌면 저절로 풀린다.
 */
import { useSyncExternalStore } from "react";

import { createStore } from "@/lib/createStore";
import type { RecentChange } from "@/lib/recentChangesStore";

export const ignoreWhitespaceStore = createStore(false);

export interface Viewed {
  /** 그때 본 파일 내용의 해시(`contentHash`). 빈 값은 「못 읽음」 — 시각으로만 가린다. */
  hash: string;
  /** 그때 목록이 준 변경 시각 — 워처가 더 늦은 시각을 주면 그 뒤 바뀐 것이다(내용을 다시 읽기 전까지). */
  ts: number;
}

/** 지금 파일 내용을 읽은 결과 — `at` 은 읽을 때의 변경 시각이다. 그보다 늦은 변경이 오면 낡은 읽음이다. */
export interface ContentNow {
  hash: string;
  at: number;
}

type ViewedMap = ReadonlyMap<string, Viewed>;
const EMPTY_VIEWED: ViewedMap = new Map();
const viewed = createStore<ReadonlyMap<number, ViewedMap>>(new Map());
const asked = createStore<ReadonlyMap<number, string>>(new Map());

/** 32비트 FNV-1a — 같은 글인지만 가리면 된다. */
export function patchHash(patch: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < patch.length; i++) {
    h ^= patch.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** 지운 파일의 내용 해시 — 「없음」 도 한 가지 내용이다(지운 것을 봤고 여전히 지워져 있으면 본 것). */
export const GONE_HASH = "-";

/** 파일 내용의 해시. `null` 은 파일이 없다. */
export const contentHash = (text: string | null) => (text == null ? GONE_HASH : patchHash(text));

/**
 * 봤음의 열쇠 — 기준선마다 다른 diff 다. 최근 커밋은 커밋마다 다르다(`last_commit:<sha>`) — 커밋은 바뀌지
 * 않으니 내용을 다시 읽을 것도 없다.
 */
export const viewedKey = (baseline: string, path: string) => `${baseline}\0${path}`;

/** 열쇠를 (기준선, 경로)로. */
export function splitViewedKey(key: string): { baseline: string; path: string } {
  const at = key.indexOf("\0");
  return at < 0 ? { baseline: "", path: key } : { baseline: key.slice(0, at), path: key.slice(at + 1) };
}

export function setViewed(projectId: number, key: string, v: Viewed | null): void {
  viewed.update((all) => {
    const mine = new Map(all.get(projectId) ?? EMPTY_VIEWED);
    if (v) mine.set(key, v);
    else if (!mine.delete(key)) return all;
    return new Map(all).set(projectId, mine);
  });
}

/** 지금 기록 — 늦게 온 읽음이 그 사이 사람이 푼 표시를 되살리지 않게 확인한다. */
export function viewedOf(projectId: number, key: string): Viewed | undefined {
  return viewed.get().get(projectId)?.get(key);
}

/** 영속 값으로 처음 한 번 채운다. 해시를 모르는 기록은 버린다 — 다시 켠 뒤에는 시각이 아무것도 말하지 않는다. */
export function hydrateViewed(projectId: number, saved: Record<string, Viewed> | null | undefined): void {
  const mine = new Map<string, Viewed>();
  for (const [key, v] of Object.entries(saved ?? {})) {
    if (v && typeof v.hash === "string" && v.hash && typeof v.ts === "number") mine.set(key, { hash: v.hash, ts: v.ts });
  }
  viewed.update((all) => new Map(all).set(projectId, mine));
}

/** 이제 목록에 없는 파일의 기록을 걷는다 — 커밋해서 사라진 파일이 다음에 바뀌면 처음 보는 변경이다. */
export function pruneViewed(projectId: number, keep: (key: string) => boolean): void {
  viewed.update((all) => {
    const mine = all.get(projectId);
    if (!mine) return all;
    const next = new Map([...mine].filter(([k]) => keep(k)));
    return next.size === mine.size ? all : new Map(all).set(projectId, next);
  });
}

/** 영속할 모양 — 해시를 모르는 기록은 싣지 않는다(`hydrateViewed` 가 어차피 버린다). */
export function viewedRecord(map: ViewedMap): Record<string, Viewed> {
  const out: Record<string, Viewed> = {};
  for (const [k, v] of map) if (v.hash) out[k] = v;
  return out;
}

export function useViewed(projectId: number): ViewedMap {
  const get = () => viewed.get().get(projectId) ?? EMPTY_VIEWED;
  return useSyncExternalStore(viewed.subscribe, get, get);
}

export type ViewState = "viewed" | "changed" | "none";

/**
 * 봤음 · 본 뒤 바뀜 · 안 봄. 지금 내용을 읽었고 그 뒤 새 변경이 없으면 내용 해시로 가린다 — 같은 내용이면
 * 시각이 늦어도 본 것이다. 아직 못 읽었으면(읽는 중 · 바이너리) 시각으로만 가린다.
 */
export function viewStateOf(v: Viewed | undefined, change: RecentChange | undefined, now?: ContentNow | null): ViewState {
  if (!v) return "none";
  const ts = change?.ts ?? 0;
  if (now && v.hash && ts <= now.at) return now.hash === v.hash ? "viewed" : "changed";
  return ts > v.ts ? "changed" : "viewed";
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
