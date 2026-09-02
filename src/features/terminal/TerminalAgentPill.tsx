import { AgentMark } from "@/components/AgentMark";
import { useT } from "@/i18n";
import { deriveAgentState, emptyPaneSignal, type PaneSignal } from "./agentMode";
import { formatElapsed } from "./railModel";
import { useSecondTick } from "./useSecondTick";
import type { ShellState } from "./oscShell";

// 페인 위 에이전트 표시 (2026-08-28 Phase 2).
//
// # 왜 크롬을 바꾸지 않고 떠 있는 알약인가
//
// 처음 생각은 페인 위에 얇은 헤더 줄을 붙이는 것이었다. 그런데 헤더가 생기면
// 페인 높이가 줄고 → xterm 이 refit 하고 → PTY 가 resize 된다. 에이전트가
// 뜨고 질 때마다 전체화면 TUI 가 통째로 다시 그려진다는 뜻이다. 그래서
// **레이아웃을 건드리지 않는** 절대 위치 알약으로 간다 — 몇 글자를 덮지만
// 화면이 흔들리지 않는다.
//
// # 시계를 여기 가두는 이유
//
// "기다린다"의 추정 근거는 *출력이 멎은 지 얼마나 됐나* 라서 시간이 흐르는
// 것만으로 상태가 바뀐다. 이 판정을 `TerminalSurface` 에서 하면 1초마다 페인
// 트리 전체가 재렌더된다. 판정과 시계를 함께 이 작은 컴포넌트에 가둔다.

export interface TerminalAgentPillProps {
  shell: ShellState | undefined;
  signal: PaneSignal | undefined;
}

export function TerminalAgentPill({ shell, signal }: TerminalAgentPillProps) {
  const { t } = useT();
  // 에이전트가 도는 동안에만 시계를 켠다 — 판정에도, 경과 표시에도 쓴다.
  const running = shell?.running != null;
  const now = useSecondTick(running);
  const state = deriveAgentState(shell, signal ?? emptyPaneSignal, now);
  if (!state) return null;

  const phase = state.waiting
    ? state.guess
      ? t("term.wait.guess")
      : t("term.wait.bell")
    : t("term.tone.running");

  return (
    <>
      {/* 기다리는 동안에는 페인 위 가장자리 띠도 갈아입는다. 셸 상태에서
          파생된 `data-tone` 띠 위에 덧그린다 — 저쪽을 여기서 바꾸려면 판정을
          다시 위로 올려야 하고, 그러면 1초 재렌더가 페인 트리로 돌아온다. */}
      {state.waiting ? <span className="term-agent-band" aria-hidden="true" /> : null}
      <div
        className={"term-agent-pill" + (state.waiting ? " waiting" : "")}
        role="status"
        aria-live="polite"
      >
        <AgentMark agentId={state.agent.id} size={12} aria-hidden="true" />
        <span className="tap-name">{state.agent.label}</span>
        <span className="tap-sep" aria-hidden="true">
          ·
        </span>
        <span className="tap-phase">{phase}</span>
        <span className="tap-elapsed">{formatElapsed(Math.max(0, now - state.startedAt))}</span>
      </div>
    </>
  );
}
