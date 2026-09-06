// 세션 화면 — 묶기가 Today 카드에서 나와 제 화면을 가졌다 (2026-09-04).
//
// 이 화면의 계약은 셋이다:
//  1. **구별할 수 있어야 고를 수 있다.** 같은 provider 세션 넷이 붙으면 이름은
//     전부 같다 — 표면·pid·잡은 구역·별명이 그 넷을 갈라 놓는다.
//  2. **드래그는 빠른 길이지 유일한 길이 아니다.** 체크박스와 행동 줄만으로도
//     같은 일이 끝나야 한다 (키보드·스크린리더).
//  3. **승인 전에는 아무 일도 없다** (D5).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: {
    // jsdom 에는 레이아웃 엔진이 없어 대비 계산이 못 돈다 (다른 화면과 같은 예외).
    "color-contrast": { enabled: false },
    // 이 화면은 production 에서 셸 안쪽 페인이라 자기 혼자 랜드마크가 아니다.
    region: { enabled: false },
  },
} as const;

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

// WorkspaceProvider 가 mount 에서 커맨드·이벤트를 건드린다 — no-op 로 세운다.
vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));

import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SessionsScreenV2 } from "@/features/sessions/SessionsScreenV2";
import { SESSION_DND_MIME } from "@/features/sessions/SessionCard";
import { buildBoard, isUsefulName, seatLabel } from "@/features/sessions/sessionModel";
import { t } from "@/i18n";

function card(id: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    agent_id: id,
    name: id,
    description: null,
    version: "1.0",
    skills: [],
    provider: id.split("-term-")[0].replace(/-app$/, ""),
    surface: "terminal" as const,
    session_id: null,
    pid: 1,
    project_root: "/p",
    heartbeat_at: new Date().toISOString(),
    verified: true,
    ...over,
  };
}

