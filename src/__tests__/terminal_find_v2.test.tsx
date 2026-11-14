// 찾기 막대 (TS-03) — 전체 화면 Claude(대체 화면)를 안다 · 칸을 바꾸면 칠을 지운다 · ⌘F 로 돌아온다 · 정규식.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
    alt: new Set<number>(),
    finds: [] as Array<[number, string, boolean, { regex?: boolean; caseSensitive?: boolean }]>,
    decorCleared: [] as number[],
    writes: [] as Array<[number, string]>,
  };
});

vi.mock("@/features/terminal/termStore", () => ({
  subscribeTerms: store.subscribe,
  termsSnapshot: () => store.list,
  openTerm: async () => {
    const id = store.list.length + 1;
    store.set([...store.list, info(id, "zsh")]);
    return id;
  },
  mountTerm: () => () => {},
  pasteToTerm: () => {},
  setTermFontSize: () => {},
  focusTerm: () => {},
  hasWorked: () => false,
  closeTerm: () => {},
  isAltScreen: (id: number) => store.alt.has(id),
  findInTerm: (id: number, q: string, back: boolean, opts: { regex?: boolean } = {}) => {
    store.finds.push([id, q, back, opts]);
    return true;
  },
  onFindResult: () => () => {},
  clearFind: () => {},
  clearFindDecor: (id: number) => void store.decorCleared.push(id),
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    write: async (id: number, data: string) => void store.writes.push([id, data]),
    list: async () => store.list,
    onSessionsChanged: async () => () => {},
  },
}));
vi.mock("@/api/oculpm", () => ({ oculpmApi: { listJournalEntries: async () => [] } }));
vi.mock("@/api/projects", () => ({ projectsApi: { onJournalAdded: async () => () => {} } }));
vi.mock("@/api/race", () => ({ raceApi: { lanes: async () => [] } }));

import { t } from "@/i18n";
import { TerminalScreen, __resetTermLayoutForTests } from "@/features/terminal/TerminalScreen";
import { TermFindBar } from "@/features/terminal/TermFindBar";

function info(id: number, label: string, extra: Partial<TermInfo> = {}): TermInfo {
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
    ...extra,
  };
}
const cmdF = () => fireEvent.keyDown(window, { key: "f", code: "KeyF", metaKey: true });

beforeEach(() => {
  __resetTermLayoutForTests();
  store.set([]);
  store.alt.clear();
  store.finds.length = 0;
  store.decorCleared.length = 0;
  store.writes.length = 0;
});
afterEach(() => cleanup());

describe("find in a full-screen program", () => {
  it("on the alternate screen it says only the visible screen is searched and how to page Claude's conversation — typing nothing", async () => {
    store.alt.add(1);
    render(<TermFindBar id={1} seq={1} claude onClose={() => {}} />);
    expect(screen.getByText(t("terminal.find.altClaude"))).toBeInTheDocument();
    expect(t("terminal.find.altClaude")).toContain("Ctrl+O");
    // 앱이 대신 치는 키는 없다 — 앱이 터미널에 치는 줄은 CLAUDE.md 의 목록뿐이다. 단추는 찾기 막대의 다섯(Aa · .* · ↑ · ↓ · ×)뿐.
    expect(screen.getAllByRole("button")).toHaveLength(5);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "error" } });
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    });
    expect(store.writes).toEqual([]);
  });

  it("a full-screen program that is not claude gets its own note", () => {
    store.alt.add(1);
    render(<TermFindBar id={1} seq={1} claude={false} onClose={() => {}} />);
    expect(screen.getByText(t("terminal.find.altOther"))).toBeInTheDocument();
    expect(screen.queryByText(t("terminal.find.altClaude"))).toBeNull();
  });
});

describe("find bar", () => {
  it("regex on + 'error|fail' searches with regex: true; a broken pattern is said, not searched", () => {
    render(<TermFindBar id={1} seq={1} claude={false} onClose={() => {}} />);
    const toggle = screen.getByRole("button", { name: t("terminal.find.regex") });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "error|fail" } });
    expect(store.finds[store.finds.length - 1]).toEqual([1, "error|fail", false, expect.objectContaining({ regex: true })]);
    const before = store.finds.length;
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "error(" } });
    expect(store.finds).toHaveLength(before);
    expect(screen.getByText(t("terminal.find.badRegex"))).toBeInTheDocument();
  });

  it("picking another pane clears the old pane's highlights", async () => {
    store.set([info(1, "zsh")]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} />);
    fireEvent.keyDown(window, { key: "d", code: "KeyD", metaKey: true });
    await waitFor(() => expect(container.querySelectorAll(".tm-pane")).toHaveLength(2));
    cmdF();
    await screen.findByRole("search");
    fireEvent.mouseDown(container.querySelector('.tm-pane[data-term-id="1"]')!);
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
    // 막대는 연 세션 위에만 — 새 칸 위로 잠깐 서며 새 칸의 칠 · 선택까지 지우지 않는다.
    expect(store.decorCleared).toEqual([2]);
  });

  it("⌘F while the bar is open brings focus back to the find input", async () => {
    store.set([info(1, "zsh")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    cmdF();
    const input = await screen.findByRole("textbox", { name: t("terminal.find.placeholder") });
    expect(document.activeElement).toBe(input);
    screen.getByRole("button", { name: t("terminal.find.regex") }).focus();
    expect(document.activeElement).not.toBe(input);
    cmdF();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});

describe("find decorations", () => {
  it("come from the tokens as #RRGGBB: a neutral match face with an amber 1px border, the current one in the accent", async () => {
    const root = document.documentElement;
    root.style.setProperty("--term-bg", "#ffffff");
    root.style.setProperty("--text", "#000000");
    root.style.setProperty("--warn", "#c2810a");
    root.style.setProperty("--accent", "#0e8a60");
    const { findDecor } = await vi.importActual<typeof import("@/features/terminal/termStore")>("@/features/terminal/termStore");
    const decor = findDecor(root);
    expect(decor.matchBorder).toBe("#c2810a");
    expect(decor.activeMatchBorder).toBe("#0e8a60");
    // 바탕에 글자색 20% — 색칠된 낱말 위에서도 글자가 읽히는 중립 면.
    expect(decor.matchBackground).toBe("#cccccc");
    for (const v of Object.values(decor)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    for (const k of ["--term-bg", "--text", "--warn", "--accent"]) root.style.removeProperty(k);
  });
});
