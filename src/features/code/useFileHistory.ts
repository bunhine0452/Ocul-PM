// 열린 파일의 로컬 히스토리 목록 — 브레드크럼 시계 칩의 데이터원.
//
// 캡처는 **워처**가 한다 (사람이 쓰든 에이전트가 쓰든 그 한 곳을 지난다).
// 그래서 프런트가 판이 늘어난 것을 아는 길은 두 가지뿐이다: 파일 변경
// 이벤트를 보고 잠깐 뒤에 다시 묻거나, 팝오버를 열 때 다시 묻거나. 캡처가
// 이벤트 뒤에 fire-and-forget 으로 돌기 때문에 **곧바로** 물으면 방금 그 판이
// 아직 없다 — 그래서 지연 갱신을 따로 둔다.
import { useCallback, useEffect, useRef, useState } from "react";

import { codeHistoryApi, type CodeHistoryVersion } from "@/api/codeHistory";

/** 워처 이벤트 뒤 다시 묻기까지의 지연. 캡처는 디바운스 뒤 한 번에 끝난다. */
export const HISTORY_REFRESH_DELAY_MS = 700;

export function useFileHistory(projectId: number, path: string | null, enabled: boolean) {
  const [versions, setVersions] = useState<CodeHistoryVersion[]>([]);
  const pathRef = useRef(path);
  pathRef.current = path;
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const target = pathRef.current;
    if (!enabled || !target) {
      setVersions([]);
      return;
    }
    try {
      const list = await codeHistoryApi.list(projectId, target);
      // 물어본 사이에 다른 파일로 옮겼으면 버린다.
      if (pathRef.current !== target) return;
      // 배열이 아니면 빈 목록으로 — 칩의 개수는 이 값을 그대로 믿는다.
      setVersions(Array.isArray(list) ? list : []);
    } catch {
      // 목록을 못 읽는 것은 조용한 실패로 충분하다 — 칩이 안 뜰 뿐이다.
      if (pathRef.current === target) setVersions([]);
    }
  }, [projectId, enabled]);

  /** 워처가 뭔가 바뀌었다고 알린 뒤 — 캡처가 끝날 시간을 주고 다시 묻는다. */
  const refreshSoon = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void refresh();
    }, HISTORY_REFRESH_DELAY_MS);
  }, [refresh]);

  useEffect(() => {
    setVersions([]);
    void refresh();
  }, [path, refresh]);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const forget = useCallback(async () => {
    const target = pathRef.current;
    if (!target) return;
    await codeHistoryApi.forget(projectId, target);
    if (pathRef.current === target) setVersions([]);
  }, [projectId]);

  return { versions, refresh, refreshSoon, forget };
}
