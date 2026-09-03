import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

// ─── PR-CI2 — 설정 Agents 섹션의 MCP 서버 등록 블록 ─────────────────────────
//
// claude_hooks_settings 와 동일 패턴: 커맨드 Proxy mock + 호출 인자 수집.
// 핵심 계약 — 바이너리 없으면 등록 버튼 비활성, 등록/해제가 상태를 갱신,
// Desktop 스니펫은 클립보드로.

function status(over: Record<string, unknown> = {}) {
  return {
    registered: false,
    binary_found: true,
    binary_path: "/app/oculpm-mcp",
    mcp_json_path: "/tmp/proj/.mcp.json",
    desktop_snippet: '{\n  "mcpServers": { "oculpm-proj": {} }\n}',
    foreign_servers: 0,
    ...over,
  };
}

function desktopStatus(over: Record<string, unknown> = {}) {
  return {
    installed: true,
    registered: false,
    config_path: "/home/u/.config/Claude/claude_desktop_config.json",
    server_key: "oculpm-proj",
    foreign_servers: 0,
    ...over,
  };
}

function codexStatus(over: Record<string, unknown> = {}) {
  return {
    installed: true,
    registered: false,
    binary_found: true,
    binary_path: "/app/oculpm-mcp",
    config_path: "/home/u/.codex/config.toml",
    server_key: "oculpm",
    pinned_root: null,
    foreign_servers: 0,
    ...over,
  };
}

function codexPluginStatus(over: Record<string, unknown> = {}) {
  return {
    codex_installed: true,
    enabled: true,
    marketplace: "oculpm",
    marketplace_configured: true,
    cached_version: "2.38.0",
    config_path: "/home/u/.codex/config.toml",
    ...over,
  };
}

