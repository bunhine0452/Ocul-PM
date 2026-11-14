// 레인 세션의 파일 링크는 그 worktree 기준 · 파일 메뉴와 미리보기 다듬기 (TS-05).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";

import type { TermInfo } from "@/api/terminal";

const store = vi.hoisted(() => {
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
  };
});
const h = vi.hoisted(() => ({
  reveal: vi.fn(() => Promise.resolve(null)),
  preview: vi.fn(),
  lanes: [{ name: "x-1", path: "/data/races/p1/x-1", branch: "ocul-race/x-1", files: 1, added: 2, removed: 0 }],
}));

vi.mock("@/features/terminal/termStore", () => ({
  subscribeTerms: store.subscribe,
  termsSnapshot: () => store.list,
  openTerm: async () => 99,
  mountTerm: () => () => {},
  pasteToTerm: () => {},
  setTermFontSize: () => {},
  focusTerm: () => {},
  hasWorked: () => false,
  closeTerm: () => {},
}));
vi.mock("@/api/fileOpen", () => ({ fileOpenApi: { reveal: h.reveal, quickLook: vi.fn(), inExternalEditor: vi.fn() } }));
vi.mock("@/api/terminal", () => ({ terminalApi: { imagePreview: h.preview, list: async () => [], onSessionsChanged: async () => () => {} } }));
vi.mock("@/api/oculpm", () => ({ oculpmApi: { listJournalEntries: async () => [] } }));
vi.mock("@/api/projects", () => ({ projectsApi: { onJournalAdded: async () => () => {} } }));
vi.mock("@/api/race", () => ({ raceApi: { lanes: async () => h.lanes } }));

import { t } from "@/i18n";
import { __setPlatformForTests } from "@/lib/platform";
import { TerminalScreen, __resetTermLayoutForTests } from "@/features/terminal/TerminalScreen";
import { __resetRaceForTests, __setRaceForTests } from "@/features/terminal/race";
import { closeFileMenu, openFileMenu } from "@/features/terminal/fileRefs";
import { closePeek, peekEvent } from "@/features/terminal/imagePeek";
import { TermImagePeekHost, middleEllipsis } from "@/features/terminal/TermImagePeek";

function info(id: number, label: string): TermInfo {
  return {
    id,
    project_id: 1,
    label,
    started_at: "2026-11-14T10:00:00Z",
    alive: true,
    exit_code: null,
    status: null,
    busy: false,
    unseen: false,
  };
}

/** mountTerm 이 하는 일을 흉내 낸다 — 칸 안에 xterm 의 입력(textarea)을 세우고 거기 포커스. */
function fakeXterm(container: HTMLElement, id: number): HTMLTextAreaElement {
  const host = document.createElement("div");
  host.className = "xterm";
  const input = document.createElement("textarea");
  input.setAttribute("aria-label", "terminal input");
  host.appendChild(input);
  container.querySelector(`.tm-pane[data-term-id="${id}"]`)!.appendChild(host);
  input.focus();
  return input;
}

beforeEach(() => {
  __resetTermLayoutForTests();
  __resetRaceForTests();
  store.set([]);
  h.reveal.mockClear();
});
afterEach(() => {
  act(() => {
    closeFileMenu();
    closePeek();
  });
  cleanup();
});

describe("file links in a lane (side-by-side run) session", () => {
  it("open against the lane's worktree, show the name:line whole, move with ↓ and give focus back on Esc", async () => {
    __setRaceForTests(h.lanes as never, new Map([[h.lanes[0].path, 5]]));
    store.set([info(5, "claude")]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} projectRoot="/repo" />);
    const textarea = fakeXterm(container, 5);
    act(() => openFileMenu({ path: "src/a.ts", line: 12, x: 20, y: 20 }));
    const menu = screen.getByRole("menu", { name: t("terminal.fileMenu.title") });
    expect(menu.querySelector(".tm-file-menu-name")?.textContent).toBe("a.ts:12");
    expect(menu.querySelector(".tm-file-menu-lane")?.textContent).toContain(t("race.lane", { n: 1 }));
    expect(menu.querySelector(".tm-file-menu-head")?.getAttribute("title")).toBe("src/a.ts:12");
    expect((await axe(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => v.id)).toEqual([]);

    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(textarea);

    act(() => openFileMenu({ path: "src/a.ts", line: 12, x: 20, y: 20 }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Finder/ }));
    expect(h.reveal).toHaveBeenCalledWith("/data/races/p1/x-1", "src/a.ts");
    expect(document.activeElement).toBe(textarea);
  });

  it("an absolute path inside the lane is accepted — it used to be 'outside the project'", () => {
    __setRaceForTests(h.lanes as never, new Map([[h.lanes[0].path, 5]]));
    store.set([info(5, "claude")]);
    render(<TerminalScreen projectId={1} workday={null} projectRoot="/repo" />);
    act(() => openFileMenu({ path: "/data/races/p1/x-1/src/b.ts", line: null, x: 0, y: 0 }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Finder/ }));
    expect(h.reveal).toHaveBeenCalledWith("/data/races/p1/x-1", "src/b.ts");
  });
});

describe("image peek", () => {
  it("folds a long name in the middle so the extension stays", () => {
    const name = "screenshot-2026-11-14-at-18.30.12-terminal-split-dark.png";
    const short = middleEllipsis(name);
    expect(short.length).toBe(40);
    expect(short.endsWith("dark.png")).toBe(true);
    expect(middleEllipsis("home.png")).toBe("home.png");
  });

  it("the enlarged view focuses the figure itself, not a button", async () => {
    h.preview.mockResolvedValue({ mime: "image/png", bytes: 2048, base64: "iVBORw0KGgo=" });
    render(<TermImagePeekHost />);
    await act(async () => peekEvent({ kind: "open", path: "/tmp/shots/home.png", x: 0, y: 0 }));
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("off the mac the hint names the platform's file manager and a real modifier", async () => {
    __setPlatformForTests("windows");
    h.preview.mockResolvedValue({ mime: "image/png", bytes: 2048, base64: "iVBORw0KGgo=" });
    vi.useFakeTimers();
    try {
      render(<TermImagePeekHost />);
      act(() => peekEvent({ kind: "hover", path: "C:/shots/home.png", x: 10, y: 10 }));
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      const tip = screen.getByRole("tooltip").textContent ?? "";
      expect(tip).toContain(t("terminal.peek.hint", { mod: "Ctrl" }));
      expect(tip).not.toMatch(/Finder|Ctrl\+ /);
    } finally {
      vi.useRealTimers();
    }
  });
});
