// 「현재 세션」 — 열 때 묻고, 이벤트로 바꾼다 (review-2026-10-09 {#seeded-event}).
//
// 예전엔 `OculpmSessionStarted`·`Ended` 이벤트로만 세웠다. 그래서 창을 열 때 이미 돌던
// 세션이 「없음」 으로 보였고, 명령 팔레트의 「세션 끝내기」 가 「활성 세션 없음」 이라고
// 답했다 — 그 세션의 시작 이벤트는 창이 생기기 전에 지나갔다.

import type { Session } from "@/lib/bindings";
import { sessionApi } from "@/api/session";
import { useSeededEvent } from "@/hooks/useSeededEvent";

export function useCurrentSession(
  projectId: number | null,
  oculpmEnabled: boolean,
  setCurrentSession: (session: Session | null) => void,
): void {
  useSeededEvent<Session | null>(
    {
      // 추적 전 프로젝트는 매니저에 없다 — 물을 대상이 생기면(enabled) 다시 묻는다.
      seed: projectId != null && oculpmEnabled ? () => sessionApi.current(projectId) : null,
      subscribe: (touch) => [
        sessionApi.onStarted((payload) => {
          if (payload.project_id !== projectId) return;
          touch();
          setCurrentSession(payload.session);
        }),
        sessionApi.onEnded((payload) => {
          if (payload.project_id !== projectId) return;
          touch();
          setCurrentSession(null);
        }),
      ],
      onSeed: (session, touched) => {
        if (!touched()) setCurrentSession(session);
      },
    },
    [projectId, oculpmEnabled, setCurrentSession],
  );
}
