import { describe, expect, test } from "vitest";
import {
  AGENT_MODE_TUNING,
  deriveAgentState,
  emptyPaneSignal,
  waitingIds,
  type AgentState,
  type PaneSignal,
} from "@/features/terminal/agentMode";
import { buildRailItem, waitingItems, type RailItem } from "@/features/terminal/railModel";
import { initialShellState, type ShellState } from "@/features/terminal/oscShell";

// 에이전트 관제탑(2026-08-28 Phase 2)의 판정. 여기가 틀리면 "기다린다"는 표시를
// 아무도 안 믿게 되므로, **거짓 양성**을 특히 촘촘히 덮는다.

const { IDLE_GUESS_MS, BELL_GRACE_MS } = AGENT_MODE_TUNING;

const shellRunning = (command: string, startedAt = 1_000): ShellState => ({
  ...initialShellState,
  active: true,
  running: { command, startedAt },
});

const signal = (over: Partial<PaneSignal> = {}): PaneSignal => ({ ...emptyPaneSignal, ...over });

describe("deriveAgentState — 에이전트 모드인가", () => {
  test("셸 통합이 없으면 alt-screen 만으로 지어내지 않는다", () => {
    expect(deriveAgentState(undefined, signal({ altScreen: true }), 9_999)).toBeNull();
  });

  test("에이전트가 아닌 명령은 alt-screen 이어도 아니다 (less 도 alt-screen 이다)", () => {
    const state = deriveAgentState(shellRunning("less README.md"), signal({ altScreen: true }), 0);
    expect(state).toBeNull();
  });

  test("에이전트가 돌면 모드로 들어간다", () => {
    const state = deriveAgentState(shellRunning("claude --resume"), signal(), 5_000);
    expect(state?.agent.id).toBe("claude-code");
    expect(state?.startedAt).toBe(1_000);
    expect(state?.waiting).toBe(false);
  });
});

describe("deriveAgentState — 기다림 판정", () => {
  test("벨이 울리고 그 뒤로 출력이 없으면 확실한 대기다", () => {
    const state = deriveAgentState(
      shellRunning("claude"),
      signal({ altScreen: true, bellAt: 5_000, lastOutputAt: 5_000 }),
      5_100,
    );
    expect(state?.waiting).toBe(true);
    expect(state?.reason).toBe("bell");
    expect(state?.guess).toBe(false);
  });

  test("벨 직후 유예 안의 출력은 벨에 딸린 것으로 본다", () => {
    const at = signal({ bellAt: 5_000, lastOutputAt: 5_000 + BELL_GRACE_MS });
    expect(deriveAgentState(shellRunning("claude"), at, 6_000)?.reason).toBe("bell");
  });

  test("벨 뒤에 출력이 다시 흐르면 대기가 풀린다", () => {
    const after = signal({ bellAt: 5_000, lastOutputAt: 5_000 + BELL_GRACE_MS + 1 });
    expect(deriveAgentState(shellRunning("claude"), after, 6_000)?.waiting).toBe(false);
  });

  test("alt-screen 에서 출력이 오래 멎으면 대기로 **추정**한다", () => {
    const quiet = signal({ altScreen: true, lastOutputAt: 1_000 });
    const state = deriveAgentState(shellRunning("claude"), quiet, 1_000 + IDLE_GUESS_MS);
    expect(state?.waiting).toBe(true);
    expect(state?.reason).toBe("idle");
    expect(state?.guess).toBe(true);
  });

  test("문턱 직전은 아직 실행 중이다", () => {
    const quiet = signal({ altScreen: true, lastOutputAt: 1_000 });
    expect(deriveAgentState(shellRunning("claude"), quiet, 1_000 + IDLE_GUESS_MS - 1)?.waiting).toBe(
      false,
    );
  });

  test("alt-screen 이 아니면 조용해도 추정하지 않는다 — 그냥 오래 도는 명령일 수 있다", () => {
    const quiet = signal({ altScreen: false, lastOutputAt: 1_000 });
    expect(deriveAgentState(shellRunning("claude"), quiet, 10_000_000)?.waiting).toBe(false);
  });

  test("출력이 한 번도 없었으면(lastOutputAt=0) 추정하지 않는다 — 방금 뜬 것뿐이다", () => {
    const fresh = signal({ altScreen: true, lastOutputAt: 0 });
    expect(deriveAgentState(shellRunning("claude"), fresh, 10_000_000)?.waiting).toBe(false);
  });
});

describe("waitingIds", () => {
  test("기다리는 것만 고른다", () => {
    const states: Record<string, AgentState | null> = {
      a: { waiting: true } as AgentState,
      b: { waiting: false } as AgentState,
      c: null,
    };
    expect(waitingIds(states)).toEqual(["a"]);
  });
});

describe("railModel — 기다림이 카드에 실린다", () => {
  const waitingState = (guess: boolean): AgentState => ({
    agent: { id: "claude-code", label: "Claude Code" },
    waiting: true,
    reason: guess ? "idle" : "bell",
    guess,
    startedAt: 1_000,
    altScreen: true,
  });

  test("기다림은 실행 중 톤을 덮는다", () => {
    const item = buildRailItem(
      {
        id: "t1",
        label: "zsh",
        shell: shellRunning("claude"),
        agentState: waitingState(false),
        paneCount: 1,
      },
      2_000,
    );
    expect(item.tone).toBe("waiting");
    expect(item.waiting).toBe(true);
    expect(item.waitingGuess).toBe(false);
    // 실행 중인 것은 여전히 사실이므로 타이머는 계속 돈다.
    expect(item.elapsedMs).toBe(1_000);
  });

  test("추정과 확실을 다른 문구로 적는다", () => {
    const base = { id: "t1", label: "zsh", shell: shellRunning("claude"), paneCount: 1 };
    const sure = buildRailItem({ ...base, agentState: waitingState(false) }, 2_000);
    const maybe = buildRailItem({ ...base, agentState: waitingState(true) }, 2_000);
    expect(sure.detail).not.toBe(maybe.detail);
    expect(maybe.waitingGuess).toBe(true);
  });

  test("agentState 를 안 넘기면 기다림을 판정하지 않는다", () => {
    const item = buildRailItem(
      { id: "t1", label: "zsh", shell: shellRunning("claude"), paneCount: 1 },
      2_000,
    );
    expect(item.waiting).toBe(false);
    expect(item.tone).toBe("running");
  });

  test("waitingItems 는 순서를 바꾸지 않고 걸러내기만 한다", () => {
    const items = [
      { id: "a", waiting: false },
      { id: "b", waiting: true },
      { id: "c", waiting: true },
    ] as RailItem[];
    expect(waitingItems(items).map((item) => item.id)).toEqual(["b", "c"]);
  });
});
