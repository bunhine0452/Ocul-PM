/**
 * recentChangesStore — watcher 파일 변경 버퍼의 전용 외부 스토어 (v2 U3,
 * docs/20260706_v2/03-performance-spec.md §1).
 *
 * 왜 컨텍스트 상태가 아닌가: 에이전트가 활발히 코딩하는 동안(=이 앱의 핵심
 * 시나리오) watcher 이벤트가 초당 수 회 도착한다. 이 버퍼가 WorkspaceContext
 * state 에 있으면 이벤트마다 [전 화면 리렌더 + 전체 blob localStorage 직렬화]가
 * 발생했다. 모듈 스코프 스토어 + useSyncExternalStore 로 분리하면 실제 구독
 * 컴포넌트(변경 diff 화면)만 리렌더한다.
 *
 * 왜 프로젝트별로 갈라지는가 (2026-09-01): 크롬식 탭 이후 **한 창이 프로젝트
 * 여럿을 동시에 문다**. 탭마다 WorkspaceProvider 가 따로 서지만 이 모듈은 창에
 * 하나뿐이라, 버킷 없는 단일 버퍼는 A 탭의 변경을 B 탭의 「미기록 변경」 목록에
 * 그대로 흘렸다 (열면 computeDiff 가 남의 프로젝트 경로를 받는다). 그래서 모든
 * 진입점이 projectId 를 받는다 — 버킷 없이는 아무것도 읽고 쓸 수 없게.
 *
 * 영속화하지 않는다 (세션 휘발): 변경 diff 화면의 파일 목록은 git status 가
 * 영속 소스(Bug 1 fix)라 재시작 후에도 채워지고, read/unread 신선도 표시는
 * "이번 세션에서 새로 본 것" 의미라 세션 단위 리셋이 오히려 정확하다.
 */
import { useCallback, useSyncExternalStore } from "react";

/** watcher 5-way op 를 탐색기 3-way 배지로 축약한 것 (A/M/D). */
export type ChangeOp = "A" | "M" | "D";

export interface RecentChange {
  /** Project-relative forward-slash path (matches `ProjectTreeNode.relative_path`). */
  path: string;
  op: ChangeOp;
  /** Unix milliseconds when we ingested the event. Used only for ordering. */
  ts: number;
  /**
   * read/unread flag for the diff view: 새 watcher 이벤트는 `false` 로 시작,
   * diff 본문을 열람하면 `true`. (한 방향 — 같은 파일의 새 이벤트가 다시
   * unread 로 되돌린다.)
   */
  read: boolean;
}

/**
 * FIFO cap — 폭주하는 watcher / 긴 세션이 메모리를 무한히 키우지 못하게.
 * 프로젝트당 1000 × ~80 bytes ≈ 80 KB.
 */
export const RECENT_CHANGES_CAP = 1000;

/**
 * Append a change to the FIFO buffer. If the same path already has an entry
 * we drop the earlier one so the latest op wins (e.g. create→update collapses
 * to update). Trims to `RECENT_CHANGES_CAP` from the *front* so the newest
 * 1000 are kept. Exported for unit testing.
 */
export function pushRecentChange(
  prev: RecentChange[],
  next: RecentChange,
): RecentChange[] {
  const filtered = prev.filter((c) => c.path !== next.path);
  filtered.push(next);
  if (filtered.length > RECENT_CHANGES_CAP) {
    return filtered.slice(filtered.length - RECENT_CHANGES_CAP);
  }
  return filtered;
}

/**
 * 프로젝트가 아직 아무것도 못 본 상태의 스냅샷. **상수 하나를 돌려줘야** 한다 —
 * `useSyncExternalStore` 는 `Object.is` 로 비교하므로 매번 새 `[]` 를 만들면 남의
 * 프로젝트가 push 할 때마다 무한 리렌더에 빠진다.
 */
const EMPTY: readonly RecentChange[] = Object.freeze([]);

const byProject = new Map<number, RecentChange[]>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export const recentChangesStore = {
  get(projectId: number): RecentChange[] {
    return byProject.get(projectId) ?? (EMPTY as RecentChange[]);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  push(projectId: number, next: RecentChange): void {
    byProject.set(projectId, pushRecentChange(recentChangesStore.get(projectId), next));
    emit();
  },
  /**
   * Flip one entry's `read` flag to true (diff 본문 열람 시). No-op when the
   * path isn't buffered or already read, so body re-renders don't churn.
   */
  markRead(projectId: number, path: string): void {
    const changes = recentChangesStore.get(projectId);
    const entry = changes.find((c) => c.path === path);
    if (!entry || entry.read) return;
    byProject.set(
      projectId,
      changes.map((c) => (c.path === path ? { ...c, read: true } : c)),
    );
    emit();
  },
  /**
   * 한 프로젝트의 버퍼를 비운다. `projectId` 를 생략하면 전부 — 테스트 격리용
   * (런타임에서 남의 탭 버퍼까지 지우는 호출은 이 버그의 원인 그 자체다).
   */
  clear(projectId?: number): void {
    if (projectId == null) {
      if (byProject.size === 0) return;
      byProject.clear();
      emit();
      return;
    }
    if (recentChangesStore.get(projectId).length === 0) return;
    byProject.delete(projectId);
    emit();
  },
};

/** 구독 훅 — 이 훅을 쓰는 컴포넌트만, 그것도 **자기 프로젝트**의 이벤트에 리렌더한다. */
export function useRecentChanges(projectId: number): RecentChange[] {
  const snapshot = useCallback(() => recentChangesStore.get(projectId), [projectId]);
  return useSyncExternalStore(recentChangesStore.subscribe, snapshot, snapshot);
}
