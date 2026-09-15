// 세션 옮기기 드래그의 고스트(손에 들린 것) — `TerminalSurface.tsx` 에서 옮겨 왔다
// (2026-09-15 분할). 위치는 `useSessionMove` 가 rAF 안에서 transform 으로 직접 쓴다.
import { SquareTerminal } from "@/components/Icons";
import type { useSessionMove } from "./useSessionMove";

export interface TerminalGhostProps {
  label: string;
  ghostElRef: ReturnType<typeof useSessionMove>["ghostElRef"];
  snapGhost: ReturnType<typeof useSessionMove>["snapGhost"];
}

/** 손에 들린 것. 위치는 rAF 안에서 `transform` 으로 직접 쓴다 — 좌표를
 * 상태에 담으면 포인터마다 이 컴포넌트(살아 있는 xterm 페인 전부)가
 * 다시 그려져, 고치려던 그 무게가 그대로 돌아온다. */
export function TerminalGhost({ label, ghostElRef, snapGhost }: TerminalGhostProps) {
  return (
    <div
      className="term-ghost"
      aria-hidden="true"
      ref={(el) => {
        ghostElRef.current = el;
        // 첫 프레임부터 커서 위에 있어야 한다 — 기본 위치(0,0)에 한 번
        // 그려지면 왼쪽 위에서 날아오는 것처럼 보인다. 태어날 때만은
        // 따라붙기(감쇠)를 건너뛰고 손 밑에 바로 놓는다.
        if (el) snapGhost();
      }}
    >
      <SquareTerminal size={13} />
      <span className="tg-name">{label}</span>
    </div>
  );
}
