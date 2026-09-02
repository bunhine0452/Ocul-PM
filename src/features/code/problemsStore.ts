// 문제 패널 (B6) — 워크스페이스 진단의 프런트 스토어.
//
// 설계 SSOT: docs/20260902_vscode-borrows/05-problems.md
//
// **백엔드에 워크스페이스 진단 저장소를 새로 만들지 않았다.** `raw_diagnostics`
// 는 코드 액션용이라 문서를 닫으면 사라지고 프로젝트 축도 없다. 그걸 문제
// 패널의 SSOT 로 승격하면 수명·소유권을 다시 설계해야 하는데, 얻는 것은 "앱을
// 껐다 켜도 진단이 남는다" 뿐이고 그건 사실 거짓말이다 — 서버를 다시 띄우면
// 진단은 어차피 다시 온다.
//
// 프로젝트별 버킷인 이유는 `indexProgressStore` 와 같다: 크롬식 탭이 프로젝트를
// 동시에 열 수 있는데 이 모듈은 창에 하나다. 슬롯이 하나면 남의 프로젝트 진단이
// 섞이고, 한쪽의 정리가 다른 쪽 목록을 지운다.
import { useCallback, useSyncExternalStore } from "react";

import { createStore } from "@/lib/createStore";
import type { LspDiagnostic, LspDiagnosticsPublished, LspFileDiagnostics } from "@/lib/bindings";

/** 경로 → 그 파일의 진단. 빈 파일은 담지 않는다 (빈 카드가 서지 않게). */
export type ProjectProblems = ReadonlyMap<string, LspDiagnostic[]>;

/** 없는 프로젝트가 늘 같은 것을 돌려주도록 — `useSyncExternalStore` 의 계약. */
const EMPTY: ProjectProblems = new Map();

const store = createStore<ReadonlyMap<number, ProjectProblems>>(new Map());

/**
 * 이벤트가 한 번이라도 말을 얹은 경로 (프로젝트별).
 *
 * `seed` 가 이걸 본다. 맵에 **없다**는 것만으로는 "아직 못 들었다" 와 "방금
 * 고쳐서 지웠다" 를 구별할 수 없어서, 뒤늦게 도착한 스냅샷이 방금 고친 파일을
 * 되살린다 (그 파일은 이제 진단이 없으니 서버가 다시 말해 주지도 않는다).
 */
const touched = new Map<number, Set<string>>();

function markTouched(projectId: number, path: string): void {
  const set = touched.get(projectId);
  if (set) set.add(path);
  else touched.set(projectId, new Set([path]));
}

function writeProject(
  projectId: number,
  mutate: (draft: Map<string, LspDiagnostic[]>) => boolean,
): void {
  store.update((prev) => {
    const draft = new Map(prev.get(projectId) ?? EMPTY);
    if (!mutate(draft)) return prev; // 참조 그대로 → 구독자 조용
    return new Map(prev).set(projectId, draft);
  });
}

export const problemsStore = {
  /**
   * 서버가 밀어 준 한 파일의 진단. **빈 배열은 삭제**다 — 서버는 다 고친 파일에
   * 빈 배열을 보내 "이제 없다" 를 말한다.
   */
  applyPublished(event: LspDiagnosticsPublished): void {
    markTouched(event.project_id, event.path);
    writeProject(event.project_id, (draft) => {
      if (event.diagnostics.length === 0) return draft.delete(event.path);
      draft.set(event.path, event.diagnostics);
      return true;
    });
  },

  /**
   * 초기 스냅샷을 채운다 — **이미 있는 경로는 건드리지 않는다.**
   *
   * 구독을 먼저 걸고 커맨드를 부르므로, 스냅샷이 돌아오는 사이에 온 이벤트가
   * 더 새 것이다. 덮어쓰면 방금 고친 파일이 목록에 되살아난다 — 지운 경로까지
   * 기억해 두는 이유가 그것이다 (`touched`).
   */
  seed(projectId: number, files: LspFileDiagnostics[]): void {
    const heard = touched.get(projectId);
    writeProject(projectId, (draft) => {
      let changed = false;
      for (const file of files) {
        if (draft.has(file.path) || heard?.has(file.path) || file.diagnostics.length === 0) continue;
        draft.set(file.path, file.diagnostics);
        changed = true;
      }
      return changed;
    });
  },

  /** 프로젝트 전환·서버 중지. 안 하면 남의 프로젝트 진단이 섞인다. */
  clearProject(projectId: number): void {
    touched.delete(projectId);
    store.update((prev) => {
      if (!prev.has(projectId)) return prev;
      const next = new Map(prev);
      next.delete(projectId);
      return next;
    });
  },

  get(projectId: number): ProjectProblems {
    return store.get().get(projectId) ?? EMPTY;
  },

  subscribe: store.subscribe,

  /** 테스트 격리 전용. */
  _reset(): void {
    touched.clear();
    store.set(new Map());
  },
};

/** 이 프로젝트의 진단. 참조는 그 프로젝트가 바뀔 때만 바뀐다. */
export function useProblems(projectId: number): ProjectProblems {
  const snapshot = useCallback(() => problemsStore.get(projectId), [projectId]);
  return useSyncExternalStore(problemsStore.subscribe, snapshot, snapshot);
}
