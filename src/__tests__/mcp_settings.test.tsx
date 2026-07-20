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

const fx = {
  status: status() as Record<string, unknown>,
  calls: { register: [] as unknown[][], unregister: [] as unknown[][] },
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
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { McpServerBlock } from "@/features/settings/OculpmSettings";

beforeEach(() => {
  fx.status = status();
  fx.calls.register = [];
  fx.calls.unregister = [];
});

afterEach(() => {
  cleanup();
});

describe("McpServerBlock (PR-CI2)", () => {
  it("미등록 + 바이너리 있음: 등록 → mcpRegister(projectId) 호출, 배지 갱신", async () => {
    const r = render(<McpServerBlock projectId={9} />);
    await waitFor(() => expect(r.getByText("미등록")).toBeTruthy());

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
    await waitFor(() => expect(r.getByText("미등록")).toBeTruthy());
  });

  it("Desktop 스니펫 복사 버튼이 클립보드에 스니펫을 쓴다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const r = render(<McpServerBlock projectId={3} />);
    await waitFor(() => expect(r.getByText("미등록")).toBeTruthy());
    fireEvent.click(r.getByRole("button", { name: "Desktop 스니펫 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("oculpm-proj")));
    await waitFor(() => expect(r.getByText("복사됨")).toBeTruthy());
  });
});
