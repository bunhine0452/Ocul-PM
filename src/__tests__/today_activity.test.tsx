import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

import type { A2aOverview, AgentCard, Lease, Task } from "@/lib/bindings";

// Today 「지금 하는 일」 (v3-release {#today-activity-row}).
//
// Today 는 지금까지 활동에 대해 **집계만** 말했다(「활동 시간 N분」). 이 카드가
// 지금을 말하되, 낱말은 세션 화면·대화 화면의 것을 그대로 쓴다 — 새 어휘를
// 만들면 같은 일을 세 화면이 세 이름으로 부르게 된다.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const overview: { current: A2aOverview | null; fail: boolean } = { current: null, fail: false };

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    a2aOverview: () =>
      overview.fail
        ? Promise.reject(new Error("원장을 읽을 수 없음"))
        : Promise.resolve(overview.current),
    onA2aChanged: () => Promise.resolve(() => {}),
  },
}));

import { TodayActivity } from "@/features/today/TodayActivity";

function card(over: Partial<Record<string, unknown>> = {}): AgentCard {
  return {
    agent_id: "claude-term-1",
    name: "claude-code",
    description: null,
    version: "1",
    provider: "claude-code",
    surface: "terminal",
    session_id: null,
    pid: 1,
    project_root: "/p",
    heartbeat_at: "2026-09-06T00:00:00Z",
    verified: false,
    ...over,
  } as unknown as AgentCard;
}

function board(over: Partial<A2aOverview> = {}): A2aOverview {
  return {
    participants: [],
    integrity: [],
    groups: [],
    leases: [],
    open_tasks: [],
    ...over,
  } as unknown as A2aOverview;
}

const lease = (holder: string, patterns: string[]) =>
  ({ id: "l", holder, patterns, note: null, created_at: "", expires_at: "" }) as Lease;

const task = (to: string, state: string, title: string) =>
  ({ id: "t", title, state, from: "other", to }) as unknown as Task;

afterEach(() => {
  cleanup();
  overview.current = null;
  overview.fail = false;
});

describe("Today 지금 하는 일", () => {
  it("붙어 있는 세션이 없으면 0 을 말한다 — 숨지 않는다", async () => {
    overview.current = board();
    const { findByText, container } = render(
      <TodayActivity projectId={1} enabled onNavigate={vi.fn()} />,
    );
    expect(await findByText(/붙어 있는 세션이 없어요/)).toBeInTheDocument();
    expect(container.querySelector(".count")?.textContent).toBe("0");
  });

  it("원장을 못 읽으면 아무 말도 하지 않는다 — 모름은 0 이 아니다", async () => {
    overview.fail = true;
    const { container } = render(<TodayActivity projectId={1} enabled onNavigate={vi.fn()} />);
    // 조회가 실패로 끝난 뒤에도 카드가 서지 않는다.
    await waitFor(() => expect(container.querySelector(".card")).toBeNull());
    expect(container.textContent).toBe("");
  });

  it("잡은 구역을 대화 화면과 **같은 낱말**로 적는다 (「고침」)", async () => {
    overview.current = board({
      participants: [{ card: card(), liveness: "live" }] as unknown as A2aOverview["participants"],
      leases: [lease("claude-term-1", ["src/features/today/**"])],
    });
    const { container, findByText } = render(
      <TodayActivity projectId={1} enabled onNavigate={vi.fn()} />,
    );
    await findByText("Claude Code");
    const line = container.querySelector(".activity-line");
    expect(line?.querySelector(".activity-line-name")?.textContent).toBe("고침");
    expect(line?.querySelector(".activity-line-detail")?.textContent).toBe(
      "src/features/today/**",
    );
  });

  it("승인 대기가 먼저다 — 사람이 눌러야 풀리는 것", async () => {
    overview.current = board({
      participants: [{ card: card(), liveness: "live" }] as unknown as A2aOverview["participants"],
      leases: [lease("claude-term-1", ["src/**"])],
      open_tasks: [task("claude-term-1", "submitted", "승인 기다리는 일")],
    });
    const { findByText } = render(<TodayActivity projectId={1} enabled onNavigate={vi.fn()} />);
    expect(await findByText("승인 기다리는 일")).toBeInTheDocument();
  });

  it("아는 일이 없는 세션은 「조용함」 — 돌고 있다고 지어내지 않는다", async () => {
    overview.current = board({
      participants: [{ card: card(), liveness: "live" }] as unknown as A2aOverview["participants"],
    });
    const { findByText, container } = render(
      <TodayActivity projectId={1} enabled onNavigate={vi.fn()} />,
    );
    expect(await findByText("조용함")).toBeInTheDocument();
    // 세션은 세었다 — 0 이 아니라 1 이다.
    expect(container.querySelector(".count")?.textContent).toBe("1");
  });

  it("세션 화면으로 넘긴다 + axe 무위반", async () => {
    overview.current = board({
      participants: [{ card: card(), liveness: "live" }] as unknown as A2aOverview["participants"],
      leases: [lease("claude-term-1", ["src/**"])],
    });
    const onNavigate = vi.fn();
    const { container, findByText } = render(
      <TodayActivity projectId={1} enabled onNavigate={onNavigate} />,
    );
    fireEvent.click(await findByText(/세션/));
    expect(onNavigate).toHaveBeenCalledWith("sessions");
    expect(
      summarize(await axe(container, { rules: { region: { enabled: false } } })),
    ).toEqual([]);
  });
});
