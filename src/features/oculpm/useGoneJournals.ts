import { useCallback, useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { useJournalEvents } from "./useOculpmLive";

const NONE: ReadonlySet<string> = new Set();

/**
 * 사라진 코드의 일지 — 건드린 파일이 지금 프로젝트에 하나도 없는 일지의 경로 집합.
 *
 * 목록이 이것을 날마다 한 줄로 접는다 (11-14). 일지는 지우지 않아서 쌓이고, 걷어낸 화면을
 * 고치던 일지가 지금 코드의 일지와 같은 얼굴로 서 있으면 목록은 길기만 하다. 못 읽으면 빈
 * 집합 — 접지 않을 뿐 아무것도 숨기지 않는다.
 */
export function useGoneJournals(projectId: number | null, enabled: boolean): ReadonlySet<string> {
  const [gone, setGone] = useState<ReadonlySet<string>>(NONE);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useJournalEvents(projectId, enabled, refresh);

  useEffect(() => {
    if (projectId == null || !enabled) {
      setGone(NONE);
      return;
    }
    let cancelled = false;
    void oculpmApi
      .goneJournals(projectId)
      .then((paths) => {
        if (!cancelled) setGone(new Set(paths));
      })
      .catch(() => {
        if (!cancelled) setGone(NONE);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled, tick]);

  return gone;
}
