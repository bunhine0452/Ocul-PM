import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

import { Sidebar } from "@/components/Sidebar";
import type { UiV2View } from "@/contexts/WorkspaceContext";

// ─── PR-UI 1 — ui_v2 Sidebar a11y + nav contract ─────────────────────────
//
// DoD (05-implementation-checklist §1 PR-UI 1): axe-core sidebar violations 0,
// and the 10 slots (4 main + 4 tools + dark toggle + settings) drive navigation.
// Sidebar is a pure presentational component (props in, callbacks out), so we
// test it standalone without the providers.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: {
    // jsdom has no real layout engine; axe color-contrast needs one.
    "color-contrast": { enabled: false },
  },
} as const;

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const calls: UiV2View[] = [];
  let themeToggled = 0;
  let switcherOpened = 0;
  const utils = render(
    <Sidebar
      view="today"
      onNavigate={(v) => calls.push(v)}
      projectName="aurora-web"
      projectPath="~/dev/aurora-web"
      onOpenProjectSwitcher={() => {
        switcherOpened += 1;
      }}
      isDark={false}
      onToggleTheme={() => {
        themeToggled += 1;
      }}
      {...overrides}
    />,
  );
  return {
    ...utils,
    calls,
    getThemeToggled: () => themeToggled,
    getSwitcherOpened: () => switcherOpened,
  };
}

afterEach(() => cleanup());

describe("PR-UI 1 — Sidebar a11y", () => {
  it("has no axe violations (light)", async () => {
    const { container } = renderSidebar();
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("has no axe violations (dark)", async () => {
    const { container } = renderSidebar({ isDark: true });
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});

describe("PR-UI 1 — Sidebar navigation", () => {
  it("renders all 10 slots", () => {
    const { getByText } = renderSidebar();
    for (const label of [
      "오늘 현황",
      "작업 일지",
      "Diff",
      "플래너",
      "코드 검색",
      "코드 맵",
      "터미널",
      "AI 대화",
      "다크 모드",
      "설정",
    ]) {
      expect(getByText(label)).toBeInTheDocument();
    }
  });

  it("clicking a main/tool slot navigates", () => {
    const { getByText, calls } = renderSidebar();
    fireEvent.click(getByText("Diff"));
    fireEvent.click(getByText("AI 대화"));
    fireEvent.click(getByText("설정"));
    expect(calls).toEqual(["diff", "ai", "settings"]);
  });

  it("marks the active slot with aria-current", () => {
    const { getByText } = renderSidebar({ view: "journal" });
    expect(getByText("작업 일지").closest("button")).toHaveAttribute("aria-current", "page");
    expect(getByText("오늘 현황").closest("button")).not.toHaveAttribute("aria-current");
  });

  it("dark toggle fires; project button opens the inline switcher whose 관리 item fires onOpenProjectSwitcher", () => {
    const u = renderSidebar();
    fireEvent.click(u.getByText("다크 모드"));
    // The project button now opens an inline quick-switch popover instead of
    // jumping to the main screen; the "관리" item is the explicit escape hatch.
    fireEvent.click(u.getByText("aurora-web"));
    fireEvent.click(u.getByText(/프로젝트 관리/));
    expect(u.getThemeToggled()).toBe(1);
    expect(u.getSwitcherOpened()).toBe(1);
  });

  it("shows the light-mode label when dark", () => {
    const { getByText, queryByText } = renderSidebar({ isDark: true });
    expect(getByText("라이트 모드")).toBeInTheDocument();
    expect(queryByText("다크 모드")).toBeNull();
  });
});
