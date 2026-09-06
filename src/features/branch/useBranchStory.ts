import { useCallback, useEffect, useMemo, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import type { BranchRef, BranchStory } from "@/lib/bindings";
import { useJournalEvents, useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";

// 브랜치 이야기의 데이터 층 (v3-surface {#branch-story-view}).
//
// 화면에서 떼어 낸 이유는 하나다 — 이 화면의 어려움은 **그리기**가 아니라
// "브랜치 목록과 이야기가 서로 다른 속도로 도착한다" 는 데 있다. 목록은
// 프로젝트마다 한 번, 이야기는 고른 브랜치마다 다시. 두 비행을 컴포넌트 몸통에
// 섞으면 취소 처리가 조건문 사이로 흩어진다.

export interface BranchStoryState {
  branches: BranchRef[];
  story: BranchStory | null;
  /** 사용자가 고른 브랜치. `null` = 현재 체크아웃된 것을 백엔드가 고른다. */
  picked: string | null;
  loading: boolean;
  error: string | null;
  pick: (name: string | null) => void;
  reload: () => void;
}

export function useBranchStory(projectId: number, active: boolean): BranchStoryState {
  const [branches, setBranches] = useState<BranchRef[]>([]);
  const [story, setStory] = useState<BranchStory | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // 프로젝트가 바뀌면 고른 브랜치는 의미를 잃는다 — 남의 저장소 이름이다.
  useEffect(() => setPicked(null), [projectId]);

  // 일지가 디스크에서 바뀌면 귀속이 바뀌고, 플래너가 바뀌면 연결된 항목이
  // 바뀐다. 둘 다 듣는다 — 이 화면은 두 원장을 한 좌표로 합친 곳이다.
  useJournalEvents(projectId, active, reload);
  useOculpmDataEvents("planner", projectId, active, reload);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [refs, next] = await Promise.all([
          oculpmApi.branchList(projectId, 100),
          oculpmApi.branchStory(projectId, picked, null),
        ]);
        if (!alive) return;
        setBranches(refs);
        setStory(next);
      } catch (e) {
        if (!alive) return;
        setStory(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, picked, nonce, active]);

  const pick = useCallback((name: string | null) => setPicked(name), []);

  return useMemo(
    () => ({ branches, story, picked, loading, error, pick, reload }),
    [branches, story, picked, loading, error, pick, reload],
  );
}
