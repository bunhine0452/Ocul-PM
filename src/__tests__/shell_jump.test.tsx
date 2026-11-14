// ⌘J 와 「이 세션을 보여 줘」 요청 (11-15) — 셸이 요청마다 화면을 터미널로 옮기고, 세션 id 는 터미널 화면이
// 꺼낼 몫으로 남는다. 오늘의 「터미널에서 보기」 · 알림 착지 · ⌘J 가 같은 길이다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fx = vi.hoisted(() => ({ sessions: [] as unknown[] }));

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: new Proxy({}, { get: (_t, prop) => (prop === "onFileChanged" ? () => Promise.resolve(() => {}) : async () => null) }),
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => fx.sessions,
    overview: async () => [],
    onSessionsChanged: async () => () => {},
    takeResume: async () => [],
  },
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    openProjectWindow: async () => null,
    openProjectIds: async () => [],
    attention: async () => new Map(),
    onAttentionChanged: async () => () => {},
  },
}));
vi.mock("@/api/projects", () => ({
  projectsApi: { brief: async () => null, onJournalAdded: () => Promise.resolve(() => {}) },
}));
vi.mock("@/features/today/TodayScreenV2", () => ({ TodayScreenV2: () => <div data-testid="screen">today</div> }));
vi.mock("@/features/oculpm/JournalScreenV2", () => ({ JournalScreenV2: () => <div data-testid="screen">journal</div> }));
vi.mock("@/features/planner/PlannerScreenV2", () => ({ PlannerScreenV2: () => <div data-testid="screen">planner</div> }));
vi.mock("@/features/diff/DiffScreenV2", () => ({ DiffScreenV2: () => <div data-testid="screen">diff</div> }));
vi.mock("@/features/settings/SettingsPage", () => ({ SettingsPage: () => <div data-testid="screen">settings</div> }));
vi.mock("@/features/terminal/TerminalScreen", () => ({ TerminalScreen: () => <div data-testid="screen">terminal</div> }));

import ShellV2 from "@/features/shell/ShellV2";
import { __resetJumpForTests, jumpToWaiting } from "@/features/shell/jumpWaiting";
import { requestTermFocus, takeTermFocus } from "@/features/terminal/focusRequest";
import { WorkspaceProvider, useUiPrefs } from "@/contexts/WorkspaceContext";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import type { Project, TermInfo } from "@/lib/bindings";

const PROJECTS: Project[] = [
  { id: 1, name: "ai-pm", root_path: "/Users/me/ai-pm", created_at: 1, icon: null, color: null },
  { id: 2, name: "naeri", root_path: "/Users/me/naeri", created_at: 2, icon: null, color: null },
];

function blocked(id: number, since: string): TermInfo {
  return {
    id,
    project_id: 1,
    label: "claude",
    started_at: "2026-11-15T09:00:00Z",
    alive: true,
    exit_code: null,
    status: { state: "blocked", kind: "permission", msg: null, since },
    busy: true,
    unseen: false,
  };
}

/** ProjectWindow 의 배선 그대로 — 전역 단축키(⌘J 포함) + 셸. */
function Harness() {
  const { setUiV2View } = useUiPrefs();
  useGlobalShortcuts({
    onOpenPalette: () => {},
    uiV2Nav: setUiV2View,
    onJumpWaiting: () => void jumpToWaiting(1, PROJECTS.map((p) => p.id)),
  });
  return <ShellV2 projectName="ai-pm" projectRoot="/Users/me/ai-pm" projects={PROJECTS} onOpenProject={() => {}} />;
}

/** 시험마다 다른 프로젝트 — 워크스페이스 레코드(마지막 화면)가 앞 시험에서 새지 않게. */
let nextProject = 100;

async function mount() {
  render(
    <WorkspaceProvider projectId={nextProject++}>
      <Harness />
    </WorkspaceProvider>,
  );
  await act(async () => {});
}

const current = () => screen.getByTestId("screen").textContent;

beforeEach(() => {
  fx.sessions = [blocked(5, "2026-11-15T10:05:00Z"), blocked(4, "2026-11-15T10:00:00Z")];
});
afterEach(() => {
  cleanup();
  takeTermFocus();
  __resetJumpForTests();
  document.body.innerHTML = "";
});

describe("⌘J — my turn", () => {
  it("asks for the session that has waited longest and moves the shell to the terminal", async () => {
    await mount();
    expect(current()).toBe("today");
    await act(async () => void fireEvent.keyDown(window, { key: "j", code: "KeyJ", metaKey: true }));
    await waitFor(() => expect(current()).toBe("terminal"));
    // 고를 세션은 꺼내지 않고 남는다 — 늦게 서는 터미널 화면이 꺼낸다.
    expect(takeTermFocus()).toBe(4);
  });

  it("does nothing while a dialog is open", async () => {
    await mount();
    const modal = document.body.appendChild(document.createElement("div"));
    modal.setAttribute("aria-modal", "true");
    await act(async () => void fireEvent.keyDown(window, { key: "j", code: "KeyJ", metaKey: true }));
    expect(current()).toBe("today");
    expect(takeTermFocus()).toBeNull();
  });
});

describe("requestTermFocus alone", () => {
  it("moves the shell to the terminal — Today's row, a notification and ⌘J share this road", async () => {
    await mount();
    act(() => requestTermFocus(7));
    await waitFor(() => expect(current()).toBe("terminal"));
    expect(takeTermFocus()).toBe(7);
  });
});
