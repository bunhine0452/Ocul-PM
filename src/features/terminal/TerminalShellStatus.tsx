import { summarizeShell } from "./shellStatus";
import { formatElapsed } from "./railModel";
import { useSecondTick } from "./useSecondTick";
import type { ShellState } from "./oscShell";

// 상태바 가운데 칸 — 포커스된 페인에서 **지금 무슨 일이 일어나는지** (2026-08-28).
//
// 별도 컴포넌트인 이유는 시계다. 실행 중에는 1초마다 다시 그려야 하는데,
// 이걸 `TerminalSurface` 에 두면 초당 한 번 페인 트리 전체가 재렌더된다.
//
// 통합이 꺼진 세션에서는 **아무것도 그리지 않는다** — 꺼진 기능을 켜진 것처럼
// 보이게 하느니 빈 자리가 낫다 (`summarizeShell` 이 null 을 준다).

export function TerminalShellStatus({ shell }: { shell: ShellState | undefined }) {
  const running = shell?.running ?? null;
  const now = useSecondTick(running !== null);
  const summary = shell ? summarizeShell(shell) : null;
  if (!summary) return null;
  return (
    <span className="ts-seg ts-live" title={shell?.cwd ?? undefined} aria-live="polite">
      <span className={"ts-dot tone-" + summary.tone} aria-hidden="true" />
      <span className="ts-live-text">{summary.text}</span>
      {running ? (
        <span className="ts-elapsed">{formatElapsed(Math.max(0, now - running.startedAt))}</span>
      ) : null}
    </span>
  );
}
