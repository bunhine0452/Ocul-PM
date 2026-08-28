/**
 * 페인이 **에이전트 모드**인지, 그리고 지금 나를 기다리는지 판정한다
 * (2026-08-28 Phase 2 — 관제탑).
 *
 * # 왜 별도의 신호가 필요한가
 *
 * 셸 통합(OSC 133)은 "명령이 돌고 있다"까지만 안다. 그런데 `claude` 는 한 번
 * 뜨면 몇 시간이고 같은 명령으로 남아 있어서, 그 안에서 **생각 중인지 내
 * 대답을 기다리는지**는 명령 경계로 알 수 없다. 그 차이가 바로 에이전트를
 * 여러 개 돌릴 때 알고 싶은 유일한 것이다.
 *
 * 그래서 페인에서 두 가지를 더 받는다 (→ `PaneSignal`):
 *  - **alt-screen** (`buffer.onBufferChange`) — 전체화면 TUI 에 들어가 있는가.
 *    블록이 무의미하고 관제탑이 필요한 구간이 정확히 여기다.
 *  - **BEL** (`term.onBell`) 과 **마지막 출력 시각** — 기다림의 근거.
 *
 * # 정직성
 *
 * 두 근거의 확실성이 다르다. 벨은 프로그램이 **직접** 부른 것이라 확실하고,
 * "출력이 멈춘 지 오래됐다"는 **추정**이다 (오래 생각하는 중일 수도 있다).
 * 그래서 `reason` 을 함께 돌려주고, UI 는 추정을 추정이라고 말해야 한다.
 * 둘을 같은 배지로 그리면 "기다린다"는 표시를 아무도 안 믿게 된다.
 */
import { detectAgent, type AgentRun } from "./agentDetect";
import type { ShellState } from "./oscShell";

/** 벨 뒤 이 시간 안의 출력은 "벨에 딸린 것"으로 본다 (벨 자체가 스트림에 실려 온다). */
const BELL_GRACE_MS = 500;

/**
 * alt-screen 에이전트의 출력이 이만큼 멈추면 기다린다고 **추정**한다.
 *
 * 20초인 이유: 코딩 에이전트는 생각하는 동안 스피너를 돌려 출력이 계속
 * 흐른다. 진짜로 멈추는 건 사람 차례가 됐을 때다. 그래도 스피너 없이 조용히
 * 생각하는 도구가 있으므로 이 판정은 끝까지 추정으로 남는다.
 */
const IDLE_GUESS_MS = 20_000;

/** 페인이 xterm 에서 직접 관찰한 것. 셸 통합과 독립이다. */
export interface PaneSignal {
  /** 전체화면 TUI(alternate buffer) 안에 있는가. */
  altScreen: boolean;
  /** 마지막 출력 시각(ms). 0 = 아직 아무 출력도 없었다. */
  lastOutputAt: number;
  /** 마지막 BEL 시각(ms). null = 운 적 없다. */
  bellAt: number | null;
}

export const emptyPaneSignal: PaneSignal = {
  altScreen: false,
  lastOutputAt: 0,
  bellAt: null,
};

/** 왜 "기다린다"고 판단했는가. `bell` 은 확실, `idle` 은 추정. */
export type WaitReason = "bell" | "idle";

export interface AgentState {
  agent: AgentRun;
  /** 나를 기다리는가. */
  waiting: boolean;
  /** 기다린다고 본 근거. 기다리는 중이 아니면 null. */
  reason: WaitReason | null;
  /** 이 판정이 추정인가 — UI 가 말투를 바꾸는 데 쓴다. */
  guess: boolean;
  /** 실행 시작 시각(ms) — 경과 시간 표시용. */
  startedAt: number;
  /** 전체화면 TUI 안인가. */
  altScreen: boolean;
}

/**
 * 이 페인이 에이전트 모드인지, 기다리는지 판정한다. 순수 함수 — `now` 주입.
 *
 * 에이전트가 돌고 있지 않으면 `null` 이다. 셸 통합이 꺼져 있으면 `shell.running`
 * 자체가 없으므로 자동으로 `null` 이 된다 — alt-screen 만 보고 "뭔가 돌고
 * 있다"고 지어내지 않는다 (`less` 도 alt-screen 이다).
 */
export function deriveAgentState(
  shell: ShellState | undefined,
  signal: PaneSignal,
  now: number,
): AgentState | null {
  const running = shell?.running;
  if (!running) return null;
  const agent = detectAgent(running.command);
  if (!agent) return null;

  const base = {
    agent,
    startedAt: running.startedAt,
    altScreen: signal.altScreen,
  };

  // ① 벨 — 프로그램이 직접 불렀고, 그 뒤로 의미 있는 출력이 없다.
  if (signal.bellAt !== null && signal.lastOutputAt - signal.bellAt <= BELL_GRACE_MS) {
    return { ...base, waiting: true, reason: "bell", guess: false };
  }

  // ② 조용함 — 전체화면 TUI 인데 출력이 멎었다. 추정이다.
  if (
    signal.altScreen &&
    signal.lastOutputAt > 0 &&
    now - signal.lastOutputAt >= IDLE_GUESS_MS
  ) {
    return { ...base, waiting: true, reason: "idle", guess: true };
  }

  return { ...base, waiting: false, reason: null, guess: false };
}

/** 지금 나를 기다리는 세션 id 들 — 레일 배지와 "다음 대기로" 이동에 쓴다. */
export function waitingIds(states: Readonly<Record<string, AgentState | null>>): string[] {
  return Object.keys(states).filter((id) => states[id]?.waiting);
}

/** 테스트·튜닝이 같은 값을 보게 노출한다. */
export const AGENT_MODE_TUNING = { BELL_GRACE_MS, IDLE_GUESS_MS } as const;
