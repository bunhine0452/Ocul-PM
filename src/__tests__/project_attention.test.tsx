// Waiting signals across project windows (11-02, commands/window/attention.rs) — the ⌘O list puts the
// project Claude waits on first, ⌥⌘1 follows the same order, and each row says why.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  attention: new Map<number, { project_id: number; waiting: number; failing: boolean }>(),
}));

vi.mock("@/api/projects", () => ({ projectsApi: { brief: async () => null } }));
vi.mock("@/api/terminal", () => ({
  terminalApi: { overview: async () => [], onSessionsChanged: async () => () => {} },
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    openProjectIds: async () => [],
    attention: async () => fx.attention,
    onAttentionChanged: async () => () => {},
  },
}));

import { ProjectSwitcher } from "@/features/shell/ProjectSwitcher";
import { byAttention } from "@/features/shell/projectKeys";
import { __resetLangForTests, setLangSetting, t } from "@/i18n";
import type { Project } from "@/lib/bindings";
import { __setPlatformForTests } from "@/lib/platform";
import { NAV_BUS } from "@/lib/navRegistry";

const projects = [
  { id: 1, name: "a", root_path: "/a", created_at: 4 },
  { id: 2, name: "b", root_path: "/b", created_at: 3 },
  { id: 3, name: "c", root_path: "/c", created_at: 2 },
  { id: 4, name: "d", root_path: "/d", created_at: 1 },
] as unknown as Project[];

afterEach(() => {
  cleanup();
  __setPlatformForTests(null);
  __resetLangForTests();
  fx.attention = new Map();
});

describe("byAttention", () => {
  it("waiting first, then failing, keeping recency inside each group", () => {
    const a = new Map([
      [3, { waiting: 0, failing: true }],
      [4, { waiting: 2, failing: false }],
      [2, { waiting: 1, failing: true }],
    ]);
    expect(byAttention(projects, a).map((p) => p.id)).toEqual([2, 4, 3, 1]);
    expect(byAttention(projects, new Map()).map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("project switcher", () => {
  it("⌥⌘1 opens the project Claude is waiting on", async () => {
    __setPlatformForTests("mac");
    fx.attention = new Map([[3, { project_id: 3, waiting: 1, failing: false }]]);
    const onOpenProject = vi.fn();
    render(<ProjectSwitcher projectName="a" currentProjectId={1} projects={projects} onOpenProject={onOpenProject} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", metaKey: true, altKey: true }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(3));
  });

  it("rows say waiting and failed check, waiting on top", async () => {
    setLangSetting("ko");
    fx.attention = new Map([
      [4, { project_id: 4, waiting: 2, failing: false }],
      [2, { project_id: 2, waiting: 0, failing: true }],
    ]);
    render(<ProjectSwitcher projectName="a" currentProjectId={1} projects={projects} onOpenProject={vi.fn()} />);
    fireEvent(window, new Event(NAV_BUS.openProjectSwitcher));
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getAllByRole("menuitem")[0]).toHaveTextContent("d"));
    const rows = within(menu).getAllByRole("menuitem");
    expect(rows[0]).toHaveTextContent(t("sidebar.waiting", { n: 2 }));
    expect(rows[1]).toHaveTextContent(t("sidebar.failing"));
  });
});
