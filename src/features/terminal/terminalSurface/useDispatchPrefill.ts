// IN2 디스패치 프리필 펌프 — `TerminalSurface.tsx` 에서 옮겨 왔다 (2026-09-15 분할).
// 대기 중인 디스패치를 활성 페인 PTY 에 써 두는 재시도 체인. 동작·순서 불변.
import { useEffect, useRef } from "react";
import {
  consumePendingDispatch,
  hasPendingDispatchFor,
  peekPendingDispatch,
  subscribePendingDispatch,
} from "../dispatchBus";
import { writeDispatchTo } from "../dispatchTarget";

/**
 * 돌려주는 ref 에 본체가 **활성 페인 sid** 를 매 렌더 써 넣는다 — 펌프는 그
 * 값을 tick 시점에 읽는다 (아래 "sid 는 ref 로 최신을 읽는다").
 */
export function useDispatchPrefill(projectId: number | null) {
  // IN2 — 디스패치 프리필: 대기 중인 건을 활성 페인 PTY 에 써 둔다 (개행 없음
  // — 실행은 사용자가 Enter 로). sid 는 ref 로 최신을 읽는다 — deps 재실행(탭
  // 생성·라벨 갱신)이 재시도 체인을 취소하면 이미 consume 된 상태라 프리필이
  // 조용히 증발했었다. consume 은 쓰기 **성공 후에만**.
  //
  // 여기까지 오는 건 "생산자가 썼을 때 아직 셸이 없었다" 는 경우뿐이다 —
  // 살아있는 셸이면 생산자(`handoffDispatch`)가 그 자리에 직접 꽂는다. 그래서
  // 마운트 시점 한 번 + **대기열 구독** 둘 다 필요하다: 도크를 열어 둔 채
  // 셸이 뜨기 전에 디스패치하면 마운트는 이미 지나가 있다.
  const dispatchSidRef = useRef<string | null>(null);
  const dispatchBusyRef = useRef(false);
  // 대기 건의 주인만 집는다. 크롬식 탭에선 터미널 면이 탭마다 살아 있어(도크를
  // 열어 둔 탭 + 터미널 화면인 탭), 주인을 안 보면 남의 프로젝트 면이 먼저
  // 집어 그 셸(cwd = 남의 루트)에 프리필한다. ref 로 읽는 이유는 아래 pump 가
  // deps `[]` 로 한 번만 서기 때문 (sid 와 같은 이유).
  const dispatchProjectRef = useRef(projectId);
  dispatchProjectRef.current = projectId;
  useEffect(() => {
    let disposed = false;
    const pump = () => {
      if (disposed || dispatchBusyRef.current) return;
      if (!hasPendingDispatchFor(dispatchProjectRef.current)) return;
      dispatchBusyRef.current = true;
      let tries = 0;
      const stop = () => {
        dispatchBusyRef.current = false;
      };
      const retry = () => {
        if (tries++ < 50) setTimeout(tick, 300);
        else stop();
      };
      const tick = () => {
        if (disposed) return stop();
        const pending = peekPendingDispatch();
        const sid = dispatchSidRef.current;
        if (!pending) return stop();
        // 재시도하는 동안 주인이 다른 건으로 교체됐을 수 있다 (슬롯은 하나,
        // 마지막 의도가 이긴다) — 매 tick 다시 확인한다.
        if (!hasPendingDispatchFor(dispatchProjectRef.current)) return stop();
        if (!sid) return retry();
        void writeDispatchTo(sid, pending)
          .then((done) => {
            if (!done) return retry();
            consumePendingDispatch();
            stop();
          })
          .catch(retry);
      };
      tick();
    };
    pump();
    const off = subscribePendingDispatch(pump);
    return () => {
      disposed = true;
      off();
    };
  }, []);
  return dispatchSidRef;
}
