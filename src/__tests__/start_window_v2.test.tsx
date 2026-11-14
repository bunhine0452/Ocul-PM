// 시작 창 막다른 길 없애기 (11-15) — ⌘K · ⌘, 가 서고, 모름과 없음을 가르고, 첫 줄에 포커스, 치면 거른다.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { Project } from "@/lib/bindings";

const fx = vi.hoisted(() => ({
  projects: [] as Project[],
  listFails: 0,
  briefGate: null as null | Promise<void>,
}));

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/api/projects", () => ({
  projectsApi: {
    list: async () => {
      if (fx.listFails > 0) {
        fx.listFails -= 1;
        throw new Error("db locked");
      }
      return fx.projects;
    },
    brief: async () => {
      if (fx.briefGate) await fx.briefGate;
      return { projects: [], today_workday: "", since_workday: "", today_total: 0, active_projects: 0, feed: [] };
    },
  },
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    adoptProject: async () => true,
    openProjectIds: async () => [],
    onOpenProjectsChanged: async () => () => {},
    attention: async () => new Map(),
    onAttentionChanged: async () => () => {},
    openProjectWindow: async () => null,
  },
}));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: { compareWorkday: async () => ({ workday: "", sessions: [], unrecorded_total: 0 }) },
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: { overview: async () => [], onSessionsChanged: async () => () => {} },
}));
// 설정 칸 셋은 각자의 시험이 문다 — 여기서는 시작 창이 그 쪽을 여는지만 본다.
vi.mock("@/features/start/StartSettings", async () => {
  const { t } = await import("@/i18n");
  return { default: () => <h1>{t("shell.settings.title")}</h1> };
});

import { StartWindow } from "@/features/start/StartWindow";
import { t } from "@/i18n";
import { buildShortcutGroups } from "@/lib/shortcutRegistry";

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

const rowNames = () => [...document.querySelectorAll(".start-row .prow-name")].map((n) => n.textContent);

beforeEach(() => {
  fx.projects = [project(1, "ocul-pm", "/Users/me/dev/ocul-pm", 2), project(2, "naeri", "/Users/me/dev/naeri", 1)];
  fx.listFails = 0;
  fx.briefGate = null;
});
afterEach(() => cleanup());

describe("start window — no dead ends", () => {
  it("⌘K opens the palette and ⌘, opens settings, both before any project is open", async () => {
    render(<StartWindow />);
    await screen.findByText("ocul-pm", { selector: ".prow-name" });
    await act(async () => void fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true }));
    expect(await screen.findByRole("dialog", { name: t("palette.aria") })).toBeInTheDocument();
    await act(async () => void fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true }));
    expect(screen.queryByRole("dialog", { name: t("palette.aria") })).toBeNull();

    await act(async () => void fireEvent.keyDown(window, { key: ",", code: "Comma", metaKey: true }));
    expect(await screen.findByRole("heading", { name: t("shell.settings.title") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("sidebar.settings") })).toHaveAttribute("aria-pressed", "true");
  });

  it("the cheatsheet lists ↑↓ and Enter for the start window", () => {
    const start = buildShortcutGroups().find((g) => g.id === "start")!;
    expect(start.rows.map((r) => r.keys)).toEqual(expect.arrayContaining(["↑ / ↓", "Enter"]));
  });
});

describe("start window — unknown is not none", () => {
  it("says nothing like 「no records」 before the brief answers — a still skeleton holds the place", async () => {
    let open!: () => void;
    fx.briefGate = new Promise<void>((resolve) => (open = resolve));
    render(<StartWindow />);
    await act(async () => {});
    expect(screen.queryByText(t("start.noRecords"))).toBeNull();
    expect(document.querySelector(".start-skel")).not.toBeNull();
    await act(async () => open());
    expect(await screen.findAllByText(t("start.noRecords"))).toHaveLength(2);
    expect(document.querySelector(".start-skel")).toBeNull();
  });

  it("a failed project list offers 「retry」 instead of an empty window forever", async () => {
    fx.listFails = 1;
    render(<StartWindow />);
    fireEvent.click(await screen.findByRole("button", { name: t("common.retry") }));
    expect(await screen.findByText("ocul-pm", { selector: ".prow-name" })).toBeInTheDocument();
  });
});

describe("start window — keyboard", () => {
  it("puts focus on the first row as soon as the list is in", async () => {
    render(<StartWindow />);
    const name = await screen.findByText("ocul-pm", { selector: ".prow-name" });
    await waitFor(() => expect(document.activeElement).toBe(name.closest("button")));
  });

  it("typing on the list filters by name and path", async () => {
    render(<StartWindow />);
    await screen.findByText("ocul-pm", { selector: ".prow-name" });
    await waitFor(() => expect(document.activeElement?.classList.contains("start-row-open")).toBe(true));
    // 줄에서 친 첫 글자가 거르기 칸으로 옮겨 가고, 나머지는 그 칸에 쳐진다.
    fireEvent.keyDown(document.activeElement!, { key: "o", code: "KeyO" });
    const find = screen.getByRole("textbox", { name: t("sidebar.findProject") });
    expect(find).toHaveValue("o");
    expect(document.activeElement).toBe(find);
    fireEvent.change(find, { target: { value: "ocu" } });
    expect(rowNames()).toEqual(["ocul-pm"]);
    fireEvent.change(find, { target: { value: "dev/na" } });
    expect(rowNames()).toEqual(["naeri"]);
  });

  it("↓ and j move between rows", async () => {
    render(<StartWindow />);
    await screen.findByText("naeri", { selector: ".prow-name" });
    await waitFor(() => expect(document.activeElement?.classList.contains("start-row-open")).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown", code: "ArrowDown" });
    expect(document.activeElement?.querySelector(".prow-name")?.textContent).toBe("naeri");
    fireEvent.keyDown(document.activeElement!, { key: "k", code: "KeyK" });
    expect(document.activeElement?.querySelector(".prow-name")?.textContent).toBe("ocul-pm");
  });
});
