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
  mountTerm: () => () => {},
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

import { t } from "@/i18n";
import { AppDialog } from "@/components/ui/AppDialog";
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
});

describe("session tabs keyboard (roving)", () => {
  it("only the selected tab is in the Tab order; ← → move focus and selection, Delete closes", async () => {
    store.set([info(1, "one"), info(2, "two"), info(3, "three")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.keyDown(tabs[2], { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true"));
    expect(document.activeElement).toBe(screen.getAllByRole("tab")[1]);
    // 키보드로 옮기는 동안은 입력이 터미널로 가지 않는다 — 다음 화살표도 탭 줄이 받는다.
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
