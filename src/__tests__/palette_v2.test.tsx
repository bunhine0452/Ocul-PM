// ⌘K 를 「무엇을」 까지 (11-15) — 세션(기다림 먼저) · 동작 · 초성 · 찾는 중 · 앱 공통 날짜.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";

const fx = vi.hoisted(() => ({
  sessions: [] as unknown[],
  overviewGate: null as null | Promise<void>,
  search: null as null | ((hits: unknown[]) => void),
  searchCalls: 0,
}));

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    overview: async () => {
      if (fx.overviewGate) await fx.overviewGate;
      return fx.sessions;
    },
    onSessionsChanged: async () => () => {},
  },
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    attention: async () => new Map([[2, { project_id: 2, waiting: 1, failing: false }]]),
    openProjectIds: async () => [],
    openProjectWindow: async () => null,
  },
}));
vi.mock("@/api/projects", () => ({ projectsApi: { brief: async () => null } }));
vi.mock("@/api/plan", () => ({ planApi: { list: async () => [] } }));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    searchJournal: () => {
      fx.searchCalls += 1;
      return new Promise((resolve) => {
        fx.search = (hits) => resolve({ hits, total: hits.length });
      });
    },
  },
}));

import { CommandPalette } from "@/components/CommandPalette";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { t } from "@/i18n";
import { onCheatsheetRequest } from "@/lib/projectActions";
import { localWorkdayKey } from "@/lib/workday";
import type { Project, TermInfo } from "@/lib/bindings";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

const PROJECTS: Project[] = [
  { id: 1, name: "ai-pm", root_path: "/Users/me/ai-pm", created_at: 2, icon: null, color: null },
  { id: 2, name: "naeri", root_path: "/Users/me/naeri", created_at: 1, icon: null, color: "teal" },
];

function session(id: number, over: Partial<TermInfo>): TermInfo {
  return {
    id,
    project_id: 1,
    label: "zsh",
    started_at: "2026-11-15T09:00:00Z",
    alive: true,
    exit_code: null,
    status: null,
    busy: true,
    unseen: false,
    ...over,
  };
}

function renderPalette(onOpenChange = vi.fn()) {
  const r = render(
    <WorkspaceProvider projectId={1}>
      <CommandPalette open onOpenChange={onOpenChange} onOpenSettings={() => {}} projects={PROJECTS} onSelectProject={() => {}} />
    </WorkspaceProvider>,
  );
  return { ...r, onOpenChange };
}

const input = () => screen.getByPlaceholderText(t("palette.placeholder"));
const options = () => screen.getAllByRole("option");
const type = (value: string) => fireEvent.change(input(), { target: { value } });

