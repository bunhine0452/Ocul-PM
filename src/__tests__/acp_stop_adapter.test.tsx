import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { AcpSession } from "@/lib/bindings";

// {#acp-stop-ui} — `acp_stop` 은 지난 라운드에 죽은 커맨드 17개 중 유일하게 살려
// 둔 것이다(`acp::process::stop` 의 유일한 호출부 + 원장 세그먼트를 닫는
// `note_closed` 부수효과). 부르는 화면이 없었을 뿐이다. 여기서는 그 손잡이가:
//   1. 확인 없이 곧장 어댑터를 내리지 않는다 (파괴적 동작 — 대화가 끊긴다)
//   2. 확인하면 `acp_stop` 을 이 프로젝트×provider 로 부른다
//   3. 내린 뒤에는 화면이 「종료됨」을 말하고, 재연결 손잡이로 이어진다
//   4. 죽은 어댑터에는 「내리기」를 다시 얹지 않는다
// 는 네 가지를 본다.

function session(id: string | null): AcpSession {
  return {
    agent: {
      name: "claude-code",
      title: "Claude Code",
      version: "0.73.0",
      auth_required: false,
      supports_image: true,
    },
    commands: [],
    session_id: id,
    title: null,
    options: [],
  };
}

const stopCalls: Array<{ projectId: number; provider: "claude" | "codex" | null }> = [];

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
  invoke: () => Promise.resolve(),
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "acpStart":
              return () => ok(session("sess-a"));
            case "acpListSessions":
              return () => ok([]);
            case "settingsGetAll":
              return () => ok([]);
            case "acpStop":
              return (projectId: number, provider: "claude" | "codex" | null) => {
                stopCalls.push({ projectId, provider });
                return ok(true);
              };
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { AcpConversation } from "@/features/chat/AcpConversation";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";

function wrap(node: React.ReactNode) {
  return (
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>{node}</WorkspaceProvider>
    </SettingsProvider>
  );
}

beforeEach(() => {
  stopCalls.length = 0;
});
afterEach(cleanup);

describe("AcpConversation — 어댑터 내리기 ({#acp-stop-ui})", () => {
  it("취소하면 acp_stop 이 안 나가고 대화는 살아 있는 채로 남는다", async () => {
    render(wrap(<AcpConversation projectId={1} />));

    fireEvent.click(await screen.findByLabelText("어댑터 내리기"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("취소"));

    expect(stopCalls).toHaveLength(0);
    expect(screen.queryByText("Claude Code 프로세스가 종료됐어요")).toBeNull();
    // 취소 뒤에도 손잡이는 그대로 — 대화가 여전히 살아 있다는 뜻이다.
    expect(await screen.findByLabelText("어댑터 내리기")).toBeInTheDocument();
  });

  it("확인하면 acp_stop 을 이 프로젝트×provider 로 부르고, 화면이 종료됨을 말한다", async () => {
    render(wrap(<AcpConversation projectId={1} />));

    fireEvent.click(await screen.findByLabelText("어댑터 내리기"));
    const dialog = await screen.findByRole("dialog");
    // 확인 버튼 라벨도 "어댑터 내리기" — danger 확인 상자의 confirmLabel.
    fireEvent.click(within(dialog).getByText("어댑터 내리기"));

    await waitFor(() =>
      expect(stopCalls).toEqual([{ projectId: 1, provider: "claude" }]),
    );
    expect(await screen.findByText("Claude Code 프로세스가 종료됐어요")).toBeInTheDocument();
    expect(screen.getByText("다시 연결")).toBeInTheDocument();
    // 죽은 어댑터를 살아 있는 것처럼 그리지 않는다 — 손잡이가 사라진다.
    expect(screen.queryByLabelText("어댑터 내리기")).toBeNull();
  });
});
