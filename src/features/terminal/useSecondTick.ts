import { useEffect, useState } from "react";

/**
 * 1초 시계 (2026-08-28).
 *
 * 라이브 경과 시간("4:12")을 그리는 두 곳 — 세로 세션 레일과 상태바 — 이
 * 쓴다. 훅을 **소비하는 작은 컴포넌트 안에** 두는 게 요점이다: `TerminalSurface`
 * 에 두면 1초마다 페인 트리 전체가 다시 렌더된다.
 *
 * 돌고 있는 게 없으면 타이머 자체를 걸지 않는다 — 유휴 상태의 터미널이 초당
 * 한 번씩 앱을 깨우면 배터리로 돌아온다.
 */
export function useSecondTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}
