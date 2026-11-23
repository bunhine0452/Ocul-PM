/**
 * ⌘K 를 키보드 사용자가 쓰게 (love-round P1, 11-23).
 *
 *  - ? (입력 칸 · 터미널 밖) 는 같은 단축키 판을 **지금 화면 묶음 하나만** 작은 시트로 연다 — 표는 `shortcutRegistry`
 *    그대로(새 표 없음). 다시 누르면 닫히고, 바닥 단추 · ⌘/ 로 전체 표로 넓어진다. 입력 칸 · 터미널의 ? 는 글자다.
 *  - 팔레트 「지금 화면」 묶음은 화면이 이미 그려 둔 단추(윗줄 화면 동작 · `data-palette-action`)에서 온다. 막힌 것 ·
 *    메뉴를 여는 것 · 고른 라디오는 빠지고, 고르면 팔레트가 닫힌 뒤 그 단추를 누른다.
 *  - 다른 창의 세션을 고르면 창만이 아니라 그 세션까지(`term_focus_session`). 세션이 그 사이 끝났으면 창만 연다.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  sessions: [] as unknown[],
  focusOk: true,
  focus: vi.fn(async (_id: number) => true),
  openWindow: vi.fn(async (_id: number) => null),
}));

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    overview: async () => fx.sessions,
    onSessionsChanged: async () => () => {},
    focusSession: fx.focus,
  },
}));
vi.mock("@/api/window", () => ({
  windowApi: { attention: async () => new Map(), openProjectIds: async () => [], openProjectWindow: fx.openWindow },
}));
vi.mock("@/api/projects", () => ({ projectsApi: { brief: async () => null } }));
vi.mock("@/api/plan", () => ({ planApi: { list: async () => [] } }));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: { searchJournal: async () => ({ hits: [], total: 0 }) },
}));

import { CommandPalette } from "@/components/CommandPalette";
import { ShortcutCheatsheet, screenKeyGroups, splitKeyLabel } from "@/components/ShortcutCheatsheet";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { __resetSessionNumbersForTests } from "@/features/terminal/status";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { t } from "@/i18n";
import { isScreenKeysKey } from "@/lib/kbd";
import type { Project, TermInfo } from "@/lib/bindings";
import { NAV_ENTRIES } from "@/lib/navRegistry";
import { __setPlatformForTests } from "@/lib/platform";
import { collectScreenActions } from "@/lib/screenActions";
import { buildShortcutGroups } from "@/lib/shortcutRegistry";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  __setPlatformForTests("mac");
  __resetSessionNumbersForTests();
  fx.sessions = [];
  fx.focus.mockReset();
  fx.focus.mockImplementation(async () => fx.focusOk);
  fx.focusOk = true;
  fx.openWindow.mockClear();
});

afterEach(() => {
  cleanup();
  for (const el of document.querySelectorAll("body > .topbar, body > [data-fixture]")) el.remove();
});

/** 프로젝트 창의 윗줄 흉내 — 탭은 navRegistry 순서, `view` 의 탭에 aria-current. `actions` 는 화면 동작 자리. */
function fakeTopbar(view: string, actions: HTMLElement[] = []) {
  const bar = document.createElement("header");
  bar.className = "topbar";
  const nav = document.createElement("nav");
  nav.className = "topnav";
  for (const e of NAV_ENTRIES) {
    const b = document.createElement("button");
    if (e.id === view) b.setAttribute("aria-current", "page");
    nav.appendChild(b);
  }
  bar.appendChild(nav);
  const slot = document.createElement("div");
  slot.className = "topbar-actions";
  for (const a of actions) slot.appendChild(a);
  bar.appendChild(slot);
  document.body.appendChild(bar);
  return bar;
}

function button(html: string, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.innerHTML = html;
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  return b;
}

function Keys() {
  useGlobalShortcuts({ onOpenPalette: () => {}, uiV2Nav: () => {} });
  return <ShortcutCheatsheet />;
}

const smallSheet = () => screen.queryByRole("dialog", { name: t("keys.screenKeys") });
const fullSheet = () => screen.queryByRole("dialog", { name: t("keys.title") });
const press = (target: Element | Document | Window, key = "?") => fireEvent.keyDown(target, { key, code: "Slash", shiftKey: true });

