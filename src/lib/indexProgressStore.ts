import type { IndexProgress } from "@/lib/bindings";
import { createStore } from "@/lib/createStore";

// 색인 진행률의 컨텍스트 밖 스토어 (완성도 라운드 Phase 3, 2026-08-30).
//
// 예전엔 파일 하나마다 `setIndexing(projectId, p)` 가 WorkspaceContext 전체를
// 갈아 끼웠다 — 수천 파일이면 수천 번 프로바이더 아래가 다시 그려지고, 그때마다
// localStorage 디바운스가 다시 걸렸다 (`recentChangesStore` 와 같은 병). 진행률을
// 읽는 화면은 검색 하나뿐이라, 그 하나만 구독하는 외부 스토어로 뺀다.
// "색인 중인가"(`indexingProjectId`) 는 두 번만 바뀌므로 컨텍스트에 남긴다.

const store = createStore<IndexProgress | null>(null);

export const indexProgressStore = {
  /** 백엔드 채널이 보낸 스냅샷 그대로 (참조를 바꾸지 않으면 구독자도 조용하다). */
  set: (progress: IndexProgress) => store.set(progress),
  clear: () => store.set(null),
  get: store.get,
  subscribe: store.subscribe,
};

/** 지금 도는 색인의 진행률. 안 돌면 `null`. */
export const useIndexProgress = store.useValue;
