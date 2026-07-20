import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-CI0 — 설정 Agents 섹션의 Claude Code 훅 연동 블록 ───────────────────
//
// 백엔드(claude_hooks_* 커맨드)는 Proxy mock 으로 대체하고, 변이 커맨드 호출
// 인자를 수집해 "토글 조작 → 올바른 커맨드 계약" 을 검증한다 (skills_v2 패턴).
// 상태 SSOT 는 디스크(settings.local.json)라는 설계라 UI 는 항상 커맨드
// 응답의 status 객체를 그대로 반영해야 한다.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

function status(over: Record<string, unknown> = {}) {
  return {
    installed: false,
    partial: false,
    foreign_hooks: false,
    settings_path: "/tmp/proj/.claude/settings.local.json",
    inbox_bytes: 0,
    ...over,
  };
}

const fx = {
  status: status() as Record<string, unknown>,
  statusError: null as string | null,
  calls: {
    install: [] as unknown[][],
    uninstall: [] as unknown[][],
  },
};

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  const err = (error: string) => Promise.resolve({ status: "error" as const, error });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "claudeHooksStatus":
              return () => (fx.statusError ? err(fx.statusError) : ok(fx.status));
            case "claudeHooksInstall":
              return (...a: unknown[]) => {
                fx.calls.install.push(a);
                return ok(status({ installed: true }));
              };
            case "claudeHooksUninstall":
              return (...a: unknown[]) => {
                fx.calls.uninstall.push(a);
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

import { ClaudeHooksBlock } from "@/features/settings/OculpmSettings";

beforeEach(() => {
  fx.status = status();
  fx.statusError = null;
  fx.calls.install = [];
  fx.calls.uninstall = [];
});

afterEach(() => {
  cleanup();
});

describe("ClaudeHooksBlock (PR-CI0)", () => {
  it("미설치 상태: '꺼짐' 배지 + 켜기 → install 커맨드가 projectId 로 불리고 배지가 갱신된다", async () => {
    const r = render(<ClaudeHooksBlock projectId={7} />);
    await waitFor(() => expect(r.getByText("꺼짐")).toBeTruthy());

    fireEvent.click(r.getByRole("button", { name: "켜기" }));
    await waitFor(() => expect(fx.calls.install).toHaveLength(1));
    expect(fx.calls.install[0][0]).toBe(7);
    await waitFor(() => expect(r.getByText("연동됨")).toBeTruthy());
    // 설치 후에는 끄기 버튼이 보인다.
    expect(r.getByRole("button", { name: "끄기" })).toBeTruthy();
  });

  it("설치 상태: 끄기 → uninstall 커맨드, 배지가 '꺼짐' 으로 돌아온다", async () => {
    fx.status = status({ installed: true });
    const r = render(<ClaudeHooksBlock projectId={3} />);
    await waitFor(() => expect(r.getByText("연동됨")).toBeTruthy());

    fireEvent.click(r.getByRole("button", { name: "끄기" }));
    await waitFor(() => expect(fx.calls.uninstall).toHaveLength(1));
    expect(fx.calls.uninstall[0][0]).toBe(3);
    await waitFor(() => expect(r.getByText("꺼짐")).toBeTruthy());
  });

  it("드리프트(partial): 경고 배지 + 재설치 버튼이 install 을 다시 부른다", async () => {
    fx.status = status({ partial: true });
    const r = render(<ClaudeHooksBlock projectId={1} />);
    await waitFor(() => expect(r.getByText("드리프트 — 재설치 필요")).toBeTruthy());

    fireEvent.click(r.getByRole("button", { name: "재설치" }));
    await waitFor(() => expect(fx.calls.install).toHaveLength(1));
    await waitFor(() => expect(r.getByText("연동됨")).toBeTruthy());
  });

  it("설정 파일 파싱 오류: 오류 배지 + 메시지, 켜기는 비활성 (깨진 파일 덮어쓰기 방지 계약)", async () => {
    fx.statusError = "json parse error in .claude/settings.local.json";
    const r = render(<ClaudeHooksBlock projectId={1} />);
    await waitFor(() => expect(r.getByText("설정 파일 오류")).toBeTruthy());
    expect(r.getByText(/json parse error/)).toBeTruthy();
    const enable = r.getByRole("button", { name: "켜기" }) as HTMLButtonElement;
    expect(enable.disabled).toBe(true);
    fireEvent.click(enable);
    expect(fx.calls.install).toHaveLength(0);
  });

  it("사용자 정의 훅 감지 안내가 foreign_hooks 일 때만 보인다", async () => {
    fx.status = status({ installed: true, foreign_hooks: true });
    const r = render(<ClaudeHooksBlock projectId={1} />);
    await waitFor(() => expect(r.getByText(/사용자 정의 훅이 감지/)).toBeTruthy());
  });

  it("a11y — axe 위반 0", async () => {
    fx.status = status({ installed: true });
    const r = render(<ClaudeHooksBlock projectId={1} />);
    await waitFor(() => expect(r.getByText("연동됨")).toBeTruthy());
    const results = await axe(r.container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });
});
