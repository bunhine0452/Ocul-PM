// A2A 협업 카드 — Phase 5 (docs/a2a/00-master-plan.md §9).
//
// 두 가지가 이 화면의 계약이다:
//  1. **혼자 일할 때는 아무 것도 안 그린다.** 대부분의 프로젝트는 끝까지 그
//     상태이고, 빈 카드는 Today 를 쓰지도 않는 기능의 안내판으로 만든다.
//  2. **승인 전에는 아무 일도 없다.** 넘어온 작업은 사람이 눌러야 시작된다(D5).
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const overview = vi.fn();
const decide = vi.fn();
const release = vi.fn();

vi.mock("@/api/oculpm", () => ({
  oculpmApi: {
    a2aOverview: (...args: unknown[]) => overview(...args),
    a2aDecideTask: (...args: unknown[]) => decide(...args),
    a2aReleaseLease: (...args: unknown[]) => release(...args),
    // 이벤트 구독은 비-Tauri 에서 조용히 아무것도 안 한다 (래퍼 규약).
    onA2aChanged: () => Promise.resolve(() => {}),
    onA2aTrespass: () => Promise.resolve(() => {}),
  },
  OculpmApiError: class extends Error {},
}));

import { A2aCard } from "@/features/today/A2aCard";

function card(id: string, name: string) {
  return {
    agent_id: id,
    name,
    description: null,
    version: "1.0",
    skills: [],
    provider: id,
    surface: "app" as const,
    session_id: null,
    pid: 1,
    project_root: "/p",
    heartbeat_at: new Date().toISOString(),
  };
}

function task(id: string, state: string) {
  return {
    id,
    from: "claude-code-app",
    to: "codex-app",
    title: "P0 두 건 고치기",
    state,
    note: null,
    artifacts: [],
    created_at: "",
    updated_at: "",
    deadline_at: "",
  };
}

describe("A2A 협업 카드", () => {
  beforeEach(() => {
    overview.mockReset();
    decide.mockReset();
    release.mockReset();
    decide.mockResolvedValue(task("t1", "working"));
  });

  it("혼자 일할 때는 카드가 아예 없다", async () => {
    overview.mockResolvedValue({
      participants: [card("claude-code-app", "Claude Code")],
      leases: [],
      open_tasks: [],
    });
    const { container } = render(<A2aCard projectId={1} />);
    await waitFor(() => expect(overview).toHaveBeenCalled());
    expect(container.querySelector(".card")).toBeNull();
  });

  it("둘이 붙어 있으면 참여자를 보여준다", async () => {
    overview.mockResolvedValue({
      participants: [card("claude-code-app", "Claude Code"), card("codex-app", "Codex")],
      leases: [],
      open_tasks: [],
    });
    render(<A2aCard projectId={1} />);
    expect(await screen.findByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
  });

  it("넘어온 작업은 **사람이 눌러야** 시작된다", async () => {
    overview.mockResolvedValue({
      participants: [card("claude-code-app", "Claude Code"), card("codex-app", "Codex")],
      leases: [],
      open_tasks: [task("t1", "submitted")],
    });
    render(<A2aCard projectId={1} />);
    const accept = await screen.findByText("수락");
    // 누르기 전에는 아무 것도 안 나갔다.
    expect(decide).not.toHaveBeenCalled();
    fireEvent.click(accept);
    await waitFor(() => expect(decide).toHaveBeenCalledWith(1, "t1", true));
  });

  it("잡힌 구역은 주인과 패턴을 보이고 놓을 수 있다", async () => {
    release.mockResolvedValue(true);
    overview.mockResolvedValue({
      participants: [card("claude-code-app", "Claude Code"), card("codex-app", "Codex")],
      leases: [
        {
          id: "l1",
          holder: "codex-app",
          patterns: ["src-tauri/src/acp/**"],
          note: null,
          created_at: "",
          expires_at: "",
        },
      ],
      open_tasks: [],
    });
    render(<A2aCard projectId={1} />);
    expect(await screen.findByText("src-tauri/src/acp/**")).toBeTruthy();
    fireEvent.click(screen.getByText("놓기"));
    await waitFor(() => expect(release).toHaveBeenCalledWith(1, "l1"));
  });
});
