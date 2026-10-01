// 워크스페이스 진단 모으기 (#p5-problems) — 리스너를 먼저 걸고 스냅샷을 부른다.
// `CodeScreenV2` 에서 그대로 들어냈다 (optimization-round-2 {#split-codescreen}) — 동작 불변.
import { useEffect } from "react";

import { lspApi } from "@/api/lsp";
import { safeUnlisten } from "@/lib/unlisten";

import { problemsStore } from "../problemsStore";

/**
 * 구독은 **창 최상위가 아니라 이 화면**이 한다 — 코드 화면을 한 번도 안 연
 * 창이 진단을 메모리에 쌓을 이유가 없다. 순서가 중요하다: 리스너를 먼저 걸고
 * 스냅샷을 부른다. 반대로 하면 그 사이에 온 갱신이 통째로 빈다.
 */
export function useProblemsFeed(projectId: number): void {
  useEffect(() => {
    const offs: Array<() => void> = [];
    let active = true;
    const keep = (off: () => void) => (active ? offs.push(off) : safeUnlisten(off));
    // jsdom / 비-Tauri 에서는 래퍼가 빈 해제 함수를 준다 — 라이브 갱신만 없다.
    void lspApi
      .onDiagnostics((payload) => {
        if (payload.project_id !== projectId) return;
        problemsStore.applyPublished(payload);
      })
      .then(keep);
    lspApi.diagnosticsSnapshot(projectId).then(
      (snapshot) => {
        if (!active || !Array.isArray(snapshot)) return;
        problemsStore.seed(projectId, snapshot);
      },
      () => {},
    );
    return () => {
      active = false;
      for (const off of offs) safeUnlisten(off);
      // 프로젝트를 바꾸면 비운다 — 안 하면 남의 프로젝트 진단이 섞인다.
      problemsStore.clearProject(projectId);
    };
  }, [projectId]);
}
