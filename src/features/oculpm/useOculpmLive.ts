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

/** 일지 사건 셋의 페이로드 — 더함 · 고침은 요약을, 경로 바뀜은 경로를 싣는다. */
type JournalPayload = { project_id: number; summary?: { relative_path?: string }; relative_path?: string };

const ENTRY_CHANNELS = JOURNAL_CHANNELS as readonly ProjectEvent<JournalPayload>[];

/**
 * 사건이 가리키는 일지 — 일지 루트 기준 경로(`20261122/Bugs/0314_bug_x.md`). 요약의 경로는 이미 그 꼴이고,
 * 늦게 끝난 diff 캡처가 쏘는 경로 바뀜은 `.oculpm/journal/…` 접두를 단다. 모르면 `null`.
 */
export function journalEventPath(payload: JournalPayload): string | null {
  const raw = payload.summary?.relative_path ?? payload.relative_path;
  if (typeof raw !== "string" || raw === "") return null;
  return raw.replace(/\\/g, "/").replace(/^\.oculpm\//, "").replace(/^journal\//, "");
}

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
 * **이 일지**가 바뀌었을 때만 `onChange` 를 부른다 (250ms 병합) — 열어 둔 일지 상세의 다시 읽기 (11-22).
 *
 * 상세는 프로젝트의 어느 일지가 바뀌든 본문과 diff 를 다시 읽었다. 에이전트 여럿이 일지를 쓰는 날에는 읽고
 * 있는 일지와 상관없는 사건마다 IPC 둘(본문 · 기록된 diff 전부)이 갔다. 사건은 어느 일지인지를 싣고 온다
 * (`journalEventPath`) — 그 일지가 아니면 듣지 않는다. 경로를 못 읽은 사건은 예전처럼 다시 읽는다(모르는 것을
 * 「상관없다」 고 하지 않는다). 창으로 돌아올 때의 다시 읽기는 그대로다.
 */
export function useJournalEntryEvents(
  projectId: number | null,
  relativePath: string,
  enabled: boolean,
  onChange: () => void,
): void {
  const accept = useCallback(
    (payload: JournalPayload) => {
      const path = journalEventPath(payload);
      return path == null || path === relativePath;
    },
    [relativePath],
  );
  useOculpmEventRefresh(ENTRY_CHANNELS, projectId, enabled, onChange, accept);
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
