// 터미널 키보드 (TS-04) — 대화상자 위에서는 물러난다 · 탭 목록 roving · Delete 닫기 · 경계 키의 px 하한.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    opened: 0,
    fonts: [] as number[],
    closed: [] as number[],
    focused: [] as number[],
  };
});

vi.mock("@/features/terminal/termStore", () => ({
  subscribeTerms: store.subscribe,
  termsSnapshot: () => store.list,
  openTerm: async () => {
    store.opened += 1;
    const id = 10 + store.opened;
    store.set([...store.list, info(id, "zsh")]);
    return id;
  },
  // 실제처럼 — 칸에 입력을 세우고, `focus` 가 참이면 거기 포커스(termStore.mountTerm). 탭을 옮겨 칸의 세션을
  // 갈아 끼울 때 이 포커스가 탭에서 터미널로 새던 길을 문다.
  mountTerm: (id: number, el: HTMLElement, focus = true) => {
    const input = document.createElement("textarea");
    input.setAttribute("aria-label", `xterm ${id}`);
    el.appendChild(input);
    if (focus) input.focus();
    return () => input.remove();
  },
  pasteToTerm: () => {},
  setTermFontSize: (px: number) => void store.fonts.push(px),
  focusTerm: (id: number) => void store.focused.push(id),
  hasWorked: () => false,
  isAltScreen: () => false,
  findInTerm: () => true,
  onFindResult: () => () => {},
  clearFind: () => {},
  clearFindDecor: () => {},
  closeTerm: (id: number) => {
    store.closed.push(id);
    store.set(store.list.filter((s) => s.id !== id));
  },
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: { list: async () => store.list, onSessionsChanged: async () => () => {} },
}));
vi.mock("@/api/oculpm", () => ({ oculpmApi: { listJournalEntries: async () => [] } }));
vi.mock("@/api/projects", () => ({ projectsApi: { onJournalAdded: async () => () => {} } }));
vi.mock("@/api/race", () => ({ raceApi: { lanes: async () => [] } }));
const win = vi.hoisted(() => ({ closed: 0 }));
vi.mock("@/api/window", () => ({
  windowApi: { closeThisWindow: async () => void (win.closed += 1), newWindow: async () => {} },
}));

import { t } from "@/i18n";
import { AppDialog } from "@/components/ui/AppDialog";
import { closeByKey } from "@/hooks/useWindowKeys";
import { TerminalScreen, __resetTermLayoutForTests } from "@/features/terminal/TerminalScreen";

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
const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };

beforeEach(() => {
  __resetTermLayoutForTests();
  store.set([]);
  store.opened = 0;
  store.fonts.length = 0;
  store.closed.length = 0;
  store.focused.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("terminal shortcuts step back for dialogs", () => {
  it("with a dialog open, ⌘F · ⌘T · ⌘= do nothing behind it", async () => {
    store.set([info(1, "zsh")]);
    render(
      <>
        <TerminalScreen projectId={1} workday={null} />
        <AppDialog open onClose={() => {}} label="dialog">
          <button type="button">ok</button>
        </AppDialog>
      </>,
    );
    await waitFor(() => expect(store.fonts).toEqual([13]));
    fireEvent.keyDown(window, { key: "f", code: "KeyF", metaKey: true });
    fireEvent.keyDown(window, { key: "t", code: "KeyT", metaKey: true });
    fireEvent.keyDown(window, { key: "=", code: "Equal", metaKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("search")).toBeNull();
    expect(store.opened).toBe(0);
    expect(store.fonts).toEqual([13]);
  });

  it("⌘W with a dialog open closes neither the selected session behind it nor the window", async () => {
    win.closed = 0;
    store.set([info(1, "zsh"), info(2, "zsh")]);
    render(
      <>
        <TerminalScreen projectId={1} workday={null} />
        <AppDialog open onClose={() => {}} label="dialog">
          <button type="button">ok</button>
        </AppDialog>
      </>,
    );
    closeByKey();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.closed).toEqual([]);
    expect(win.closed).toBe(0);
  });

  it("with the ▾ menu open, ⌘T stays with the menu instead of opening a session behind it", async () => {
    store.set([info(1, "zsh")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    fireEvent.click(screen.getByRole("button", { name: t("terminal.newMenu") }));
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[0]);
    fireEvent.keyDown(window, { key: "t", code: "KeyT", metaKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(store.opened).toBe(0);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});

describe("session tabs keyboard (roving)", () => {
  it("only the selected tab is in the Tab order; ← → move focus and selection, Delete closes", async () => {
    store.set([info(1, "one"), info(2, "two"), info(3, "three")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
    tabs[2].focus();
    fireEvent.keyDown(tabs[2], { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true"));
    // 칸이 하나라 고른 칸의 세션이 갈아 끼워져도(그 칸이 화면을 다시 붙여도) 포커스는 탭에 남는다 — 다음 화살표 ·
    // Enter 가 셸이나 허락을 기다리는 Claude 로 가지 않는다.
    expect(document.activeElement).toBe(screen.getAllByRole("tab")[1]);
    expect(store.focused).not.toContain(2);
    fireEvent.keyDown(screen.getAllByRole("tab")[1], { key: "ArrowRight" });
    await waitFor(() => expect(screen.getAllByRole("tab")[2]).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(screen.getAllByRole("tab")[2], { key: "Home" });
    await waitFor(() => expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "Delete" });
    await waitFor(() => expect(store.closed).toEqual([1]));
  });

  it("has no axe violations (tabs hold only tabs; the close × is a mouse target)", async () => {
    store.set([info(1, "one"), info(2, "two"), info(3, "three")]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} />);
    fireEvent.keyDown(window, { key: "d", code: "KeyD", metaKey: true });
    await screen.findByRole("separator");
    const result = await axe(container, AXE);
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("pane divider keys", () => {
  it("arrow keys obey the same px floor as dragging: 30 × ArrowLeft on a 600px row leaves ≥ 160px", async () => {
    store.set([info(1, "zsh")]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} />);
    fireEvent.keyDown(window, { key: "d", code: "KeyD", metaKey: true });
    const sep = await screen.findByRole("separator");
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}),
    } as DOMRect);
    for (let i = 0; i < 30; i++) fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    const ratio = Number(container.querySelector<HTMLElement>(".tm-node-part")!.style.flex.split(" ")[0]);
    expect(ratio * 600).toBeGreaterThanOrEqual(160);
    // Home 은 끝까지(하한까지), Enter 는 고르게.
    fireEvent.keyDown(screen.getByRole("separator"), { key: "End" });
    expect(Number(screen.getByRole("separator").getAttribute("aria-valuenow"))).toBe(73);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "Enter" });
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "50");
    expect(sep).toHaveAccessibleName(t("terminal.divider"));
    expect(sep).toHaveAccessibleDescription(t("terminal.dividerHelp"));
  });
});
