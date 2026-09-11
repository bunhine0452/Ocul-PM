import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

// 2026-09-11 영문 스크린샷 촬영에서 잡은 회귀 — `b3984c2`(09-06) 가 라우터 사슬의
// 폴백을 `null`→Today 로 바꿨는데, Claude Code/Codex 두 화면은 **keep-alive
// 컨테이너가 따로 그린다**. 사슬은 그 둘을 모르니 폴백으로 떨어져 Today 가
// ACP 화면 뒤에 통째로 마운트됐다: 툴바가 ACP 머리 위에 얹히고 브리프까지
// 이중으로 읽었다. 여기서 지키는 것은 「ACP 화면일 때 툴바는 하나」다.

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
  invoke: () => Promise.resolve(),
}));

const ACP_SESSION = {
  agent: { name: "claude-code", title: "Claude Code", version: "0.76.0", auth_required: false, supports_image: true },
  commands: [],
  session_id: "sess-1",
  title: null,
  options: [],
};

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "listProjects") return () => ok([]);
          if (prop === "settingsGetAll") return () => ok([]);
          if (prop === "acpStart" || prop === "acpNewSession") return () => ok(ACP_SESSION);
          if (prop === "acpListSessions") return () => ok([]);
          if (prop === "acpUsage") return () => ok(null);
          if (prop === "listTerminalWindows") return () => ok([]);
          if (prop === "oculpmWorkdayBrief")
            return () =>
              ok({ days: [], lines_added: 0, lines_removed: 0, files_touched: 0, open_plan_items: [], total_entries: 0 });
          if (prop === "gitStatus")
            return () => ok({ is_git_repo: false, head_branch: null, remotes: [], repo: null });
          if (prop === "gitLog" || prop === "gitGraph" || prop === "gitUncommittedChanges") return () => ok([]);
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

vi.mock("@/api/oculpm", () => ({
  oculpmApi: new Proxy({}, { get: () => async () => ({ entries: [], sessions: [], items: [] }) }),
  OculpmApiError: class extends Error {},
}));

import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import ShellV2 from "@/features/shell/ShellV2";
import { useEffect } from "react";

function GoTo({ view }: { view: string }) {
  const ws = useWorkspace();
  useEffect(() => {
    ws.setUiV2View(view as never);
  }, [ws, view]);
  return null;
}

afterEach(cleanup);

const noop = () => {};

describe("ACP 화면은 Today 폴백을 타지 않는다", () => {
  it("Claude Code 화면에서 툴바는 하나뿐이고 그것은 Today 가 아니다", async () => {
    localStorage.clear();
    const { container } = render(
      <SettingsProvider>
        <WorkspaceProvider projectId={1}>
          <GoTo view="claudecode" />
          <ShellV2 projectName="ai-pm" projectRoot="/repo" onOpenProjectSwitcher={noop} onOpenProject={noop} />
        </WorkspaceProvider>
      </SettingsProvider>,
    );
    await waitFor(() => {
      const bars = container.querySelectorAll(".toolbar");
      if (bars.length === 0) throw new Error("툴바가 아직 없다");
    });
    await new Promise((r) => setTimeout(r, 200));
    const titles = [...container.querySelectorAll(".toolbar-title")].map((el) => el.textContent?.trim());
    expect(titles.filter((x) => x === "오늘 현황" || x === "Today")).toEqual([]);
    expect(container.querySelectorAll(".toolbar").length).toBe(1);
  });
});