describe("? — this screen's keys in a small sheet", () => {
  it("opens only the current screen's group from the same registry, closes on a second ?", async () => {
    fakeTopbar("planner");
    render(<Keys />);
    act(() => {
      press(document.body);
    });
    const sheet = await screen.findByRole("dialog", { name: t("keys.screenKeys") });
    const heads = within(sheet).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual([t("nav.planner")]);
    // 행은 레지스트리의 계획 묶음 그대로 — 손으로 만든 표가 아니다.
    const plan = buildShortcutGroups().find((g) => g.id === "planner")!;
    expect(within(sheet).getAllByRole("term").map((d) => d.childNodes[0].textContent)).toEqual(plan.rows.map((r) => splitKeyLabel(t(r.labelKey))[0]));
    expect(within(sheet).queryByText(t("keys.palette"))).toBeNull();
    act(() => {
      press(document.activeElement ?? document.body);
    });
    await waitFor(() => expect(smallSheet()).toBeNull());
  });

  it("widens to the full table from its foot button and from ⌘/", async () => {
    fakeTopbar("diff");
    render(<Keys />);
    act(() => {
      press(document.body);
    });
    const sheet = await screen.findByRole("dialog", { name: t("keys.screenKeys") });
    fireEvent.click(within(sheet).getByRole("button", { name: t("palette.cheatsheet") }));
    await waitFor(() => expect(fullSheet()).not.toBeNull());
    expect(within(fullSheet()!).getByText(t("keys.palette"))).toBeInTheDocument();
    // 전체 표 위의 ? 는 작은 시트로 좁힌다(닫지 않는다 — 범위가 다르다).
    act(() => {
      press(document.activeElement ?? document.body);
    });
    await waitFor(() => expect(smallSheet()).not.toBeNull());
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "/", code: "Slash", metaKey: true });
    });
    await waitFor(() => expect(fullSheet()).not.toBeNull());
  });

  it("is a character inside a text field and in the terminal", () => {
    fakeTopbar("journal");
    render(<Keys />);
    const input = document.createElement("input");
    const term = document.createElement("div");
    term.className = "xterm";
    const ta = document.createElement("textarea");
    term.appendChild(ta);
    const host = document.createElement("div");
    host.setAttribute("data-fixture", "");
    host.append(input, term);
    document.body.appendChild(host);
    act(() => {
      press(input);
      press(ta);
    });
    expect(smallSheet()).toBeNull();
    expect(isScreenKeysKey({ key: "?", metaKey: true, ctrlKey: false, altKey: false, target: document.body })).toBe(false);
    expect(isScreenKeysKey({ key: "?", metaKey: false, ctrlKey: false, altKey: false, target: document.body })).toBe(true);
  });

  it("falls back to the nav and global groups on a screen without keys of its own (settings)", () => {
    const groups = screenKeyGroups(buildShortcutGroups(), "settings");
    expect(groups.map((g) => g.id)).toEqual(["nav", "global"]);
    expect(groups[1].rows.some((r) => r.keys === "?" && r.labelKey === "keys.screenKeys")).toBe(true);
  });
});

