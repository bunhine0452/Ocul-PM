import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AcpSession } from "@/lib/bindings";

// review-2026-10-09 {#acp-trust} — 어댑터는 저장소의 `.claude/settings.json` 훅과
// `.mcp.json` 서버를 CLI 의 폴더 신뢰 질문 없이 읽는다. 그래서 `acp_start` 는 신뢰
// 전이면 `project_untrusted` 로 돌려보내고, 화면은 「다시 시도」 대신 신뢰를 묻는다:
//   1. 저장소에 있는 실행 가능한 설정 파일 이름을 보여 준다
//   2. 누르면 언어 서버와 같은 키(`code_trust.<id>`)에 "true" 를 쓰고 다시 붙는다
//   3. 신뢰 안내를 오류 줄로 또 띄우지 않는다

function session(): AcpSession {
  return {
    agent: {
      name: "claude-code",
      title: "Claude Code",
      version: "0.81.0",
      auth_required: false,
      supports_image: true,
    },
    commands: [],
    session_id: "sess-a",
    title: null,
    options: [],
  };
}

const trusted = { value: false };
const settingsWrites: Array<[string, string]> = [];

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
              return () =>
                trusted.value
                  ? ok(session())
                  : Promise.resolve({
                      status: "error" as const,
                      error: {
                        code: "project_untrusted",
                        detail: ".claude/settings.json\n.mcp.json",
                      },
                    });
            case "settingsSet":
              return (key: string, value: string) => {
                settingsWrites.push([key, value]);
                if (key === "code_trust.1" && value === "true") trusted.value = true;
                return ok(null);
              };
            case "acpListSessions":
            case "settingsGetAll":
              return () => ok([]);
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
  trusted.value = false;
  settingsWrites.length = 0;
});
afterEach(cleanup);

describe("AcpConversation — 프로젝트 신뢰 ({#acp-trust})", () => {
  it("신뢰 전이면 실행될 수 있는 설정 파일을 보이고 신뢰를 묻는다", async () => {
    render(wrap(<AcpConversation projectId={1} />));

    expect(await screen.findByText("이 프로젝트를 신뢰할까요?")).toBeInTheDocument();
    expect(screen.getByText(".claude/settings.json")).toBeInTheDocument();
    expect(screen.getByText(".mcp.json")).toBeInTheDocument();
    // 같은 이유로 또 막힐 「다시 시도」 대신 신뢰 버튼 하나다.
    expect(screen.queryByText("다시 시도")).toBeNull();
    expect(screen.queryByText("이 기기에서 아직 신뢰하지 않은 프로젝트예요.")).toBeNull();
  });

  it("누르면 언어 서버와 같은 신뢰 키를 쓰고 다시 붙는다", async () => {
    render(wrap(<AcpConversation projectId={1} />));

    fireEvent.click(await screen.findByText("신뢰하고 시작"));

    await waitFor(() => expect(settingsWrites).toContainEqual(["code_trust.1", "true"]));
    await waitFor(() => expect(screen.queryByText("이 프로젝트를 신뢰할까요?")).toBeNull());
  });
});