beforeEach(() => {
  fx.search = null;
  fx.searchCalls = 0;
  fx.overviewGate = null;
  fx.sessions = [
    session(1, { label: "zsh", status: { state: "idle", kind: null, msg: null, since: "2026-11-15T09:10:00Z" } }),
    session(2, { label: "claude", status: { state: "blocked", kind: "permission", msg: null, since: "2026-11-15T09:20:00Z" } }),
  ];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("palette — sessions first", () => {
  it("opens with the session group on top, the waiting session first", async () => {
    renderPalette();
    const group = await screen.findByRole("group", { name: t("palette.group.sessions") });
    const first = options()[0];
    expect(group).toContainElement(first);
    expect(first).toHaveTextContent("claude");
    expect(first).toHaveTextContent(t("terminal.state.permission"));
    // ⌘K ↩ 가 ⌘J 와 같은 곳에 간다 — 늦게 온 기다리는 세션이 고른 줄이 된다.
    await waitFor(() => expect(first).toHaveAttribute("aria-selected", "true"));
  });

  it("a waiting session that arrives late does not take the row the user already moved to", async () => {
    let release!: () => void;
    fx.overviewGate = new Promise<void>((resolve) => (release = resolve));
    renderPalette();
    await screen.findByRole("group", { name: t("palette.group.nav") });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    const picked = options().find((o) => o.getAttribute("aria-selected") === "true")!;
    await act(async () => release());
    await screen.findByRole("group", { name: t("palette.group.sessions") });
    expect(picked).toHaveAttribute("aria-selected", "true");
  });

  it("project rows wear the same waiting chip as the ⌘O list", async () => {
    renderPalette();
    const group = await screen.findByRole("group", { name: t("palette.group.projects") });
    const naeri = await within(group).findByText("naeri");
    await waitFor(() => expect(naeri.closest("[cmdk-item]")!.querySelector(".chip.warn")).toHaveTextContent(t("sidebar.waiting", { n: 1 })));
  });
});

describe("palette — initials and verbs", () => {
  it("finds screens by Hangul initials", async () => {
    renderPalette();
    await screen.findByRole("group", { name: t("palette.group.sessions") });
    // i18n-ignore-next-line -- 초성 검색어가 검사 재료다
    type("ㅇㅈ");
    expect(options()[0]).toHaveTextContent(t("nav.journal"));
    // i18n-ignore-next-line -- 초성 검색어가 검사 재료다
    type("ㅌㅁㄴ");
    expect(options()[0]).toHaveTextContent(t("nav.terminal"));
  });

  it("「all shortcuts」 opens the cheatsheet and closes the palette", async () => {
    const opened = vi.fn();
    const off = onCheatsheetRequest(opened);
    const { onOpenChange } = renderPalette();
    fireEvent.click(await screen.findByRole("option", { name: new RegExp(t("palette.cheatsheet")) }));
    off();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("palette — journal search", () => {
  it("says it is searching instead of 「no match」 until the answer is in", async () => {
    const { container } = renderPalette();
    await screen.findByRole("group", { name: t("palette.group.sessions") });
    type("zzqq");
    expect(screen.queryByText(t("palette.empty"))).toBeNull();
    expect(screen.getByText(t("palette.searching"))).toBeInTheDocument();
    const results = await axe(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
    await waitFor(() => expect(fx.search).not.toBeNull());
    await act(async () => fx.search!([]));
    expect(await screen.findByText(t("palette.empty"))).toBeInTheDocument();
    expect(screen.queryByText(t("palette.searching"))).toBeNull();
  });

  const hit = (path: string, workday: string, title: string) => ({
    relative_path: path,
    workday,
    entry_type: "bug",
    status: "done",
    title,
    snippet: "",
    matched_field: "title",
    why: "title",
    score: null,
  });

  it("journal hits that come late land under the rows that already match — the picked row does not move", async () => {
    renderPalette();
    await screen.findByRole("group", { name: t("palette.group.projects") });
    type("naeri");
    await waitFor(() => expect(options()[0]).toHaveTextContent("naeri"));
    const picked = options()[0];
    expect(picked).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(fx.search).not.toBeNull());
    await act(async () => fx.search!([hit("a.md", "20261104", "naeri notes")]));
    await screen.findByRole("group", { name: t("palette.group.journal") });
    expect(options()[0]).toBe(picked);
    expect(picked).toHaveAttribute("aria-selected", "true");
    expect(options()[options().length - 1]).toHaveTextContent("naeri notes");
  });

  it("dates journal hits the app's way — never the raw 20261115", async () => {
    renderPalette();
    await screen.findByRole("group", { name: t("palette.group.sessions") });
    type("cache");
    await waitFor(() => expect(fx.search).not.toBeNull());
    await act(async () => fx.search!([hit("a.md", localWorkdayKey(), "cache fix"), hit("b.md", "20261104", "cache warm")]));
    const group = await screen.findByRole("group", { name: t("palette.group.journal") });
    const rows = within(group).getAllByRole("option");
    expect(rows[0]).toHaveTextContent(t("journal.day.today"));
    for (const row of rows) expect(row.textContent).not.toMatch(/\d{8}/);
  });
});

describe("palette — start window", () => {
  it("promises no screens or journal where there is no project", async () => {
    render(<CommandPalette open onOpenChange={() => {}} onOpenSettings={() => {}} projects={PROJECTS} onSelectProject={() => {}} />);
    expect(await screen.findByPlaceholderText(t("palette.placeholderStart"))).toBeInTheDocument();
    expect(screen.queryByText(t("palette.footHint"))).toBeNull();
  });
});

describe("palette — a11y", () => {
  it("has no axe violations", async () => {
    const { container } = renderPalette();
    await screen.findByRole("group", { name: t("palette.group.projects") });
    const results = await axe(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