describe("screen actions — read from the buttons the screen already drew", () => {
  it("takes top-bar actions and marked body buttons, skips blocked · menus · the checked radio", () => {
    const run = button('New session<kbd class="kbd">⌘T</kbd>');
    const menu = button("▾", { "aria-haspopup": "menu", "aria-label": "New session menu" });
    const blocked = button("Find", { "aria-disabled": "true" });
    const seg = document.createElement("div");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", "Baseline");
    seg.append(
      button("Working", { role: "radio", "aria-checked": "true" }),
      button("Last commit", { role: "radio", "aria-checked": "false" }),
    );
    fakeTopbar("diff", [run, menu, blocked, seg]);
    const body = document.createElement("div");
    body.setAttribute("data-fixture", "");
    const check = button("Run in shell", { "data-palette-action": "" });
    const off = button("Next", { "data-palette-action": "" });
    off.disabled = true;
    const rowBtn = button("Reviewed");
    body.append(check, off, rowBtn);
    document.body.appendChild(body);

    const got = collectScreenActions();
    expect(got.map((a) => [a.label, a.shortcut])).toEqual([
      ["New session", "⌘T"],
      ["Baseline · Last commit", undefined],
      ["Run in shell", undefined],
    ]);
  });

  it("the palette lists them under 「This screen」 and presses the button after it closes", async () => {
    const send = vi.fn();
    const sendBtn = button("Send notes 2");
    sendBtn.addEventListener("click", send);
    fakeTopbar("planner", [sendBtn]);
    const body = document.createElement("div");
    body.setAttribute("data-fixture", "");
    const check = vi.fn();
    const checkBtn = button("Run in shell", { "data-palette-action": "" });
    checkBtn.addEventListener("click", check);
    body.appendChild(checkBtn);
    document.body.appendChild(body);

    const onOpenChange = vi.fn();
    render(
      <WorkspaceProvider projectId={1}>
        <CommandPalette open onOpenChange={onOpenChange} onOpenSettings={() => {}} />
      </WorkspaceProvider>,
    );
    const group = await screen.findByRole("group", { name: t("palette.group.screen") });
    expect(within(group).getAllByRole("option").map((o) => o.textContent)).toEqual(["Send notes 2", "Run in shell"]);
    fireEvent.click(within(group).getByRole("option", { name: "Run in shell" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // 바로 누르지 않는다 — 팔레트가 닫히고 포커스를 돌려준 뒤에.
    expect(check).not.toHaveBeenCalled();
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(send).not.toHaveBeenCalled();
  });

  it("offers 「Keys for this screen」 with ? as its key", async () => {
    render(
      <WorkspaceProvider projectId={1}>
        <CommandPalette open onOpenChange={() => {}} onOpenSettings={() => {}} />
      </WorkspaceProvider>,
    );
    const row = await screen.findByRole("option", { name: new RegExp(t("keys.screenKeys")) });
    expect(row.querySelector("kbd")?.textContent).toBe("?");
  });
});

describe("another window's session — the window and the session", () => {
  const PROJECTS: Project[] = [
    { id: 1, name: "ai-pm", root_path: "/Users/me/ai-pm", created_at: 2, icon: null, color: null },
    { id: 2, name: "naeri", root_path: "/Users/me/naeri", created_at: 1, icon: null, color: null },
  ];
  const other: TermInfo = {
    id: 42,
    project_id: 2,
    label: "claude",
    started_at: "2026-11-23T09:00:00Z",
    alive: true,
    exit_code: null,
    status: { state: "working", kind: null, msg: null, since: "2026-11-23T09:00:00Z" } as TermInfo["status"],
    busy: true,
    unseen: false,
  };

  function renderPalette() {
    render(
      <WorkspaceProvider projectId={1}>
        <CommandPalette open onOpenChange={() => {}} onOpenSettings={() => {}} projects={PROJECTS} onSelectProject={() => {}} />
      </WorkspaceProvider>,
    );
  }

  it("asks the backend to focus that session in its window — no bare window open", async () => {
    fx.sessions = [other];
    renderPalette();
    const group = await screen.findByRole("group", { name: t("palette.group.sessions") });
    fireEvent.click(within(group).getAllByRole("option")[0]);
    await waitFor(() => expect(fx.focus).toHaveBeenCalledWith(42));
    // 사슬(focus → catch → then)이 다 돈 뒤에 본다 — 마이크로태스크 하나만 기다리면 창을 여는 결함도 통과했다.
    await new Promise((r) => setTimeout(r, 0));
    expect(fx.openWindow).not.toHaveBeenCalled();
  });

  it("opens just the window when the session ended meanwhile", async () => {
    fx.focusOk = false;
    fx.sessions = [other];
    renderPalette();
    const group = await screen.findByRole("group", { name: t("palette.group.sessions") });
    fireEvent.click(within(group).getAllByRole("option")[0]);
    await waitFor(() => expect(fx.openWindow).toHaveBeenCalledWith(2));
  });
});
