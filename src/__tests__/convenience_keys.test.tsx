// Convenience round (2026-11-03): terminal text size keys, previous/next session, ask before closing a
// busy session, and typing to filter the ⌘O project list.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { TermInfo } from "@/api/terminal";

const h = vi.hoisted(() => {
  let list: TermInfo[] = [];
  const subs = new Set<() => void>();
  return {
    get list() {
      return list;
    },
    set(next: TermInfo[]) {
      list = next;
      for (const fn of subs) fn();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    closed: [] as number[],
    focused: [] as number[],
    fonts: [] as number[],
    busy: new Set<number>(),
  };
});

vi.mock("@/features/terminal/termStore", () => ({
  subscribeTerms: h.subscribe,
  termsSnapshot: () => h.list,
  openTerm: async () => 0,
  mountTerm: () => () => {},
  pasteToTerm: () => {},
  focusTerm: (id: number) => {
    h.focused.push(id);
  },
  hasWorked: () => false,
  findInTerm: () => true,
  onFindResult: () => () => {},
  clearFind: () => {},
  setTermFontSize: (px: number) => {
    h.fonts.push(px);
  },
  closeTerm: (id: number) => {
    h.closed.push(id);
    h.set(h.list.filter((s) => s.id !== id));
  },
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => h.list.map((s) => ({ ...s, busy: h.busy.has(s.id) })),
    overview: async () => [],
    onSessionsChanged: async () => () => {},
  },
}));
vi.mock("@/api/oculpm", () => ({ oculpmApi: { listJournalEntries: async () => [] } }));
vi.mock("@/api/projects", () => ({ projectsApi: { onJournalAdded: async () => () => {}, brief: async () => null } }));
vi.mock("@/api/window", () => ({
  windowApi: { openProjectIds: async () => [], attention: async () => new Map(), onAttentionChanged: async () => () => {} },
}));

import { t } from "@/i18n";
import { TerminalScreen, __resetTermLayoutForTests } from "@/features/terminal/TerminalScreen";
import { clampTermFont, termFontKey } from "@/features/terminal/termFontSize";
import { ProjectSwitcher } from "@/features/shell/ProjectSwitcher";
import type { Project } from "@/lib/bindings";
import { __setPlatformForTests } from "@/lib/platform";

function info(id: number, label: string): TermInfo {
  return {
    id,
    project_id: 1,
    label,
    started_at: "2026-11-03T00:00:00Z",
    alive: true,
    exit_code: null,
    status: null,
    busy: false,
    unseen: false,
  };
}

afterEach(() => {
  cleanup();
  __setPlatformForTests(null);
  __resetTermLayoutForTests();
  h.set([]);
  h.closed.length = 0;
  h.focused.length = 0;
  h.fonts.length = 0;
  h.busy.clear();
});

describe("terminal text size", () => {
  it("⌘= / ⌘- step by one within bounds, ⌘0 resets; other OSes use Ctrl", () => {
    __setPlatformForTests("mac");
    const k = (code: string, mods: Partial<KeyboardEvent> = {}) =>
      termFontKey({ code, metaKey: true, ctrlKey: false, altKey: false, ...mods }, 13);
    expect(k("Equal")).toBe(14);
    expect(k("Minus")).toBe(12);
    expect(k("Digit0")).toBe(13);
    expect(k("Equal", { altKey: true })).toBeNull();
    expect(k("KeyA")).toBeNull();
    expect(termFontKey({ code: "Equal", metaKey: true, ctrlKey: false, altKey: false }, 28)).toBe(28);
    expect(clampTermFont(Number.NaN)).toBe(13);
    __setPlatformForTests("linux");
    expect(termFontKey({ code: "Minus", metaKey: false, ctrlKey: true, altKey: false }, 9)).toBe(9);
  });

  it("the terminal screen applies the key to every session", async () => {
    __setPlatformForTests("mac");
    h.set([info(1, "zsh")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    await waitFor(() => expect(h.fonts).toContain(13));
    fireEvent.keyDown(window, { code: "Equal", key: "=", metaKey: true });
    expect(h.fonts[h.fonts.length - 1]).toBe(14);
  });
});

describe("terminal sessions", () => {
  it("⇧⌘] / ⇧⌘[ walk the sessions in tab order and wrap", async () => {
    __setPlatformForTests("mac");
    h.set([info(1, "one"), info(2, "two"), info(3, "three")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    const selected = () => screen.getByRole("tab", { selected: true }).textContent ?? "";
    const first = selected();
    fireEvent.keyDown(window, { code: "BracketRight", key: "}", metaKey: true, shiftKey: true });
    await waitFor(() => expect(selected()).not.toBe(first));
    fireEvent.keyDown(window, { code: "BracketLeft", key: "{", metaKey: true, shiftKey: true });
    await waitFor(() => expect(selected()).toBe(first));
  });

  it("closing a busy session asks first; an idle one closes straight away", async () => {
    h.set([info(1, "zsh"), info(2, "claude")]);
    h.busy.add(2);
    render(<TerminalScreen projectId={1} workday={null} />);
    fireEvent.click(screen.getByRole("button", { name: t("terminal.closeAria", { name: "claude" }) }));
    await screen.findByText(t("terminal.closeOneAsk.title", { name: "claude" }));
    expect(h.closed).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("terminal.closeAsk.confirm") }));
    });
    await waitFor(() => expect(h.closed).toEqual([2]));

    await waitFor(() => expect(screen.queryByText(t("terminal.closeOneAsk.title", { name: "claude" }))).toBeNull());
    act(() => h.set([info(1, "zsh"), info(3, "idle")]));
    fireEvent.click(await screen.findByRole("button", { name: t("terminal.closeAria", { name: "idle" }) }));
    await waitFor(() => expect(h.closed).toEqual([2, 3]));
  });
});

describe("project list filter", () => {
  const projects = [
    { id: 1, name: "ai-pm", root_path: "/w/ai-pm", created_at: 3, icon: null, color: null },
    { id: 2, name: "saju", root_path: "/w/saju", created_at: 2, icon: null, color: null },
    { id: 3, name: "blog", root_path: "/w/site/blog", created_at: 1, icon: null, color: null },
  ] as Project[];

  it("typing narrows by name or path, keeps the ⌥⌘ number, and Enter opens the first match", async () => {
    __setPlatformForTests("mac");
    const onOpenProject = vi.fn();
    const { container } = render(
      <ProjectSwitcher projectName="ai-pm" currentProjectId={1} projects={projects} onOpenProject={onOpenProject} />,
    );
    fireEvent.click(container.querySelector(".proj-switch")!);
    const find = await screen.findByRole("textbox", { name: t("sidebar.findProject") });
    fireEvent.change(find, { target: { value: "site" } });
    const rows = container.querySelectorAll(".proj-pop-item");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("blog");
    expect(rows[0].textContent).toContain("⌥⌘3");
    fireEvent.keyDown(find, { key: "Enter" });
    expect(onOpenProject).toHaveBeenCalledWith(3);
  });

  it("says so when nothing matches", async () => {
    const { container } = render(
      <ProjectSwitcher projectName="ai-pm" currentProjectId={1} projects={projects} onOpenProject={() => {}} />,
    );
    fireEvent.click(container.querySelector(".proj-switch")!);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "zzz" } });
    expect(screen.getByText(t("sidebar.findProjectNone"))).toBeTruthy();
  });
});
