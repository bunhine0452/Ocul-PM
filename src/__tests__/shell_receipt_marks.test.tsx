/**
 * 프로젝트 줄의 표시가 영수증 규칙을 지킨다 (11-15 최종 검수).
 *
 *  - 「새 소식」 의 점이 파랑(--info)이었다 — 공통 줄을 타고 ⌘O · 시작 창 · ⌘K · ⌥Tab 까지 번졌다. 영수증 팔레트에
 *    파랑은 없다(규칙 1): 점은 회색이고, 쓰는 곳 없는 .chip.info 도 걷었다.
 *  - 「지금 프로젝트」 를 ⌘O 는 강조색 ✓(#5fe0ab), ⌥Tab 은 회색 글자 「지금 창」 으로 달리 말했다(규칙 4). 이제 둘 다
 *    회색 ✓ 칩 하나(`.chip.ok` · `HereMark`).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    recentProjects: async () => [1, 2],
    openProjectWindow: async () => null,
    openProjectIds: async () => [],
    attention: async () => new Map(),
    onAttentionChanged: async () => () => {},
  },
}));
vi.mock("@/api/projects", () => ({ projectsApi: { brief: async () => null, list: async () => [] } }));
vi.mock("@/api/terminal", () => ({
  terminalApi: { overview: async () => [], onSessionsChanged: async () => () => {} },
}));

import { ProjectRow } from "@/features/shell/ProjectRow";
import { ProjectSwitcher } from "@/features/shell/ProjectSwitcher";
import { WindowSwitcher } from "@/features/shell/WindowSwitcher";
import { t } from "@/i18n";
import type { Project } from "@/lib/bindings";
import { NAV_BUS } from "@/lib/navRegistry";

import { ROOT, read, walk } from "./designFs";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PROJECTS: Project[] = [
  { id: 1, name: "ai-pm", root_path: "/Users/me/ai-pm", created_at: 2, icon: null, color: "teal" },
  { id: 2, name: "naeri", root_path: "/Users/me/naeri", created_at: 1, icon: null, color: null },
];

const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const PRIM = noComments(read("styles/primitives.css"));
const rule = (css: string, sel: string) => {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].trim() === sel) return m[2];
  throw new Error(`no ${sel}`);
};

describe("the 「news」 dot is grey — there is no blue in the receipt palette", () => {
  it("the dot paints --text-2, .chip.info is gone, and no screen CSS paints --info", () => {
    expect(rule(PRIM, ".terms-unseen")).toMatch(/background:\s*var\(--text-2\)/);
    expect(PRIM).not.toMatch(/\.chip\.info\b/);
    const painters = [...walk(ROOT)]
      .filter((f) => f.endsWith(".css") && !f.endsWith("/styles/tokens.css"))
      .filter((f) => /var\(--info/.test(noComments(read(f.slice(ROOT.length + 1)))));
    expect(painters).toEqual([]);
  });

  it("the row still marks unseen news inside the neutral chip", () => {
    render(<ProjectRow project={PROJECTS[1]} signals={{ terms: { alive: 0, waiting: 0, unseen: true } }} />);
    const chip = screen.getByText(t("terminal.sum.unseen"));
    expect(chip.className).toBe("prow-chip chip sm");
    expect(chip.querySelector(".terms-unseen")).not.toBeNull();
  });
});

describe("「this window」 has one shape in ⌘O and ⌥Tab", () => {
  it("⌘O: the current project's row ends in the grey ✓ chip, not an accent tick", async () => {
    render(<ProjectSwitcher projectName="ai-pm" currentProjectId={1} projects={PROJECTS} onOpenProject={() => {}} />);
    act(() => void window.dispatchEvent(new Event(NAV_BUS.openProjectSwitcher)));
    const current = await waitFor(() => screen.getAllByRole("option").find((o) => o.getAttribute("aria-current") === "true")!);
    const mark = current.querySelector(".prow-meta > .chip")!;
    expect(mark.className).toBe("chip sm ok");
    expect(mark.textContent).toBe(t("switcher.here"));
    expect(current.querySelector(".proj-pop-check, svg")).toBeNull();
    expect(read("styles/shell.css")).not.toMatch(/proj-pop-check/);
  });

  it("⌥Tab: the current window's row wears the very same chip", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<WindowSwitcher currentProjectId={1} projects={PROJECTS} />);
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { code: "Tab", key: "Tab", altKey: true })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const here = screen.getAllByRole("option")[0];
    const mark = here.querySelector(".prow-meta > .chip")!;
    expect(mark.className).toBe("chip sm ok");
    expect(mark.textContent).toBe(t("switcher.here"));
    expect(screen.getAllByRole("option")[1].querySelector(".chip.ok")).toBeNull();
  });
});
