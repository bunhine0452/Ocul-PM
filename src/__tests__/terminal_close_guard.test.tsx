// 실행 중인 터미널 세션이 있는 창 닫기 · 앱 끄기 확인 (ui-audit #term-close-guard)과
// 프로젝트별 세션 세기 (#term-running-badge).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

import type { TermCloseAsked, TermInfo } from "@/api/terminal";

const api = vi.hoisted(() => ({
  ask: null as ((a: TermCloseAsked) => void) | null,
  windowSessions: [] as TermInfo[],
  allSessions: [] as TermInfo[],
  calls: [] as string[],
}));

vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => api.windowSessions,
    overview: async () => api.allSessions,
    endWindow: async () => void api.calls.push("endWindow"),
    onCloseAsked: async (cb: (a: TermCloseAsked) => void) => {
      api.ask = cb;
      return () => {
        api.ask = null;
      };
    },
    onSessionsChanged: async () => () => {},
  },
}));
vi.mock("@/api/window", () => ({
  windowApi: { closeThisWindow: async () => void api.calls.push("closeThisWindow") },
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  exit: async (code: number) => void api.calls.push(`exit:${code}`),
}));

import { __resetLangForTests, setLangSetting, t } from "@/i18n";
import { useTermCloseGuard } from "@/features/terminal/useTermCloseGuard";
import { countByProject, useWindowTerms } from "@/features/terminal/status";
import { terminalApi } from "@/api/terminal";
import type { Project } from "@/lib/bindings";

function session(id: number, projectId: number, extra: Partial<TermInfo> = {}): TermInfo {
  return {
    id,
    project_id: projectId,
    label: "claude",
    started_at: "2026-10-29T10:00:00Z",
    alive: true,
    exit_code: null,
    status: null,
    busy: true,
    ...extra,
  };
}

const projects = [
  { id: 1, name: "ai-pm" },
  { id: 2, name: "saju" },
] as unknown as Project[];

function Host() {
  return <>{useTermCloseGuard(projects)}</>;
}

beforeEach(() => {
  setLangSetting("ko");
  api.ask = null;
  api.calls.length = 0;
  api.windowSessions = [];
  api.allSessions = [];
});
afterEach(() => {
  cleanup();
  __resetLangForTests();
});

describe("창 닫기 확인", () => {
  it("묻고, 「닫기」면 세션을 끝낸 뒤 창을 다시 닫는다", async () => {
    api.windowSessions = [
      session(1, 1, { status: { state: "blocked", kind: "permission", msg: null, since: "" } }),
      session(2, 1, { alive: false, exit_code: 0, busy: false }),
      session(3, 1, { busy: false }),
    ];
    render(<Host />);
    await waitFor(() => expect(api.ask).not.toBeNull());
    await act(async () => api.ask?.({ alive: 1, quit: false }));
    expect(await screen.findByText(t("terminal.closeAsk.title", { n: 1 }))).toBeInTheDocument();
    // 끝난 세션 · 빈 셸은 걸린 것이 아니다 — 무언가 도는 것만 낱개로 보인다.
    expect(screen.getByText(`claude · ${t("terminal.state.permission")}`)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("terminal.closeAsk.confirm") }));
    });
    await waitFor(() => expect(api.calls).toEqual(["endWindow", "closeThisWindow"]));
  });

  it("취소하면 아무것도 끝내지 않는다", async () => {
    api.windowSessions = [session(1, 1)];
    render(<Host />);
    await waitFor(() => expect(api.ask).not.toBeNull());
    await act(async () => api.ask?.({ alive: 1, quit: false }));
    await screen.findByText(t("terminal.closeAsk.title", { n: 1 }));
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByText(t("terminal.closeAsk.title", { n: 1 }))).toBeNull());
    expect(api.calls).toEqual([]);
  });

  it("앱 끄기는 모든 창의 세션을 프로젝트 이름과 함께 보이고, 「끄기」면 앱을 끈다", async () => {
    api.allSessions = [session(1, 1), session(4, 2)];
    render(<Host />);
    await waitFor(() => expect(api.ask).not.toBeNull());
    await act(async () => api.ask?.({ alive: 2, quit: true }));
    expect(await screen.findByText(t("terminal.quitAsk.title", { n: 2 }))).toBeInTheDocument();
    expect(screen.getByText(`saju · claude · ${t("terminal.running")}`)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("terminal.quitAsk.confirm") }));
    });
    await waitFor(() => expect(api.calls).toEqual(["exit:0"]));
  });
});

describe("목록을 못 읽을 때", () => {
  it("배열이 아닌 답(봉투 · null)은 빈 목록으로 — 오늘 화면이 죽지 않는다", async () => {
    const list = vi.spyOn(terminalApi, "list").mockResolvedValue({ status: "ok", data: null } as unknown as TermInfo[]);
    const { result } = renderHook(() => useWindowTerms());
    await waitFor(() => expect(list).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual([]);
    list.mockRestore();
  });
});

describe("프로젝트별 세션 세기", () => {
  it("무언가 도는 것만 세고(빈 셸 · 끝난 세션 제외), 내 손을 기다리는 것을 따로 센다", () => {
    const counts = countByProject([
      session(1, 1),
      session(2, 1, { status: { state: "blocked", kind: "question", msg: null, since: "" } }),
      session(3, 1, { alive: false, busy: false }),
      session(5, 1, { busy: false }),
      session(4, 2, { status: { state: "working", kind: null, msg: null, since: "" } }),
    ]);
    expect(counts.get(1)).toEqual({ alive: 2, waiting: 1 });
    expect(counts.get(2)).toEqual({ alive: 1, waiting: 0 });
    expect(counts.has(3)).toBe(false);
  });
});
