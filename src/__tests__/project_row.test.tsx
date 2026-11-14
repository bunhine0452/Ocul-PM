// 프로젝트 줄 한 벌 (11-15) — ⌘O · 시작 창이 같은 칩, 겹치는 이름만 폴더, ⌘O 의 거르기 · 포커스 · 번호.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";

const fx = vi.hoisted(() => ({
  projects: [] as unknown[],
  attention: new Map<number, { project_id: number; waiting: number; failing: boolean }>(),
  attentionChanged: [] as Array<() => void>,
}));

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/api/projects", () => ({
  projectsApi: { brief: async () => null, list: async () => fx.projects },
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: { overview: async () => [], onSessionsChanged: async () => () => {} },
}));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: { compareWorkday: async () => ({ workday: "", sessions: [], unrecorded_total: 0 }) },
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    openProjectIds: async () => [],
    onOpenProjectsChanged: async () => () => {},
    attention: async () => new Map(fx.attention),
    onAttentionChanged: async (cb: () => void) => {
      fx.attentionChanged.push(cb);
      return () => {};
    },
    adoptProject: async () => true,
  },
}));

import { ProjectSwitcher } from "@/features/shell/ProjectSwitcher";
import { distinctWhere } from "@/features/shell/ProjectRow";
import { slotsOf } from "@/features/shell/projectKeys";
import { StartWindow } from "@/features/start/StartWindow";
import { t } from "@/i18n";
import type { Project } from "@/lib/bindings";
import { NAV_BUS } from "@/lib/navRegistry";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

const project = (id: number, name: string, root: string, created: number): Project => ({
  id,
  name,
  root_path: root,
  created_at: created,
  icon: null,
  color: null,
});

// 최근 순(created_at 큰 것이 앞) — a · b · c · d.
const P: Project[] = [
  project(1, "a", "/Users/me/a", 4),
  project(2, "b", "/Users/me/b", 3),
  project(3, "c", "/Users/me/c", 2),
  project(4, "d", "/Users/me/d", 1),
];

function openSwitcher(projects: Project[] = P, current = 1) {
  const r = render(<ProjectSwitcher projectName="a" currentProjectId={current} projects={projects} onOpenProject={vi.fn()} />);
  act(() => void window.dispatchEvent(new Event(NAV_BUS.openProjectSwitcher)));
  return r;
}

const find = () => screen.getByRole("combobox", { name: t("sidebar.findProject") });
const optionOf = (name: string) =>
  screen.getAllByRole("option").find((o) => o.querySelector(".prow-name")?.textContent === name)!;

beforeEach(() => {
  fx.projects = P;
  fx.attention = new Map();
  fx.attentionChanged = [];
});
afterEach(() => cleanup());

describe("one row, one chip", () => {
  it("the same waiting signal reads chip warn 「waiting 1」 in the ⌘O list and in the start window", async () => {
    fx.attention = new Map([[2, { project_id: 2, waiting: 1, failing: false }]]);
    openSwitcher();
    await waitFor(() => expect(optionOf("b").querySelector(".chip.warn")).toHaveTextContent(t("sidebar.waiting", { n: 1 })));
    cleanup();

    render(<StartWindow />);
    const name = await screen.findByText("b", { selector: ".prow-name" });
    await waitFor(() =>
      expect(name.closest("li")!.querySelector(".chip.warn")).toHaveTextContent(t("sidebar.waiting", { n: 1 })),
    );
  });

  it("shows a folder only for projects whose names collide", () => {
    const list = [project(1, "app", "/Users/me/work/app", 3), project(2, "App", "/Users/me/side/app", 2), project(3, "solo", "/Users/me/solo", 1)];
    expect([...distinctWhere(list)]).toEqual([
      [1, "~/work"],
      [2, "~/side"],
    ]);
    openSwitcher(list, 3);
    expect(optionOf("app").querySelector(".prow-where")).toHaveTextContent("~/work");
    expect(optionOf("App").querySelector(".prow-where")).toHaveTextContent("~/side");
    expect(optionOf("solo").querySelector(".prow-where")).toBeNull();
  });
});

describe("⌘O list", () => {
  it("keeps the typed filter and the focus when a same-content project array arrives", async () => {
    const { rerender } = openSwitcher();
    await waitFor(() => expect(document.activeElement).toBe(find()));
    fireEvent.change(find(), { target: { value: "b" } });
    rerender(<ProjectSwitcher projectName="a" currentProjectId={1} projects={P.map((p) => ({ ...p }))} onOpenProject={vi.fn()} />);
    await act(async () => {});
    expect(find()).toHaveValue("b");
    expect(document.activeElement).toBe(find());
  });

  it("↓ walks the project rows only and wraps — never into the colour swatches", async () => {
    openSwitcher();
    await waitFor(() => expect(document.activeElement).toBe(find()));
    const selected = () => screen.getAllByRole("option").findIndex((o) => o.getAttribute("aria-selected") === "true");
    expect(selected()).toBe(0);
    for (let i = 1; i <= 4; i++) {
      fireEvent.keyDown(find(), { key: "ArrowDown" });
      expect(selected()).toBe(i % 4);
      expect(document.activeElement).toBe(find());
    }
    expect(find()).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0].id);
  });

  it("numbers follow recency, the current project has none, and waiting does not reshuffle them", async () => {
    openSwitcher();
    const keyOf = (name: string) => optionOf(name).querySelector(".proj-pop-key")?.textContent ?? null;
    expect(keyOf("a")).toBeNull();
    expect([keyOf("b"), keyOf("c"), keyOf("d")]).toEqual(["⌥⌘1", "⌥⌘2", "⌥⌘3"]);
    expect(slotsOf(P, 1)).toEqual(new Map([[2, 0], [3, 1], [4, 2]]));

    fx.attention = new Map([[4, { project_id: 4, waiting: 2, failing: false }]]);
    await act(async () => fx.attentionChanged.forEach((cb) => cb()));
    // 기다리는 d 가 맨 위로 오지만 번호는 그대로 ⌥⌘3 이다.
    await waitFor(() => expect(screen.getAllByRole("option")[0]).toBe(optionOf("d")));
    expect([keyOf("b"), keyOf("c"), keyOf("d")]).toEqual(["⌥⌘1", "⌥⌘2", "⌥⌘3"]);
  });

  it("a11y — no axe violations with the list open", async () => {
    const { container } = openSwitcher();
    await waitFor(() => expect(document.activeElement).toBe(find()));
    const results = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("start window rows", () => {
  it("a11y — no axe violations", async () => {
    const { container } = render(<StartWindow />);
    await screen.findByText("b", { selector: ".prow-name" });
    const results = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