function seat(id: string, over: Partial<Record<string, unknown>> = {}) {
  return { card: card(id, over), liveness: "live" as const };
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

function ledger(over: Partial<Record<string, unknown>> = {}) {
  return { participants: [], integrity: [], groups: [], leases: [], open_tasks: [], ...over };
}

/** jsdom 에는 DataTransfer 가 없다 — 드래그가 실제로 옮기는 것만 흉내 낸다. */
function dataTransfer(payload?: string) {
  const store: Record<string, string> = payload ? { [SESSION_DND_MIME]: payload } : {};
  return {
    setData: (k: string, v: string) => {
      store[k] = v;
    },
    getData: (k: string) => store[k] ?? "",
    get types() {
      return Object.keys(store);
    },
    dropEffect: "",
    effectAllowed: "",
  };
}

function renderScreen() {
  return render(
    <WorkspaceProvider projectId={1}>
      <SessionsScreenV2 projectId={1} />
    </WorkspaceProvider>,
  );
}

describe("세션 화면", () => {
  // 이 저장소의 vitest 는 globals 를 안 켜 두어 Testing Library 의 자동 정리가
  // 등록되지 않는다 — 안 치우면 앞 테스트의 DOM 이 남아 같은 문구가 둘이 된다.
  afterEach(cleanup);

  beforeEach(() => {
    for (const fn of [overview, decide, release, bind, dissolve, setMembers]) fn.mockReset();
    bind.mockResolvedValue({ id: "g1", title: "팀", members: [], created_at: "", updated_at: "" });
    setMembers.mockResolvedValue({ id: "g1", title: "팀", members: [], created_at: "", updated_at: "" });
    dissolve.mockResolvedValue(true);
    decide.mockResolvedValue(task("t1", "working"));
    release.mockResolvedValue(true);
  });

  /**
   * Today 카드는 혼자 일할 때 **아예 안 그렸다** — 목적지가 된 지금은 반대다.
   * 빈 화면에 아무 것도 없으면 사용자는 기능이 고장 났다고 읽는다.
   */
  it("붙어 있는 세션이 없어도 왜 없는지와 무엇을 하면 되는지를 말한다", async () => {
    overview.mockResolvedValue(ledger());
    renderScreen();
    expect(await screen.findByText("붙어 있는 세션이 없어요")).toBeTruthy();
    expect(screen.getByText("세션이 안 보이나요?")).toBeTruthy();
    // 안내 문단과 복사할 명령 줄, 둘 다 그 이름을 말한다.
    expect(screen.getAllByText(/agent_register/).length).toBeGreaterThan(1);
  });

  it("같은 provider 가 여럿이어도 pid·잡은 구역으로 갈라 보인다", async () => {
    overview.mockResolvedValue(
      ledger({
        participants: [seat("claude-code-term-9152", { pid: 9152 }), seat("claude-code-term-9160", { pid: 9160 })],
        leases: [
          {
            id: "l1",
            holder: "claude-code-term-9152",
            patterns: ["src/features/code/**"],
            note: null,
            created_at: "",
            expires_at: "",
          },
        ],
      }),
    );
    const { container } = renderScreen();
    expect(await screen.findByText("pid 9152")).toBeTruthy();
    expect(screen.getByText("pid 9160")).toBeTruthy();
    // 무엇을 하고 있는가 — 이름이 같을 때 이 줄이 사용자를 건진다. (아래 임대
    // 목록에도 같은 패턴이 서므로 카드 안쪽을 짚는다.)
    //
    // 이제 이 줄은 **대화 화면과 같은 어휘**로 적힌다 ({#activity-vocab-reuse}) —
    // 잡은 구역은 「고침」이고, 상세 자리에 그 구역이 선다.
    expect(container.querySelector(".activity-line-detail")?.textContent).toBe(
      "src/features/code/**",
    );
    expect(container.querySelector(".activity-line-name")?.textContent).toBe(
      t("activity.kind.edit"),
    );
  });

  it("별명을 붙이면 그 이름이 카드의 제목이 된다", async () => {
    overview.mockResolvedValue(
      ledger({ participants: [seat("claude-code-term-9152"), seat("claude-code-term-9160")] }),
    );
    const { container } = renderScreen();
    const buttons = await screen.findAllByText("별명 붙이기");
    fireEvent.click(buttons[0]);
    fireEvent.change(screen.getByLabelText("별명"), { target: { value: "리팩토링 담당" } });
    fireEvent.click(screen.getByText("저장"));
    // 제목 줄이 별명으로 바뀐다 (별명 버튼에도 같은 글자가 서므로 제목을 짚는다).
    await waitFor(() =>
      expect(
        [...container.querySelectorAll(".sess-name")].map((el) => el.textContent),
      ).toContain("리팩토링 담당"),
    );
  });

  it("체크해서 묶는다 — 하나면 못 묶고, 이름을 비우면 순번이 붙는다", async () => {
    overview.mockResolvedValue(
      ledger({ participants: [seat("claude-code-app"), seat("codex-app")] }),
    );
    renderScreen();
    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    expect((screen.getByText("선택한 1개 묶기") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByText("선택한 2개 묶기"));
    await waitFor(() => expect(bind).toHaveBeenCalledWith(1, "팀 1", expect.arrayContaining(["claude-code-app", "codex-app"])));
  });

  it("이름을 적으면 그 이름으로 묶인다", async () => {
    overview.mockResolvedValue(
      ledger({ participants: [seat("claude-code-app"), seat("codex-app")] }),
    );
    renderScreen();
    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.change(screen.getByLabelText("팀 이름 (선택)"), { target: { value: "auth 리팩토링" } });
    fireEvent.click(screen.getByText("선택한 2개 묶기"));
    await waitFor(() => expect(bind).toHaveBeenCalledWith(1, "auth 리팩토링", expect.any(Array)));
  });

  /** 새 팀 자리에 떨어뜨리는 것은 **고르기**다 — 하나로는 팀이 안 되므로. */
  it("새 팀 자리로 끌어다 놓으면 골라지고, 둘이 되면 묶인다", async () => {
    overview.mockResolvedValue(
      ledger({ participants: [seat("claude-code-app"), seat("codex-app")] }),
    );
    const { container } = renderScreen();
    await screen.findByText("새 팀");
    const zone = container.querySelector(".sess-lane.new") as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: dataTransfer("claude-code-app") });
    expect(bind).not.toHaveBeenCalled();
    fireEvent.drop(zone, { dataTransfer: dataTransfer("codex-app") });
    expect(screen.getByText("2개 선택됨")).toBeTruthy();
    fireEvent.click(screen.getByText("선택한 2개 묶기"));
    await waitFor(() =>
      expect(bind).toHaveBeenCalledWith(1, "팀 1", ["claude-code-app", "codex-app"]),
    );
  });

  it("팀 레인으로 끌어다 놓으면 그 팀에 들어간다", async () => {
    overview.mockResolvedValue(
      ledger({
        participants: [seat("claude-code-app"), seat("codex-app"), seat("gemini-cli-app")],
        groups: [
          { id: "g1", title: "리팩토링 조", members: ["claude-code-app", "codex-app"], created_at: "", updated_at: "" },
        ],
      }),
    );
    renderScreen();
    const lane = await screen.findByRole("group", { name: "리팩토링 조" });
    fireEvent.drop(lane, { dataTransfer: dataTransfer("gemini-cli-app") });
    await waitFor(() =>
      expect(setMembers).toHaveBeenCalledWith(1, "g1", [
        "claude-code-app",
        "codex-app",
        "gemini-cli-app",
      ]),
    );
  });

  it("묶이지 않음 쪽으로 끌어다 놓으면 팀에서 빠진다 — 둘짜리에서는 해체다", async () => {
    overview.mockResolvedValue(
      ledger({
        participants: [seat("claude-code-app"), seat("codex-app")],
        groups: [
          { id: "g1", title: "둘이서", members: ["claude-code-app", "codex-app"], created_at: "", updated_at: "" },
        ],
      }),
    );
    renderScreen();
    await screen.findByRole("group", { name: "둘이서" });
    const col = screen.getByRole("region", { name: "묶이지 않음" });
    fireEvent.drop(col, { dataTransfer: dataTransfer("codex-app") });
    // 둘에서 하나를 빼면 남는 하나는 팀이 아니다 — 백엔드도 둘 미만은 거절한다.
    await waitFor(() => expect(dissolve).toHaveBeenCalledWith(1, "g1"));
    expect(setMembers).not.toHaveBeenCalled();
  });

  it("셋 이상인 팀에서는 하나만 빠진다", async () => {
    overview.mockResolvedValue(
      ledger({
        participants: [seat("claude-code-app"), seat("codex-app"), seat("gemini-cli-app")],
        groups: [
          {
            id: "g1",
            title: "셋이 함께",
            members: ["claude-code-app", "codex-app", "gemini-cli-app"],
            created_at: "",
            updated_at: "",
          },
        ],
      }),
    );
    renderScreen();
    const removes = await screen.findAllByText("빼기");
    fireEvent.click(removes[2]);
    await waitFor(() =>
      expect(setMembers).toHaveBeenCalledWith(1, "g1", ["claude-code-app", "codex-app"]),
    );
  });

  it("팀을 통째로 푼다", async () => {
    overview.mockResolvedValue(
      ledger({
        participants: [seat("claude-code-app"), seat("codex-app")],
        groups: [
          { id: "g1", title: "auth 리팩토링", members: ["claude-code-app", "codex-app"], created_at: "", updated_at: "" },
        ],
      }),
    );
    renderScreen();
    expect(await screen.findByRole("group", { name: "auth 리팩토링" })).toBeTruthy();
    // 레인 머리의 「풀기」 — 멤버 카드의 것과 라벨이 같으므로 첫 번째를 누른다.
    fireEvent.click(screen.getAllByText("풀기")[0]);
    await waitFor(() => expect(dissolve).toHaveBeenCalledWith(1, "g1"));
  });

  it("넘어온 작업은 사람이 눌러야 시작된다", async () => {
    overview.mockResolvedValue(
      ledger({
        participants: [seat("claude-code-app"), seat("codex-app")],
        open_tasks: [task("t1", "submitted")],
      }),
    );
    renderScreen();
    expect(await screen.findByText("넘어온 작업")).toBeTruthy();
    fireEvent.click(screen.getByText("수락"));
    await waitFor(() => expect(decide).toHaveBeenCalledWith(1, "t1", true));
  });

  it("잡힌 구역은 주인과 패턴을 보이고 놓을 수 있다", async () => {
    overview.mockResolvedValue(
      ledger({
        participants: [seat("claude-code-app"), seat("codex-app")],
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
      }),
    );
    renderScreen();
    expect(await screen.findByText("잡혀 있는 구역")).toBeTruthy();
    fireEvent.click(screen.getByText("놓기"));
    await waitFor(() => expect(release).toHaveBeenCalledWith(1, "l1"));
  });

  /** 묶기가 거절돼도 넷 중 둘을 처음부터 다시 고르게 하지 않는다. */
  it("묶기가 거절되면 사유를 세우고 고른 것은 그대로 둔다", async () => {
    bind.mockRejectedValue(new Error("a group needs at least two members"));
    overview.mockResolvedValue(
      ledger({ participants: [seat("claude-code-app"), seat("codex-app")] }),
    );
    renderScreen();
    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByText("선택한 2개 묶기"));
    await waitFor(() => expect(bind).toHaveBeenCalled());
    expect(screen.getByText("2개 선택됨")).toBeTruthy();
  });

  it("드래그·체크박스가 섞여 있어도 axe 위반이 없다", async () => {
    overview.mockResolvedValue(
      ledger({
        participants: [seat("claude-code-app"), seat("codex-app"), seat("gemini-cli-app")],
        groups: [
          { id: "g1", title: "리팩토링 조", members: ["claude-code-app", "codex-app"], created_at: "", updated_at: "" },
        ],
        open_tasks: [task("t1", "submitted")],
      }),
    );
    const { container } = renderScreen();
    await screen.findByRole("group", { name: "리팩토링 조" });
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("판정할 수 없는 세션은 오프라인이 아니라 판정 불가로, 자칭은 자칭으로 선다", async () => {
    overview.mockResolvedValue(
      ledger({
        participants: [
          seat("claude-code-app"),
          { card: card("codex-term-42", { verified: false }), liveness: "unknown" as const },
        ],
      }),
    );
    renderScreen();
    expect(await screen.findByText("판정 불가")).toBeTruthy();
    expect(screen.getByText("자칭")).toBeTruthy();
  });
});

describe("sessionModel", () => {
  it("패키지 이름은 사람이 읽을 이름이 아니다", () => {
    expect(isUsefulName("@agentclientprotocol/claude-agent-acp", "claude-code")).toBe(false);
    expect(isUsefulName("claude-code", "claude-code")).toBe(false);
    expect(isUsefulName("  ", "claude-code")).toBe(false);
    expect(isUsefulName("리팩토링 담당", "claude-code")).toBe(true);
  });

  it("이름은 별명 > 쓸모 있는 등록 이름 > provider 라벨 차례다", () => {
    const c = card("claude-code-term-1", { name: "@agentclientprotocol/claude-agent-acp" });
    expect(seatLabel(c, null)).toBe("Claude Code");
    expect(seatLabel(c, "리팩토링 담당")).toBe("리팩토링 담당");
    expect(seatLabel(card("claude-code-term-1", { name: "docs 담당" }), null)).toBe("docs 담당");
  });

  /** 방금 친 세션이 맨 위에 있는 것이 넷 중 하나를 고를 때 제일 빠른 길이다. */
  it("묶이지 않은 세션은 마지막 활동이 새로운 것부터 선다", () => {
    const board = buildBoard(
      ledger({
        participants: [
          seat("a", { heartbeat_at: "2026-09-04T01:00:00Z" }),
          seat("b", { heartbeat_at: "2026-09-04T03:00:00Z" }),
          seat("c", { heartbeat_at: "2026-09-04T02:00:00Z" }),
        ],
      }) as never,
      {},
    );
    expect(board.unbound.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  /** 원장에는 있는데 참여자에 없는 멤버는 **감추지 않고 세어서** 말한다. */
  it("죽어서 빠진 멤버가 있으면 그 수를 남긴다", () => {
    const board = buildBoard(
      ledger({
        participants: [seat("a"), seat("b")],
        groups: [{ id: "g1", title: "팀", members: ["a", "b", "gone"], created_at: "", updated_at: "" }],
      }) as never,
      {},
    );
    expect(board.teams[0].members.map((m) => m.id)).toEqual(["a", "b"]);
    expect(board.teams[0].goneCount).toBe(1);
    expect(board.unbound).toHaveLength(0);
  });
});
