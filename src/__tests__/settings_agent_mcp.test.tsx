/**
 * 설정 · 에이전트 — Cursor · Gemini CLI 기록 도구 등록 행 (love-round-20261123 L7).
 *
 * 흔적이 없으면 행이 없고, 있으면 「등록」 이 그 프로젝트 파일 등록을 부르며, 못 읽는 설정 파일은
 * 경로와 이유를 행에 그대로 둔다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fx = vi.hoisted(() => {
  class FakeApiError extends Error {
    code = "unknown";
    detail: string;
    constructor(detail: string) {
      super(detail);
      this.detail = detail;
    }
  }
  const status = (target: string, over: Record<string, unknown> = {}) => ({
    target,
    detected: true,
    registered: false,
    binary_found: true,
    binary_path: "/bin/oculpm-mcp",
    config_path: target === "cursor" ? "/p/.cursor/mcp.json" : "/p/.gemini/settings.json",
    ...over,
  });
  return {
    FakeApiError,
    status,
    current: {} as Record<string, unknown>,
    fail: null as null | string,
    register: vi.fn(async (_id: number, target: string) => status(target, { registered: true })),
    unregister: vi.fn(async (_id: number, target: string) => status(target)),
  };
});

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: fx.FakeApiError,
  oculpmApi: {
    agentMcpStatus: async (_id: number, target: string) => {
      if (fx.fail) throw new fx.FakeApiError(fx.fail);
      return fx.current[target];
    },
    agentMcpRegister: fx.register,
    agentMcpUnregister: fx.unregister,
  },
}));
vi.mock("@/contexts/WorkspaceContext", () => ({
  useOptionalWorkspace: () => ({ state: { currentProjectId: 7 } }),
}));

import { AgentMcpRow } from "@/features/settings/AgentMcpRow";
import { __resetLangForTests, setLangSetting, t } from "@/i18n";

beforeEach(() => {
  setLangSetting("ko");
  fx.fail = null;
  fx.current = { cursor: fx.status("cursor"), gemini: fx.status("gemini") };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetLangForTests();
});

describe("Cursor · Gemini MCP registration", () => {
  it("shows no row when neither a trace nor a registration exists", async () => {
    fx.current.cursor = fx.status("cursor", { detected: false });
    const { container } = render(<AgentMcpRow target="cursor" tick={0} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText(t("prefs.agents.cursor"))).toBeNull();
  });

  it("with a trace, Register calls this project's registration and flips to registered · unregister", async () => {
    render(<AgentMcpRow target="gemini" tick={0} />);
    expect(await screen.findByText(t("prefs.agents.gemini"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("prefs.agents.mcpRegister") }));
    await waitFor(() => expect(fx.register).toHaveBeenCalledWith(7, "gemini"));
    expect(await screen.findByText(t("prefs.agents.mcpRegistered"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("prefs.agents.mcpUnregister") }));
    await waitFor(() => expect(fx.unregister).toHaveBeenCalledWith(7, "gemini"));
    expect(await screen.findByRole("button", { name: t("prefs.agents.mcpRegister") })).toBeInTheDocument();
  });

  it("stays removable when registered even after the trace is gone", async () => {
    fx.current.cursor = fx.status("cursor", { detected: false, registered: true });
    render(<AgentMcpRow target="cursor" tick={0} />);
    expect(await screen.findByRole("button", { name: t("prefs.agents.mcpUnregister") })).toBeInTheDocument();
  });

  it("a failure that is not about the config file puts no error row in a settings page of someone who never used the tool", async () => {
    fx.fail = "Failed to resolve project root: No such file or directory";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<AgentMcpRow target="cursor" tick={0} />);
    await waitFor(() => expect(warn).toHaveBeenCalledWith("agent_mcp_status", fx.fail));
    expect(container).toBeEmptyDOMElement();
    warn.mockRestore();
  });

  it("an unreadable config file puts its path and reason in the row, in Korean", async () => {
    fx.fail = "/p/.gemini/settings.json was left unchanged: it is not plain JSON (expected value at line 2 column 3)";
    render(<AgentMcpRow target="gemini" tick={0} />);
    const said = t("err.agentMcpNotJson", { path: "/p/.gemini/settings.json", reason: "expected value at line 2 column 3" });
    // i18n-ignore-next-line -- 한국어 사전이 실린 것을 무는 검사 재료
    expect(said).toContain("그대로 두었어요");
    expect(await screen.findByText(said)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