const fx = {
  status: status() as Record<string, unknown>,
  desktop: desktopStatus() as Record<string, unknown>,
  codex: codexStatus() as Record<string, unknown>,
  codexPlugin: codexPluginStatus() as Record<string, unknown>,
  calls: {
    register: [] as unknown[][],
    unregister: [] as unknown[][],
    deskRegister: [] as unknown[][],
    deskUnregister: [] as unknown[][],
    codexRegister: [] as unknown[][],
    codexUnregister: [] as unknown[][],
  },
};

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "mcpStatus":
              return () => ok(fx.status);
            case "mcpRegister":
              return (...a: unknown[]) => {
                fx.calls.register.push(a);
                return ok(status({ registered: true }));
              };
            case "mcpUnregister":
              return (...a: unknown[]) => {
                fx.calls.unregister.push(a);
                return ok(status());
              };
            case "mcpDesktopStatus":
              return () => ok(fx.desktop);
            case "mcpDesktopRegister":
              return (...a: unknown[]) => {
                fx.calls.deskRegister.push(a);
                return ok(desktopStatus({ registered: true }));
              };
            case "mcpDesktopUnregister":
              return (...a: unknown[]) => {
                fx.calls.deskUnregister.push(a);
                return ok(desktopStatus());
              };
            case "codexMcpStatus":
              return () => ok(fx.codex);
            case "codexPluginStatus":
              return () => ok(fx.codexPlugin);
            case "codexMcpRegister":
              return (...a: unknown[]) => {
                fx.calls.codexRegister.push(a);
                return ok(codexStatus({ registered: true }));
              };
            case "codexMcpUnregister":
              return (...a: unknown[]) => {
                fx.calls.codexUnregister.push(a);
                return ok(codexStatus());
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

import { CodexMcpServerBlock } from "@/features/settings/CodexMcpServerBlock";
import { CodexPluginBlock } from "@/features/settings/CodexPluginBlock";
import { ClaudePluginBlock } from "@/features/settings/ClaudePluginBlock";
import { McpServerBlock } from "@/features/settings/OculpmSettings";

beforeEach(() => {
  fx.status = status();
  fx.desktop = desktopStatus();
  fx.codex = codexStatus();
  fx.codexPlugin = codexPluginStatus();
  fx.calls.register = [];
  fx.calls.unregister = [];
  fx.calls.deskRegister = [];
  fx.calls.deskUnregister = [];
  fx.calls.codexRegister = [];
  fx.calls.codexUnregister = [];
});

afterEach(() => {
  cleanup();
});

describe("McpServerBlock (PR-CI2)", () => {
  it("미등록 + 바이너리 있음: 등록 → mcpRegister(projectId) 호출, 배지 갱신", async () => {
    const r = render(<McpServerBlock projectId={9} />);
    // 프로젝트(.mcp.json)와 Desktop 두 배지가 각각 미등록으로 뜬다.
    await waitFor(() => expect(r.getAllByText("미등록")).toHaveLength(2));

    fireEvent.click(r.getByRole("button", { name: "등록" }));
    await waitFor(() => expect(fx.calls.register).toHaveLength(1));
    expect(fx.calls.register[0][0]).toBe(9);
    await waitFor(() => expect(r.getByText("등록됨")).toBeTruthy());
    // 등록 후에는 머신 종속 경로 고지가 보인다.
    expect(r.getByText(/각자 재등록/)).toBeTruthy();
  });

  it("바이너리 없음: 경고 배지 + 등록 버튼 비활성 (죽은 경로 커밋 방지 계약)", async () => {
    fx.status = status({ binary_found: false, binary_path: null });
    const r = render(<McpServerBlock projectId={1} />);
    await waitFor(() => expect(r.getByText("바이너리 없음")).toBeTruthy());
    const btn = r.getByRole("button", { name: "등록" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(r.getByText(/cargo build --bin oculpm-mcp/)).toBeTruthy();
  });

  it("등록됨: 해제 → mcpUnregister 호출, 미등록으로 복귀", async () => {
    fx.status = status({ registered: true });
    const r = render(<McpServerBlock projectId={2} />);
    await waitFor(() => expect(r.getByText("등록됨")).toBeTruthy());
    fireEvent.click(r.getByRole("button", { name: "해제" }));
    await waitFor(() => expect(fx.calls.unregister).toHaveLength(1));
    await waitFor(() => expect(r.getAllByText("미등록")).toHaveLength(2));
  });

  it("Desktop 스니펫 복사 버튼이 클립보드에 스니펫을 쓴다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const r = render(<McpServerBlock projectId={3} />);
    await waitFor(() => expect(r.getAllByText("미등록").length).toBeGreaterThan(0));
    fireEvent.click(r.getByRole("button", { name: "Desktop 스니펫 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("oculpm-proj")));
    await waitFor(() => expect(r.getByText("복사됨")).toBeTruthy());
  });

  // ─── Claude Desktop 원클릭 등록 ──────────────────────────────────────────

  it("Desktop 등록 → mcpDesktopRegister(projectId) 호출, 등록됨 + 재시작 고지", async () => {
    const r = render(<McpServerBlock projectId={7} />);
    await waitFor(() => expect(r.getAllByText("미등록")).toHaveLength(2));

    fireEvent.click(r.getByRole("button", { name: "Desktop 등록" }));
    await waitFor(() => expect(fx.calls.deskRegister).toHaveLength(1));
    expect(fx.calls.deskRegister[0][0]).toBe(7);
    await waitFor(() => expect(r.getByText("등록됨")).toBeTruthy());
    expect(r.getByText(/Claude Desktop 재시작/)).toBeTruthy();
  });

  it("Desktop 등록됨: Desktop 해제 → mcpDesktopUnregister 호출", async () => {
    fx.desktop = desktopStatus({ registered: true });
    const r = render(<McpServerBlock projectId={4} />);
    await waitFor(() => expect(r.getByText("등록됨")).toBeTruthy());
    fireEvent.click(r.getByRole("button", { name: "Desktop 해제" }));
    await waitFor(() => expect(fx.calls.deskUnregister).toHaveLength(1));
    await waitFor(() => expect(r.getAllByText("미등록")).toHaveLength(2));
  });

  it("Desktop 미설치: 경고 배지 + 등록 버튼 비활성 (설정 폴더 창조 금지 계약)", async () => {
    fx.desktop = desktopStatus({ installed: false });
    const r = render(<McpServerBlock projectId={5} />);
    await waitFor(() => expect(r.getByText("Desktop 미설치")).toBeTruthy());
    const btn = r.getByRole("button", { name: "Desktop 등록" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(r.getByText(/설정 폴더를 찾지 못했습니다/)).toBeTruthy();
  });

  it("바이너리 없음: Desktop 등록 버튼도 비활성 (죽은 경로 기입 방지)", async () => {
    fx.status = status({ binary_found: false, binary_path: null });
    const r = render(<McpServerBlock projectId={6} />);
    await waitFor(() => expect(r.getByText("바이너리 없음")).toBeTruthy());
    const btn = r.getByRole("button", { name: "Desktop 등록" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // ─── 적용 범위 표시 ──────────────────────────────────────────────────────
  //
  // 이 블록의 두 등록은 **프로젝트별**이다. 머신 전역인 플러그인·ACP·셸과
  // 한 카드에 섞여 있어 "등록됨" 배지가 어느 범위를 말하는지 알 수 없었다.
  // 섹션 머리말은 스크롤하면 사라지므로 칩이 블록 안에 남아야 한다.

  it("MCP·Desktop 헤더가 각각 프로젝트 범위 칩을 단다", async () => {
    const r = render(<McpServerBlock projectId={8} />);
    await waitFor(() => expect(r.getAllByText("미등록")).toHaveLength(2));
    expect(r.getByText("이 프로젝트")).toBeTruthy();
    // Desktop 은 설정 파일이 머신에 하나지만 키가 프로젝트별이라 문구가 다르다.
    expect(r.getByText("이 프로젝트 키")).toBeTruthy();
  });

  it("플러그인 파트가 이 블록에서 빠졌다 (머신 전역 섹션으로 이사)", async () => {
    const r = render(<McpServerBlock projectId={8} />);
    await waitFor(() => expect(r.getAllByText("미등록")).toHaveLength(2));
    expect(r.queryByRole("button", { name: "설치 명령 복사" })).toBeNull();
    expect(r.queryByText("이 머신 전체")).toBeNull();
  });
});

describe("ClaudePluginBlock (머신 전역)", () => {
  it("머신 범위 칩 + 미설치 배지 — projectId 없이 렌더된다", () => {
    const r = render(<ClaudePluginBlock plugin={{ installed: false, path: null }} />);
    expect(r.getByText("미설치")).toBeTruthy();
    expect(r.getByText("이 머신 전체")).toBeTruthy();
    expect(r.queryByText("이 프로젝트")).toBeNull();
  });

  it("설치됨: 이중 설정 경고가 프로젝트 섹션 이름으로 안내한다", () => {
    const r = render(
      <ClaudePluginBlock plugin={{ installed: true, path: "/home/u/.claude/plugins/oculpm" }} />,
    );
    expect(r.getByText("설치됨")).toBeTruthy();
    // 블록이 이사했으므로 "아래" 같은 위치 표현은 더 이상 참이 아니다.
    const warn = r.getByText(/이벤트가 이중 적재/);
    expect(warn.textContent).toContain("이 프로젝트에만 적용");
    expect(warn.textContent).not.toContain("아래");
  });

  it("상태 미확인(null): 확인 중 배지", () => {
    const r = render(<ClaudePluginBlock plugin={null} />);
    expect(r.getByText("확인 중…")).toBeTruthy();
  });

  it("설치 명령을 클립보드에 복사한다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const r = render(<ClaudePluginBlock plugin={{ installed: false, path: null }} />);
    fireEvent.click(r.getByRole("button", { name: "설치 명령 복사" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("/plugin marketplace add bunhine0452/Ocul-PM"),
    );
  });
});

describe("CodexMcpServerBlock (머신 스코프)", () => {
  it("Codex 전용 등록은 codexMcpRegister만 호출하고 새 세션 안내를 보인다", async () => {
    const r = render(<CodexMcpServerBlock />);
    await waitFor(() => expect(r.getByText("Codex MCP 서버")).toBeTruthy());
    fireEvent.click(r.getByRole("button", { name: "등록" }));
    await waitFor(() => expect(fx.calls.codexRegister).toHaveLength(1));
    expect(fx.calls.register).toHaveLength(0);
    await waitFor(() => expect(r.getByText("등록됨")).toBeTruthy());
    expect(r.getByText(/새 Codex 세션/)).toBeTruthy();
  });

  it("Codex 미설치와 바이너리 없음은 등록을 막는다", async () => {
    fx.codex = codexStatus({ installed: false, binary_found: false, binary_path: null });
    const r = render(<CodexMcpServerBlock />);
    await waitFor(() => expect(r.getByText("Codex 미설치")).toBeTruthy());
    expect((r.getByRole("button", { name: "등록" }) as HTMLButtonElement).disabled).toBe(true);
    expect(r.getByText(/Codex 설정 폴더를 찾지 못했습니다/)).toBeTruthy();
  });

  it("Codex 해제는 Codex 설정만 대상으로 한다", async () => {
    fx.codex = codexStatus({ registered: true });
    const r = render(<CodexMcpServerBlock />);
    await waitFor(() => expect(r.getByText("등록됨")).toBeTruthy());
    fireEvent.click(r.getByRole("button", { name: "해제" }));
    await waitFor(() => expect(fx.calls.codexUnregister).toHaveLength(1));
    expect(fx.calls.unregister).toHaveLength(0);
  });

  /// 루트가 박힌 항목은 **다른 프로젝트의 기록을 여기로 끌어온다**. 화면은
  /// 그 경로를 이름으로 말하고, 답을 「해제」가 아니라 「다시 등록」으로 준다.
  it("프로젝트가 고정된 항목은 경로를 짚고 다시 등록을 권한다", async () => {
    fx.codex = codexStatus({ registered: true, pinned_root: "/Users/u/Desktop/git/ai-pm" });
    const r = render(<CodexMcpServerBlock />);
    await waitFor(() => expect(r.getByText("프로젝트 고정됨")).toBeTruthy());
    expect(r.getByText(/\/Users\/u\/Desktop\/git\/ai-pm/)).toBeTruthy();
    expect(r.queryByRole("button", { name: "해제" })).toBeNull();
    fireEvent.click(r.getByRole("button", { name: "다시 등록" }));
    await waitFor(() => expect(fx.calls.codexRegister).toHaveLength(1));
  });
});

// ─── 플러그인 겹침 고지 (프로젝트 섹션 쪽) ────────────────────────────────
//
// 경고가 플러그인 블록에만 붙어 있으면 프로젝트 섹션까지 스크롤한 사용자는
// 못 본다. 켜져 있으면 실제 이중 적재라 경고, 꺼져 있으면 "켤 필요 없다" 는
// 정보 — 문구가 상태에 따라 갈리는 것이 이 고지의 핵심이다.

describe("플러그인 겹침 고지", () => {
  it("MCP 미등록: 등록할 필요 없다는 정보 (경고 아님)", async () => {
    const r = render(<McpServerBlock projectId={10} pluginInstalled />);
    await waitFor(() => expect(r.getAllByText("미등록")).toHaveLength(2));
    expect(r.getByText(/또 등록할 필요가 없습니다/)).toBeTruthy();
    expect(r.queryByText(/도구가 2벌 노출됩니다/)).toBeNull();
  });

  it("MCP 등록됨: 실제 겹침 경고로 문구가 바뀐다", async () => {
    fx.status = status({ registered: true });
    const r = render(<McpServerBlock projectId={11} pluginInstalled />);
    await waitFor(() => expect(r.getByText("등록됨")).toBeTruthy());
    const warn = r.getByText(/도구가 2벌 노출됩니다/);
    expect(warn.className).toContain("text-(--warn-text)");
  });

  it("Desktop 은 플러그인이 안 덮는다고 따로 안내한다", async () => {
    const r = render(<McpServerBlock projectId={12} pluginInstalled />);
    await waitFor(() => expect(r.getAllByText("미등록")).toHaveLength(2));
    expect(r.getByText(/Claude Desktop 은 겹치지 않으니/)).toBeTruthy();
  });

  it("플러그인 미설치면 고지가 아예 안 뜬다", async () => {
    fx.status = status({ registered: true });
    const r = render(<McpServerBlock projectId={13} />);
    await waitFor(() => expect(r.getByText("등록됨")).toBeTruthy());
    expect(r.queryByText(/플러그인/)).toBeNull();
  });
});

describe("CodexPluginBlock (머신 스코프 · 읽기 전용)", () => {
  it("설치됨: 캐시 버전과 마켓플레이스를 보여준다", async () => {
    const r = render(<CodexPluginBlock />);
    await waitFor(() => expect(r.getByText("설치됨")).toBeTruthy());
    expect(r.getByText("2.38.0")).toBeTruthy();
    expect(r.queryByText(/로드하지 못합니다/)).toBeNull();
  });

  /// 항목만 있고 마켓플레이스가 없으면 Codex 는 **조용히** 로드하지 않는다 —
  /// 그 침묵을 화면이 대신 말해야 한다 (2026-09-03 실측한 고아 상태).
  it("고아 항목: 마켓플레이스가 없다고 경고한다", async () => {
    fx.codexPlugin = codexPluginStatus({ marketplace_configured: false, cached_version: null });
    const r = render(<CodexPluginBlock />);
    await waitFor(() => expect(r.getByText("마켓플레이스 없음")).toBeTruthy());
    expect(r.getByText(/로드하지 못합니다/)).toBeTruthy();
  });

  it("Codex 미설치: 배지와 안내가 바뀌고 명령은 그대로 복사된다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fx.codexPlugin = codexPluginStatus({
      codex_installed: false,
      enabled: false,
      marketplace: null,
      marketplace_configured: false,
      cached_version: null,
    });
    const r = render(<CodexPluginBlock />);
    await waitFor(() => expect(r.getByText("Codex 미설치")).toBeTruthy());
    fireEvent.click(r.getByRole("button", { name: "설치 명령 복사" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("codex plugin add oculpm-codex@oculpm")),
    );
  });
});
