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

describe("Cursor · Gemini 기록 도구 등록", () => {
  it("흔적도 등록도 없으면 행을 세우지 않는다", async () => {
    fx.current.cursor = fx.status("cursor", { detected: false });
    const { container } = render(<AgentMcpRow target="cursor" tick={0} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText(t("prefs.agents.cursor"))).toBeNull();
  });

  it("흔적이 있으면 「등록」 이 그 프로젝트 등록을 부르고 등록됨 · 등록 해제로 바뀐다", async () => {
    render(<AgentMcpRow target="gemini" tick={0} />);
    expect(await screen.findByText(t("prefs.agents.gemini"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("prefs.agents.mcpRegister") }));
    await waitFor(() => expect(fx.register).toHaveBeenCalledWith(7, "gemini"));
    expect(await screen.findByText(t("prefs.agents.mcpRegistered"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("prefs.agents.mcpUnregister") }));
    await waitFor(() => expect(fx.unregister).toHaveBeenCalledWith(7, "gemini"));
    expect(await screen.findByRole("button", { name: t("prefs.agents.mcpRegister") })).toBeInTheDocument();
  });

  it("흔적이 사라져도 등록돼 있으면 풀 수 있게 남는다", async () => {
    fx.current.cursor = fx.status("cursor", { detected: false, registered: true });
    render(<AgentMcpRow target="cursor" tick={0} />);
    expect(await screen.findByRole("button", { name: t("prefs.agents.mcpUnregister") })).toBeInTheDocument();
  });

  it("못 읽는 설정 파일은 경로와 이유를 한국어로 행에 둔다", async () => {
    fx.fail = "/p/.gemini/settings.json was left unchanged: it is not plain JSON (expected value at line 2 column 3)";
    render(<AgentMcpRow target="gemini" tick={0} />);
    const said = t("err.agentMcpNotJson", { path: "/p/.gemini/settings.json", reason: "expected value at line 2 column 3" });
    expect(said).toContain("그대로 두었어요");
    expect(await screen.findByText(said)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
