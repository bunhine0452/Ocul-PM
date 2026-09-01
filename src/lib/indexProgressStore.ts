import { useCallback, useSyncExternalStore } from "react";

import type { IndexProgress } from "@/lib/bindings";
import { createStore } from "@/lib/createStore";

// 색인 진행률의 컨텍스트 밖 스토어 (완성도 라운드 Phase 3, 2026-08-30).
//
// 예전엔 파일 하나마다 `setIndexing(projectId, p)` 가 WorkspaceContext 전체를
// 갈아 끼웠다 — 수천 파일이면 수천 번 프로바이더 아래가 다시 그려지고, 그때마다
// localStorage 디바운스가 다시 걸렸다 (`recentChangesStore` 와 같은 병). 진행률을
// 읽는 화면은 검색 하나뿐이라, 그 하나만 구독하는 외부 스토어로 뺀다.
// "색인 중인가"(`indexingProjectId`) 는 두 번만 바뀌므로 컨텍스트에 남긴다.
//
// 프로젝트별 버킷 (2026-09-01): 크롬식 탭은 프로젝트 둘을 **동시에** 색인할 수
// 있는데 이 모듈은 창에 하나다. 슬롯이 하나면 두 탭이 번갈아 덮어써 각 검색
// 화면의 "n/m 색인 중" 이 남의 숫자로 튀고, 먼저 끝난 쪽의 clear 가 아직 도는
// 쪽의 진행률까지 지운다 (`recentChangesStore` 와 같은 수리).

const store = createStore<ReadonlyMap<number, IndexProgress>>(new Map());

export const indexProgressStore = {
  /** 백엔드 채널이 보낸 스냅샷 그대로 (참조를 바꾸지 않으면 구독자도 조용하다). */
  set: (projectId: number, progress: IndexProgress) =>
    store.update((prev) => new Map(prev).set(projectId, progress)),
  /** 한 프로젝트의 진행률을 지운다. `projectId` 생략 = 전부 (테스트 격리용). */
  clear: (projectId?: number) =>
    store.update((prev) => {
      if (projectId == null) return prev.size === 0 ? prev : new Map();
      if (!prev.has(projectId)) return prev; // 참조 그대로 → 구독자 조용
      const next = new Map(prev);
      next.delete(projectId);
      return next;
    }),
  get: (projectId: number): IndexProgress | null => store.get().get(projectId) ?? null,
  subscribe: store.subscribe,
};

/** 그 프로젝트에서 지금 도는 색인의 진행률. 안 돌면 `null`. */
export function useIndexProgress(projectId: number): IndexProgress | null {
  const snapshot = useCallback(() => indexProgressStore.get(projectId), [projectId]);
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}
