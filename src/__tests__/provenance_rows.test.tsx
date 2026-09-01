import { afterEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { SourceBadge, SourceFilterRail } from "@/features/oculpm/SourceBadge";
import { JournalCardV2 } from "@/features/oculpm/JournalCardV2";
import type { JournalEntrySummary } from "@/lib/bindings";
import { SessionPanel } from "@/features/chat/conversation/SessionPanel";
import { sortActiveFirst } from "@/features/chat/acpHistory";
import {
  acpRowStateOf,
  acpWorkingKey,
  resetAcpWorking,
  setAcpAttention,
  setAcpWorking,
} from "@/features/chat/acpBusyBus";
import type { AcpSessionSummary } from "@/lib/bindings";

// 출처 레일 · 활성 행 · 인라인 Stop (Osaurus 라운드 Phase 3).
//
// 이 파일이 지키는 계약:
//  1. 레일은 출처가 1종이면 **아예 렌더되지 않는다** (빈 필터는 소음).
//  2. 활성 대화가 맨 위로 오되, 버킷 **안의** 순서는 원장이 정한 그대로다 —
//     `stabilizeHistory` 의 의미(우리가 말을 건 순서)를 깨지 않는다.
//  3. 도는 줄은 상대 시각 대신 상태를 말하고, 그 자리에서 멈출 수 있다.
//  4. 승인 대기는 "실행 중" 을 이긴다 — 기다리면 되는 것과 눌러야 풀리는 것.

afterEach(() => {
  cleanup();
  resetAcpWorking();
});

describe("출처 필터 레일", () => {
  it("출처가 1종이면 그리지 않는다", () => {
    const { container } = render(
      <SourceFilterRail sources={["agent", "agent"]} value={null} onChange={() => {}} />,
    );
    expect(container.querySelector("[role=radiogroup]")).toBeNull();
  });

  it("2종 이상이면 전체 + 나타난 출처만 그린다 (없는 출처는 칩도 없다)", () => {
    render(
      <SourceFilterRail
        sources={["agent", "direct", "agent"]}
        counts={{ agent: 2, direct: 1 }}
        value={null}
        onChange={() => {}}
      />,
    );
    const rail = screen.getByRole("radiogroup");
    const chips = within(rail).getAllByRole("radio");
    expect(chips.map((c) => c.textContent)).toEqual(["전체3", "직접1", "에이전트2"]);
    expect(within(rail).queryByText("스케줄")).toBeNull();
  });

  it("고른 출처만 aria-checked 다 (배타 선택)", () => {
    const picked: (string | null)[] = [];
    render(
      <SourceFilterRail
        sources={["agent", "schedule"]}
        value="schedule"
        onChange={(next) => picked.push(next)}
      />,
    );
    const rail = screen.getByRole("radiogroup");
    const checked = within(rail)
      .getAllByRole("radio")
      .filter((c) => c.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain("스케줄");

    fireEvent.click(within(rail).getByText(/전체/));
    expect(picked).toEqual([null]);
  });
});

describe("활성 버킷 정렬", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];

  it("활성이 위로 오고 각 버킷 안의 순서는 그대로다", () => {
    const active = new Set(["c", "e"]);
    expect(sortActiveFirst(rows, (id) => active.has(id)).map((r) => r.id)).toEqual([
      "c",
      "e",
      "a",
      "b",
      "d",
    ]);
  });

  it("활성이 없으면 입력 순서를 건드리지 않는다", () => {
    expect(sortActiveFirst(rows, () => false).map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("입력 배열을 바꾸지 않는다 (원장은 우리가 소유하지 않는다)", () => {
    const input = [...rows];
    sortActiveFirst(input, (id) => id === "e");
    expect(input.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("acpRowStateOf", () => {
  it("승인 대기가 실행 중을 이긴다", () => {
    act(() => {
      setAcpWorking(acpWorkingKey(1, "s1"), true);
      setAcpAttention(acpWorkingKey(1, "s1"), true);
    });
    const states = { working: new Set([acpWorkingKey(1, "s1")]), attention: new Set([acpWorkingKey(1, "s1")]) };
    expect(acpRowStateOf(states, 1, "s1")).toBe("attention");
  });

  it("프로젝트가 다르면 남의 상태를 빌려 오지 않는다", () => {
    const states = { working: new Set([acpWorkingKey(1, "s1")]), attention: new Set<string>() };
    expect(acpRowStateOf(states, 2, "s1")).toBeNull();
  });
});

function session(id: string, title: string): AcpSessionSummary {
  return { id, title, updated_at: "2026-09-01T09:00:00Z" } as AcpSessionSummary;
}

function renderPanel(
  stateOf: (id: string) => "working" | "attention" | null,
  onStop: (id: string) => void = () => {},
) {
  return render(
    <SessionPanel
      open
      sessions={[session("s1", "도는 대화"), session("s2", "조용한 대화")]}
      currentId="s1"
      query=""
      onQuery={() => {}}
      onPick={() => {}}
      onNew={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
      names={{}}
      stateOf={stateOf}
      onStop={onStop}
    />,
  );
}

describe("세션 줄 — 상태와 인라인 Stop", () => {
  it("도는 줄은 상태를 말하고 Stop 이 붙는다", () => {
    renderPanel((id) => (id === "s1" ? "working" : null));
    expect(screen.getByText("실행 중…")).toBeInTheDocument();
    expect(screen.getAllByLabelText("중단")).toHaveLength(1);
  });

  it("Stop 은 그 대화 하나만 부른다 — 열지 않는다", () => {
    const stopped: string[] = [];
    renderPanel((id) => (id === "s1" ? "working" : null), (id) => stopped.push(id));
    fireEvent.click(screen.getByLabelText("중단"));
    expect(stopped).toEqual(["s1"]);
  });

  it("승인 대기는 멈출 것이 아니라 답할 것이라 Stop 을 달지 않는다", () => {
    renderPanel((id) => (id === "s1" ? "attention" : null));
    expect(screen.getByText("입력을 기다립니다")).toBeInTheDocument();
    expect(screen.queryByLabelText("중단")).toBeNull();
  });

  it("유휴 줄은 예전처럼 상대 시각을 쓴다", () => {
    const { container } = renderPanel(() => null);
    expect(container.querySelectorAll(".acp-session-state")).toHaveLength(0);
    expect(container.querySelectorAll(".acp-session-time").length).toBeGreaterThan(0);
  });
});

function entry(over: Partial<JournalEntrySummary>): JournalEntrySummary {
  return {
    relative_path: "20260901/Features_to_add/0900_feature_x.md",
    workday: "20260901",
    type: "feature",
    slug: "x",
    status: "done",
    difficulty: null,
    title: "제목",
    checkbox: null,
    session_id: "20260901-003",
    agent_id: "claude-code",
    agent_version: null,
    verified_by_user: false,
    created_at: "2026-09-01T09:00:00+09:00",
    updated_at: null,
    tags: [],
    files_count: 1,
    parse_ok: true,
    parse_warnings: [],
    ...over,
  };
}

describe("일지 카드의 출처 배지", () => {
  it("에이전트가 쓴 일지와 자동화가 쓴 일지가 다른 말을 한다", () => {
    const { rerender } = render(
      <JournalCardV2 entry={entry({})} focused={false} onOpenEntry={() => {}} />,
    );
    expect(screen.getByText("에이전트")).toBeInTheDocument();

    rerender(
      <JournalCardV2
        entry={entry({ session_id: "sched-20260901-090000", agent_id: "auto:anthropic" })}
        focused={false}
        onOpenEntry={() => {}}
      />,
    );
    expect(screen.getByText("스케줄")).toBeInTheDocument();
    expect(screen.queryByText("에이전트")).toBeNull();
  });
});

describe("a11y", () => {
  const summarize = (r: AxeResults) =>
    r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

  it("배지는 이름을 갖고 레일은 radiogroup 이다", async () => {
    const { container } = render(
      <main>
        <SourceBadge source="schedule" />
        <SourceFilterRail
          sources={["agent", "schedule"]}
          counts={{ agent: 1, schedule: 1 }}
          value={null}
          onChange={() => {}}
        />
      </main>,
    );
    // 아이콘만 그리는 자리에서도 이름이 남아야 한다 (툴팁은 스크린리더가 못 읽는다).
    expect(screen.getByLabelText(/스케줄/)).toBeInTheDocument();
    expect(screen.getByRole("radiogroup")).toHaveAccessibleName("출처로 좁히기");
    expect(summarize(await axe(container))).toEqual([]);
  });
});
