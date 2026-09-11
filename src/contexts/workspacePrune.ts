/**
 * 지워진 프로젝트의 워크스페이스 레코드 정리 (감사 라운드 2026-09-11 D3).
 *
 * `WorkspaceContext` 가 프로젝트마다 `aipm:workspace:v2:p<id>` 를 쓰는데,
 * 프로젝트를 지워도 그 키는 영영 남았다 — 열린 코드 탭·필터가 몇 KB 씩.
 * 프로젝트 **목록**을 받은 자리가 목록 밖 id 의 키를 지운다. 컨텍스트 밖에서
 * `localStorage` 를 만지는 유일한 자리라 `lint:storage` allowlist 에 있다.
 */
import { storageKeyFor } from "./WorkspaceContext";

const PREFIX = storageKeyFor(0).slice(0, -1);

/** 목록 밖 id 의 레코드를 지우고 그 수를 돌려준다. 저장소가 막혀 있으면 0. */
export function pruneWorkspaceRecords(liveProjectIds: Iterable<number>): number {
  const live = new Set(liveProjectIds);
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const id = Number(k.slice(PREFIX.length));
      if (Number.isInteger(id) && !live.has(id)) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
    return stale.length;
  } catch {
    return 0;
  }
}
