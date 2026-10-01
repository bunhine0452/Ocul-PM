// 의미 검색 커맨드 래퍼 (2026-10-01 `{#api-facades}`).
//
// 로컬 임베딩(fastembed) 색인을 묻는다 — 네트워크로 나가지 않는다.
import { commands, type ChunkSearchResult } from "@/lib/bindings";
import { call } from "./invoke";

export const searchApi = {
  /**
   * 질의와 가까운 코드 조각 `limit` 개. `includeDocs` 는 문서(.md 등),
   * `includeJournal` 은 일지·롤업까지 같은 색인에서 찾는다.
   */
  chunks: (
    projectId: number,
    query: string,
    limit: number,
    includeDocs: boolean,
    includeJournal: boolean,
  ): Promise<ChunkSearchResult[]> =>
    call("search_chunks", commands.searchChunks(projectId, query, limit, includeDocs, includeJournal)),
};
