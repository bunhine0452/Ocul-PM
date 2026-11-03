// 창 전환기 (2026-11-04) — ⌥Tab(맥) · Ctrl+`(그 밖)를 누르고 있으면 최근 순 창 목록, 톡 누르면 직전 창.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { recent, openWin } = vi.hoisted(() => ({
  recent: vi.fn(async () => [1, 3, 2]),
  openWin: vi.fn(async (_id: number) => null),
}));
vi.mock("@/api/window", () => ({
  windowApi: { recentProjects: recent, openProjectWindow: openWin, attention: async () => new Map() },
}));

import { WindowSwitcher, firstPick, isSwitchKey } from "@/features/shell/WindowSwitcher";
import type { Project } from "@/lib/bindings";
import { __setPlatformForTests } from "@/lib/platform";

const projects = [
  { id: 1, name: "ai-pm", root_path: "/a", created_at: 3, icon: null, color: "blue" },
  { id: 2, name: "naeri", root_path: "/b", created_at: 2, icon: null, color: "green" },
  { id: 3, name: "blog", root_path: "/c", created_at: 1, icon: null, color: null },
] as Project[];

const tab = (init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { code: "Tab", key: "Tab", altKey: true, ...init });
const release = () => fireEvent.keyUp(window, { key: "Alt", code: "AltLeft" });

afterEach(() => {
  cleanup();
  recent.mockClear();
  openWin.mockClear();
  __setPlatformForTests(null);
  vi.useRealTimers();
});

describe("window switcher", () => {
  it("the key is ⌥Tab on macOS and Ctrl+` elsewhere", () => {
    __setPlatformForTests("mac");
    expect(isSwitchKey({ code: "Tab", altKey: true, ctrlKey: false, metaKey: false })).toBe(true);
    expect(isSwitchKey({ code: "Tab", altKey: true, ctrlKey: false, metaKey: true })).toBe(false);
    __setPlatformForTests("windows");
    expect(isSwitchKey({ code: "Backquote", altKey: false, ctrlKey: true, metaKey: false })).toBe(true);
    expect(isSwitchKey({ code: "Tab", altKey: true, ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("the first pick is the previous window (shift: the oldest), or the only one", () => {
    expect(firstPick(3, 1)).toBe(1);
    expect(firstPick(3, -1)).toBe(2);
    expect(firstPick(1, 1)).toBe(0);
  });

  it("a quick tap goes straight to the previous window without showing the list", async () => {
    __setPlatformForTests("mac");
    render(<WindowSwitcher currentProjectId={1} projects={projects} />);
    tab();
    release();
    await waitFor(() => expect(openWin).toHaveBeenCalledWith(3));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("holding shows windows in recent order; Tab steps and releasing goes there", async () => {
    __setPlatformForTests("mac");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<WindowSwitcher currentProjectId={1} projects={projects} />);
    tab();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent?.slice(0, 5))).toEqual(["ai-pm", "blog/", "naeri"]);
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    // 색 없는 프로젝트의 점은 data-pc 가 없다 — 이 창의 색을 물려받지 않는다.
    expect(options[1].querySelector(".proj-dot")?.hasAttribute("data-pc")).toBe(false);
    tab();
    expect(screen.getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");
    release();
    await waitFor(() => expect(openWin).toHaveBeenCalledWith(2));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("esc cancels without moving", async () => {
    __setPlatformForTests("mac");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<WindowSwitcher currentProjectId={1} projects={projects} />);
    tab();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    fireEvent.keyDown(window, { key: "Escape", code: "Escape", altKey: true });
    release();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(openWin).not.toHaveBeenCalled();
  });
});

describe("project colour does not inherit", () => {
  // 11-04 버그 — 윗줄의 --pc 가 색 없는 프로젝트의 점에 내려앉아, 이 창의 색을 바꾸면 한 번도 열지 않은
  // 프로젝트의 점까지 같이 바뀌어 보였다. --pc 는 등록된 비상속 속성이고, 창 안으로는 --win-pc 로만 내려간다.
  it("--pc and --pc-soft are registered with inherits: false", () => {
    const tokens = readFileSync(resolve(__dirname, "../styles/tokens.css"), "utf8");
    expect(tokens).toMatch(/@property --pc \{[^}]*inherits: false/);
    expect(tokens).toMatch(/@property --pc-soft \{[^}]*inherits: false/);
    const shell = readFileSync(resolve(__dirname, "../styles/shell.css"), "utf8");
    expect(shell).toMatch(/\.topbar\[data-pc\] \{[^}]*--win-pc: var\(--pc\)/);
  });
});

