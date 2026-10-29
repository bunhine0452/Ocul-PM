// 키로 프로젝트 창 바꾸기 (ocul-next #nav-projects) — macOS ⌥⌘1~9, Windows·Linux Alt+1~9.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@/api/projects", () => ({ projectsApi: { brief: async () => null } }));
vi.mock("@/api/terminal", () => ({
  terminalApi: { overview: async () => [], onSessionsChanged: async () => () => {} },
}));
vi.mock("@/api/window", () => ({
  windowApi: { openProjectIds: async () => [] },
}));

import { ProjectSwitcher } from "@/features/shell/ProjectSwitcher";
import { projectSlotLabel, projectSlotOf } from "@/features/shell/projectKeys";
import type { Project } from "@/lib/bindings";
import { __setPlatformForTests } from "@/lib/platform";

const key = (code: string, mods: Partial<KeyboardEventInit> & { target?: EventTarget | null } = {}) => ({
  code,
  metaKey: false,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  target: null,
  ...mods,
});

afterEach(() => {
  cleanup();
  __setPlatformForTests(null);
});

describe("프로젝트 번호 키", () => {
  it("macOS 는 ⌥⌘숫자만 — ⌘숫자(화면) · ⇧ · ⌃ 가 섞이면 아니다", () => {
    __setPlatformForTests("mac");
    expect(projectSlotOf(key("Digit2", { metaKey: true, altKey: true }))).toBe(1);
    expect(projectSlotOf(key("Digit2", { metaKey: true }))).toBeNull();
    expect(projectSlotOf(key("Digit2", { metaKey: true, altKey: true, shiftKey: true }))).toBeNull();
    expect(projectSlotOf(key("Digit0", { metaKey: true, altKey: true }))).toBeNull();
    expect(projectSlotLabel(0)).toBe("⌥⌘1");
  });

  it("Windows·Linux 는 Alt+숫자 — Ctrl 이 섞이면(AltGr · 화면 전환) 아니고, 터미널 위는 셸 몫", () => {
    __setPlatformForTests("windows");
    expect(projectSlotOf(key("Digit9", { altKey: true }))).toBe(8);
    expect(projectSlotOf(key("Digit9", { altKey: true, ctrlKey: true }))).toBeNull();
    const xterm = document.createElement("div");
    xterm.className = "xterm";
    const input = document.createElement("textarea");
    xterm.appendChild(input);
    expect(projectSlotOf(key("Digit1", { altKey: true, target: input }))).toBeNull();
    expect(projectSlotLabel(2)).toBe("Alt+3");
  });

  it("목록을 열지 않고 그 번호의 프로젝트 창을 연다 — 지금 창이면 그대로", async () => {
    __setPlatformForTests("mac");
    const projects = [
      { id: 1, name: "a", root_path: "/a", created_at: 3 },
      { id: 2, name: "b", root_path: "/b", created_at: 2 },
      { id: 3, name: "c", root_path: "/c", created_at: 1 },
    ] as unknown as Project[];
    const onOpenProject = vi.fn();
    render(<ProjectSwitcher projectName="a" currentProjectId={1} projects={projects} onOpenProject={onOpenProject} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", metaKey: true, altKey: true }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(3));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", metaKey: true, altKey: true }));
    await new Promise((r) => setTimeout(r, 10));
    expect(onOpenProject).toHaveBeenCalledTimes(1);
  });
});
