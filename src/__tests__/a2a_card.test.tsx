// A2A 협업 카드 — Phase 5 (docs/a2a/00-master-plan.md §9).
//
// 두 가지가 이 화면의 계약이다:
//  1. **혼자 일할 때는 아무 것도 안 그린다.** 대부분의 프로젝트는 끝까지 그
//     상태이고, 빈 카드는 Today 를 쓰지도 않는 기능의 안내판으로 만든다.
//  2. **승인 전에는 아무 일도 없다.** 넘어온 작업은 사람이 눌러야 시작된다(D5).
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const overview = vi.fn();
const decide = vi.fn();
const release = vi.fn();
const bind = vi.fn();
const dissolve = vi.fn();
const setMembers = vi.fn();

vi.mock("@/api/oculpm", () => ({
  oculpmApi: {
    a2aOverview: (...args: unknown[]) => overview(...args),
    a2aDecideTask: (...args: unknown[]) => decide(...args),
    a2aReleaseLease: (...args: unknown[]) => release(...args),
    a2aBindGroup: (...args: unknown[]) => bind(...args),
    a2aDissolveGroup: (...args: unknown[]) => dissolve(...args),
    a2aSetGroupMembers: (...args: unknown[]) => setMembers(...args),
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

/** 참여자 한 자리 — 카드와 판정을 함께 준다 (플랜 `ledger-and-liveness-honesty`). */
function seat(id: string, name: string, liveness: "live" | "unknown" = "live") {
  return { card: card(id, name), liveness };
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
  // 이 저장소의 vitest 는 globals 를 안 켜 두어 Testing Library 의 자동 정리가
  // 등록되지 않는다 — 안 치우면 앞 테스트의 DOM 이 남아 같은 문구가 둘이 된다.
  afterEach(cleanup);

  beforeEach(() => {
    overview.mockReset();
    decide.mockReset();
    release.mockReset();
    bind.mockReset();
    dissolve.mockReset();
    setMembers.mockReset();
    bind.mockResolvedValue({ id: "g1", title: "팀", members: [], created_at: "", updated_at: "" });
    dissolve.mockResolvedValue(true);
    decide.mockResolvedValue(task("t1", "working"));
  });

  it("혼자 일할 때는 카드가 아예 없다", async () => {
    overview.mockResolvedValue({
      participants: [seat("claude-code-app", "Claude Code")],
      integrity: [],
      groups: [],
      leases: [],
      open_tasks: [],
    });
    const { container } = render(<A2aCard projectId={1} />);
    await waitFor(() => expect(overview).toHaveBeenCalled());
    expect(container.querySelector(".card")).toBeNull();
  });

  it("둘이 붙어 있으면 참여자를 보여준다", async () => {
    overview.mockResolvedValue({
      participants: [seat("claude-code-app", "Claude Code"), seat("codex-app", "Codex")],
      integrity: [],
      groups: [],
      leases: [],
      open_tasks: [],
    });
    render(<A2aCard projectId={1} />);
    expect(await screen.findByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
  });

  it("넘어온 작업은 **사람이 눌러야** 시작된다", async () => {
    overview.mockResolvedValue({
      participants: [seat("claude-code-app", "Claude Code"), seat("codex-app", "Codex")],
      integrity: [],
      groups: [],
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


  it("묶이지 않은 세션은 **보이기만** 하고, 둘 이상 골라야 묶인다", async () => {
    overview.mockResolvedValue({
      participants: [seat("claude-code-app", "Claude Code"), seat("codex-app", "Codex")],
      integrity: [],
      groups: [],
      leases: [],
      open_tasks: [],
    });
    render(<A2aCard projectId={1} />);
    expect(await screen.findByText("묶이지 않음 — 보이기만 합니다")).toBeTruthy();

    const bindBtn = screen.getByText("선택한 0개 묶기") as HTMLButtonElement;
    expect(bindBtn.disabled).toBe(true);

    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    expect((screen.getByText("선택한 1개 묶기") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByText("선택한 2개 묶기"));
    await waitFor(() =>
      expect(bind).toHaveBeenCalledWith(1, "팀 1", ["claude-code-app", "codex-app"]),
    );
  });

  it("이름을 적으면 그 이름으로 묶인다 — 비워 두면 순번이 붙는다", async () => {
    overview.mockResolvedValue({
      participants: [seat("claude-code-app", "Claude Code"), seat("codex-app", "Codex")],
      integrity: [],
      groups: [],
      leases: [],
      open_tasks: [],
    });
    render(<A2aCard projectId={1} />);
    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.change(screen.getByLabelText("팀 이름 (선택)"), {
      target: { value: "auth 리팩토링" },
    });
    fireEvent.click(screen.getByText("선택한 2개 묶기"));
    await waitFor(() =>
      expect(bind).toHaveBeenCalledWith(1, "auth 리팩토링", ["claude-code-app", "codex-app"]),
    );
  });

  /// 셋 이상일 때만 하나씩 뺀다 — 둘에서 하나를 빼는 것은 해체이고 그 자리에는
  /// 이미 「풀기」가 있다.
  it("셋 이상인 팀에서만 멤버를 하나씩 뺀다", async () => {
    setMembers.mockResolvedValue({ id: "g1", title: "팀", members: [], created_at: "", updated_at: "" });
    overview.mockResolvedValue({
      participants: [
        seat("claude-code-app", "Claude Code"),
        seat("codex-app", "Codex"),
        seat("gemini-cli-app", "Gemini"),
      ],
      integrity: [],
      groups: [
        {
          id: "g1",
          title: "셋이 함께",
          members: ["claude-code-app", "codex-app", "gemini-cli-app"],
          created_at: "",
          updated_at: "",
        },
      ],
      leases: [],
      open_tasks: [],
    });
    render(<A2aCard projectId={1} />);
    const removes = await screen.findAllByText("빼기");
    expect(removes).toHaveLength(3);
    fireEvent.click(removes[2]);
    await waitFor(() =>
      expect(setMembers).toHaveBeenCalledWith(1, "g1", ["claude-code-app", "codex-app"]),
    );
  });

  it("묶인 팀은 테두리 안에 서고 풀 수 있다", async () => {
    overview.mockResolvedValue({
      participants: [seat("claude-code-app", "Claude Code"), seat("codex-app", "Codex")],
      integrity: [],
      groups: [
        {
          id: "g1",
          title: "auth 리팩토링",
          members: ["claude-code-app", "codex-app"],
          created_at: "",
          updated_at: "",
        },
      ],
      leases: [],
      open_tasks: [],
    });
    const { container } = render(<A2aCard projectId={1} />);
    expect(await screen.findByText("auth 리팩토링")).toBeTruthy();
    // 전부 묶였으면 "묶이지 않음" 구역은 없다.
    expect(screen.queryByText("묶이지 않음 — 보이기만 합니다")).toBeNull();
    expect(container.querySelector(".a2a-group")).toBeTruthy();
    // 둘뿐이면 빼기는 곧 해체라 「풀기」만 둔다.
    expect(screen.queryByText("빼기")).toBeNull();

    fireEvent.click(screen.getByText("풀기"));
    await waitFor(() => expect(dissolve).toHaveBeenCalledWith(1, "g1"));
  });

  it("판정할 수 없는 세션은 **오프라인이 아니라** 판정 불가로 선다", async () => {
    overview.mockResolvedValue({
      participants: [
        seat("claude-code-app", "Claude Code"),
        seat("codex-app", "Codex", "unknown"),
      ],
      integrity: [],
      groups: [],
      leases: [],
      open_tasks: [],
    });
    render(<A2aCard projectId={1} />);
    // 목록에서 사라지지 않는다 — 사라지면 사용자가 "없다"고 읽는다.
    expect(await screen.findByText("Codex")).toBeTruthy();
    expect(screen.getByText("판정 불가")).toBeTruthy();
    // 확실히 살아 있는 쪽에는 배지가 붙지 않는다.
    expect(screen.getAllByText("판정 불가")).toHaveLength(1);
  });

  it("손을 탄 원장은 줄 번호와 이유를 말하고, 옛 원장은 세기만 한다", async () => {
    overview.mockResolvedValue({
      participants: [seat("claude-code-app", "Claude Code"), seat("codex-app", "Codex")],
      integrity: [
        {
          task_id: "20260903T170000.000-abc",
          status: { kind: "broken", line: 3, reason: "content_changed", forked_from_line: null, expected: "a", found: "b" },
        },
        { task_id: "20260901T100000.000-old", status: { kind: "unverifiable", line: 1 } },
      ],
      groups: [],
      leases: [],
      open_tasks: [],
    });
    render(<A2aCard projectId={1} />);
    expect(await screen.findByText("20260903T170000.000-abc")).toBeTruthy();
    expect(screen.getByText("3번째 줄")).toBeTruthy();
    expect(screen.getByText("내용이 고쳐졌어요")).toBeTruthy();
    // 사슬 이전 원장은 줄마다 붉히지 않고 한 줄로 센다.
    expect(screen.queryByText("20260901T100000.000-old")).toBeNull();
    expect(screen.getByText("사슬이 없던 시절의 원장 1건 — 판정하지 않습니다")).toBeTruthy();
    // 고치라고 하지 않는다 — 한계를 말한다.
    expect(screen.getByText(/감사이지 서명이 아닙니다/)).toBeTruthy();
  });

  it("잡힌 구역은 주인과 패턴을 보이고 놓을 수 있다", async () => {
    release.mockResolvedValue(true);
    overview.mockResolvedValue({
      participants: [seat("claude-code-app", "Claude Code"), seat("codex-app", "Codex")],
      integrity: [],
      groups: [],
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
