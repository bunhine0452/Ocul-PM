/**
 * 단축키 표의 「지금 화면」 계약 (11-15).
 *
 * 치트시트는 창 최상위(AppWindow)라 화면 상태(WorkspaceContext) 바깥에 산다 — 그래서 지금 화면을 윗줄 DOM 에서
 * 읽는다(`viewOnScreen`: `.topbar .topnav` 의 aria-current 탭 순번 → NAV_ENTRIES). 윗줄은 다른 레인이 고치는
 * 파일이라, 감싸는 요소나 순서가 바뀌면 오류 없이 엉뚱한 묶음이 맨 앞에 선다. 그 계약을 **실제 TopBar** 로 문다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
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
  projectsApi: {
    brief: async () => ({ projects: [], today_workday: "20261115", since_workday: "20261115", today_total: 0, active_projects: 0, feed: [] }),
    onJournalAdded: () => Promise.resolve(() => {}),
  },
}));

import { viewOnScreen } from "@/components/ShortcutCheatsheet";
import type { UiV2View } from "@/contexts/uiV2View";
import { TopBar } from "@/features/shell/TopBar";
import { NAV_ENTRIES } from "@/lib/navRegistry";

afterEach(() => cleanup());

function bar(view: UiV2View) {
  render(
    <TopBar
      view={view}
      onNavigate={() => {}}
      projectName="ai-pm"
      currentProjectId={1}
      projects={[]}
      onOpenProject={() => {}}
      slotRef={() => {}}
    />,
  );
}

describe("viewOnScreen reads the real top bar", () => {
  it("every tab — the current screen is the one the bar marks", () => {
    for (const e of NAV_ENTRIES) {
      bar(e.id);
      expect(viewOnScreen(), e.id).toBe(e.id);
      cleanup();
    }
  });

  it("settings (the gear, not a tab) and the start window (no bar)", () => {
    bar("settings");
    expect(viewOnScreen()).toBe("settings");
    cleanup();
    expect(viewOnScreen()).toBeNull();
  });
});
