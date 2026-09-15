// git 거터 (#git-gutter) — 버퍼 기준 줄 변경 표식과 그 디바운스.
// `CodePane.tsx` 에서 그대로 들어냈다 (순수 이동, 동작 변경 없음).
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

import { commands, type GitLineChange } from "@/lib/bindings";

/** 거터 갱신 디바운스. 타자마다 `git show` 를 부를 수는 없다. */
const GUTTER_DEBOUNCE_MS = 500;

// 저장이 아니라 **버퍼**를 기준으로 본다 — 고치는 즉시 거터가 따라와야
// 쓸모가 있다. 타자마다 git 을 부를 수는 없으므로 디바운스한다.
export function useGitGutter(projectId: number, pathRef: React.RefObject<string | null>) {
  const [gitChanges, setGitChanges] = useState<GitLineChange[]>([]);
  const gutterTimerRef = useRef<number | null>(null);
  const refreshGutter = useCallback(
    (text: string, immediate = false) => {
      const path = pathRef.current;
      if (!path) return;
      if (gutterTimerRef.current != null) window.clearTimeout(gutterTimerRef.current);
      const run = () => {
        gutterTimerRef.current = null;
        void commands.gitLineChanges(projectId, path, text).then((res) => {
          // 그 사이 다른 파일로 옮겼으면 버린다 — 늦게 온 응답이 남의 파일
          // 거터를 그리면 줄이 통째로 어긋나 보인다.
          if (pathRef.current !== path) return;
          setGitChanges(res.status === "ok" ? res.data : []);
        });
      };
      if (immediate) run();
      else gutterTimerRef.current = window.setTimeout(run, GUTTER_DEBOUNCE_MS);
    },
    [projectId, pathRef],
  );
  useEffect(
    () => () => {
      if (gutterTimerRef.current != null) window.clearTimeout(gutterTimerRef.current);
    },
    [],
  );

  return { gitChanges, setGitChanges, refreshGutter };
}
