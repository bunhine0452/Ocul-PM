// 터미널 크롬 정리 (TS-08) — 테두리 단추 하나 · 칸이 목록 노릇 · 넘친 탭은 「+N」 · 크게 보기 중의 탭.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
}));
vi.mock("@/api/oculpm", () => ({ oculpmApi: { listJournalEntries: async () => [] } }));
vi.mock("@/api/projects", () => ({ projectsApi: { onJournalAdded: async () => () => {} } }));
vi.mock("@/api/race", () => ({ raceApi: { lanes: async () => [] } }));

import { t } from "@/i18n";
import { TerminalScreen, __resetTermLayoutForTests } from "@/features/terminal/TerminalScreen";

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
const rect = (left: number, width: number) =>
  ({ x: left, y: 0, left, top: 0, right: left + width, bottom: 26, width, height: 26, toJSON: () => ({}) }) as DOMRect;

beforeEach(() => {
  __resetTermLayoutForTests();
  store.set([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("toolbar", () => {
  it("has one bordered button — 'New session ⌘T ▾' — whose menu holds the four other actions", () => {
    store.set([info(1, "zsh")]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} />);
    const actions = container.querySelector(".toolbar-actions")!;
    expect(actions.querySelectorAll(".btn:not(.ghost), .tm-new")).toHaveLength(1);
    // 출력 찾기 ⌘F 가 이제 화면에 있다(이름 있는 아이콘).
    expect(screen.getByRole("button", { name: t("terminal.find.placeholder") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("terminal.newMenu") }));
    const items = screen.getAllByRole("menuitem").map((m) => m.textContent ?? "");
    expect(items).toHaveLength(4);
    expect(items[0]).toContain(t("terminal.splitRight"));
    expect(items[1]).toContain(t("terminal.splitDown"));
    expect(items[2]).toContain(t("terminal.unsplit"));
    expect(items[3]).toContain(t("race.button"));
    // 칸이 하나면 「나누기 풀기」 는 미리 이유를 단다(누른 뒤 알림이 아니라).
    expect(screen.getAllByRole("menuitem")[2]).toHaveAttribute("title", t("terminal.unsplitNone"));
  });

  it("shows the expand-pane icon only when there are two or more panes", async () => {
    store.set([info(1, "zsh")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    expect(screen.queryByRole("button", { name: t("terminal.zoom") })).toBeNull();
    fireEvent.keyDown(window, { key: "d", code: "KeyD", metaKey: true });
    expect(await screen.findByRole("button", { name: t("terminal.zoom") })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("tabs row", () => {
  it("goes away when every session is in a pane — the pane heads are the list", async () => {
    store.set([info(1, "zsh")]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} />);
    fireEvent.keyDown(window, { key: "d", code: "KeyD", metaKey: true });
    await waitFor(() => expect(container.querySelectorAll(".tm-pane-head")).toHaveLength(2));
    expect(container.querySelector(".tm-tabs")).toBeNull();
  });

  it("seven tabs in 520px: the hidden ones fold into '+N', and a waiting one among them says so in amber", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.classList.contains("tm-tabs-scroll")) return rect(0, 520);
      if (this.classList.contains("tm-tab")) {
        const i = [...(this.parentElement?.children ?? [])].indexOf(this);
        return rect(i * 110, 104);
      }
      return rect(0, 0);
    });
    const waiting = { state: "blocked", kind: "question", msg: "A or B?", since: "" };
    store.set(Array.from({ length: 7 }, (_, i) => info(i + 1, "zsh", i === 5 ? { status: waiting } : {})));
    render(<TerminalScreen projectId={1} workday={null} />);
    const more = screen.getByRole("button", { name: new RegExp(t("terminal.moreAria", { n: 3 })) });
    expect(more.textContent).toContain("+3");
    expect(more.querySelector(".tm-more-wait")?.textContent).toBe(t("terminal.moreWaiting", { n: 1 }));
    fireEvent.click(more);
    expect(screen.getAllByRole("menuitem").map((m) => m.querySelector(".tm-num")?.textContent)).toEqual(["5", "6", "7"]);
  });

  it("while a pane is expanded, the hidden pane's tab is not marked as shown", async () => {
    store.set([info(1, "zsh")]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} />);
    fireEvent.keyDown(window, { key: "d", code: "KeyD", metaKey: true });
    await waitFor(() => expect(container.querySelectorAll(".tm-pane")).toHaveLength(2));
    fireEvent.keyDown(window, { key: "Enter", code: "Enter", metaKey: true, shiftKey: true });
    await waitFor(() => expect(container.querySelectorAll(".tm-pane")).toHaveLength(1));
    expect(container.querySelectorAll(".tm-tab")).toHaveLength(2);
    expect(container.querySelector(".tm-tab.is-shown")).toBeNull();
  });
});
