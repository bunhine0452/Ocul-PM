import { useCallback, useEffect } from "react";
import { safeUnlisten } from "@/lib/unlisten";
import { useRefetchOnWake } from "@/lib/useRefetchOnWake";
import { events, type OculpmDataArea } from "@/lib/bindings";

// 워처가 `.oculpm/` 안의 변경을 감지해 이벤트를 쏘면 그 화면이 스스로 다시
// 읽게 하는 훅 모음. 이게 없으면 화면은 마운트 때 읽은 내용에 머물고, 외부
// 에이전트가 파일을 만들거나 고치거나 지워도 사용자가 직접 새로고침해야
// 보인다 — 이 앱에서 가장 흔한 "왜 안 바뀌지" 의 정체다.

/** 한 프로젝트로 필터할 수 있는 백엔드 이벤트 채널. */
type ProjectEvent<P extends { project_id: number }> = {
  listen: (cb: (e: { payload: P }) => void) => Promise<() => void>;
};

/** 이벤트 폭풍(한 번의 저장이 여러 fs 이벤트가 되는 것)을 한 번의 재조회로 접는다. */
const COALESCE_MS = 250;

/**
 * `channels` 중 하나라도 이 프로젝트에 대해 발화하면 `onChange` 를 부른다
 * (250ms 병합). 창 복귀 시에도 한 번 부른다.
 *
 * `channels` 는 **모듈 스코프 상수 배열**로 넘겨야 한다 — 렌더마다 새 배열을
 * 만들면 이펙트가 매번 구독을 끊었다 다시 맺는다.
 */
function useOculpmEventRefresh<P extends { project_id: number }>(
  channels: readonly ProjectEvent<P>[],
  projectId: number | null,
  enabled: boolean,
  onChange: () => void,
  accept?: (payload: P) => boolean,
): void {
  useEffect(() => {
    if (!enabled || projectId == null) return;
    let active = true;
    let timer: number | null = null;
    const schedule = () => {
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        onChange();
      }, COALESCE_MS);
    };
    const offs: Array<() => void> = [];
    for (const channel of channels) {
      // 방어적: jsdom / 비-Tauri 컨텍스트에는 이벤트 채널이 없다. 삼켜서
      // unhandled rejection 을 막고, UI 는 라이브 갱신만 없는 상태로 둔다
      // (마운트 시 조회는 그대로 동작).
      try {
        void channel
          .listen((e) => {
            if (e.payload.project_id !== projectId) return;
            if (accept && !accept(e.payload)) return;
            schedule();
          })
          .then((off) => {
            if (active) offs.push(off);
            else safeUnlisten(off);
          })
          .catch(() => {});
      } catch {
        /* event channel unavailable */
      }
    }
    return () => {
      active = false;
      if (timer != null) window.clearTimeout(timer);
      offs.forEach(safeUnlisten);
    };
  }, [channels, projectId, enabled, onChange, accept]);

  useRefetchOnWake(onChange, enabled && projectId != null);
}

const JOURNAL_CHANNELS: readonly ProjectEvent<{ project_id: number }>[] = [
  events.oculpmJournalAdded,
  events.oculpmJournalUpdated,
  events.oculpmJournalPathChanged,
];

const DATA_CHANNELS = [events.oculpmDataChanged] as const;

/** 작업 일지가 추가/변경/삭제되면 `onChange` 를 부른다 (250ms 병합). */
export function useJournalEvents(
  projectId: number | null,
  enabled: boolean,
  onChange: () => void,
): void {
  useOculpmEventRefresh(JOURNAL_CHANNELS, projectId, enabled, onChange);
}

/**
 * 계획(`.oculpm/planner/`) 또는 논의(`.oculpm/discussion/`) 파일이 디스크에서
 * 바뀌면 `onChange` 를 부른다 (250ms 병합).
 *
 * 두 영역은 SQLite 캐시를 쓰지 않고 읽을 때마다 파일에서 다시 투영하므로,
 * 이벤트가 오면 곧바로 다시 조회하면 된다 — 캐시 갱신을 기다릴 것이 없다.
 */
export function useOculpmDataEvents(
  area: OculpmDataArea,
  projectId: number | null,
  enabled: boolean,
  onChange: () => void,
): void {
  const accept = useCallback(
    (payload: { area: OculpmDataArea }) => payload.area === area,
    [area],
  );
  useOculpmEventRefresh(DATA_CHANNELS, projectId, enabled, onChange, accept);
}
