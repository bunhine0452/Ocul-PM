// 탭을 마우스로 (TS-01 · TS-02) — ×는 그 세션을 닫고, 「일지 없음」 은 다른 앰버 낱말처럼 낱말일 뿐이다(누르면 그
// 탭을 고를 뿐, 기록 부탁은 칸 위 띠의 단추가 한다 — 같은 모양 같은 뜻, 영수증 규칙 4).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

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
    worked: new Set<number>(),
    closed: [] as number[],
    sent: [] as number[],
  };
});

vi.mock("@/features/terminal/termStore", () => ({
  subscribeTerms: store.subscribe,
  termsSnapshot: () => store.list,
  openTerm: async () => 99,
  mountTerm: () => () => {},
  pasteToTerm: () => {},
  setTermFontSize: () => {},
  focusTerm: () => {},
  hasWorked: (id: number) => store.worked.has(id),
  closeTerm: (id: number) => {
    store.closed.push(id);
    store.set(store.list.filter((s) => s.id !== id));
  },
}));
vi.mock("@/features/terminal/sendToClaude", () => ({
  sendOrQueue: async (id: number) => {
    store.sent.push(id);
    return { outcome: "sent" };
  },
  toastQueued: () => {},
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: { list: async () => store.list, onSessionsChanged: async () => () => {} },
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
const tabOf = (id: number) => document.querySelector<HTMLElement>(`.tm-tab[data-tab-id="${id}"]`)!;
const idle = { state: "idle", kind: null, msg: null, since: "2026-11-14T10:05:00Z" };

beforeEach(() => {
  __resetTermLayoutForTests();
  store.set([]);
  store.worked.clear();
  store.closed.length = 0;
  store.sent.length = 0;
});
afterEach(() => cleanup());

describe("tabs by mouse", () => {
  it("the × on a tab closes that session (an idle shell closes without asking)", async () => {
    store.set([info(1, "zsh"), info(2, "zsh")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    const close = tabOf(1).querySelector<HTMLElement>(".tm-close")!;
    expect(close).toHaveAttribute("title", t("terminal.closeAria", { name: "1 zsh" }));
    fireEvent.click(close);
    await waitFor(() => expect(store.closed).toEqual([1]));
  });

  it("clicking a tab's 'no journal' only selects that tab — it asks Claude for nothing", async () => {
    store.worked.add(1);
    store.set([info(1, "claude", { status: idle }), info(2, "zsh")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    const word = tabOf(1).querySelector<HTMLElement>(".tm-norec")!;
    expect(word.textContent).toBe(t("terminal.noRecord"));
    fireEvent.click(word);
    await waitFor(() => expect(tabOf(1).querySelector('[role="tab"]')).toHaveAttribute("aria-selected", "true"));
    await new Promise((r) => setTimeout(r, 20));
    expect(store.sent).toEqual([]);
  });
});
