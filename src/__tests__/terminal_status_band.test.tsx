// 세션 상태 띠 (TS-02) — 하나여도 「일지 없음」 · 띠는 칸 위에 겹친다 · 끝난 세션 다시 열기 · 빈/여는 중/실패.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    opened: [] as Array<[number, string | null, string | null, boolean]>,
    closed: [] as number[],
    fail: 0,
    sent: [] as Array<[number, string]>,
    digest: null as unknown,
    digestCalls: 0,
  };
});

vi.mock("@/features/terminal/termStore", () => ({
  subscribeTerms: store.subscribe,
  termsSnapshot: () => store.list,
  openTerm: async (projectId: number, prompt: string | null = null, cwd: string | null = null, resume = false) => {
    store.opened.push([projectId, prompt, cwd, resume]);
    if (store.fail > 0) {
      store.fail -= 1;
      throw { code: "spawn_failed", detail: "no shell" };
    }
    const id = 100 + store.opened.length;
    store.set([...store.list, info(id, resume ? "claude" : "zsh")]);
    return id;
  },
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
  sendOrQueue: async (id: number, message: string) => {
    store.sent.push([id, message]);
    return { outcome: "sent" };
  },
  toastQueued: () => {},
}));
vi.mock("@/api/plan", () => ({
  planApi: {
    todayDigest: async () => {
      store.digestCalls += 1;
      return store.digest;
    },
    dispatchPrompt: async () => ({ prompt: "next item prompt" }),
  },
}));
vi.mock("@/api/oculpm", () => ({ oculpmApi: { listJournalEntries: async () => [] } }));
vi.mock("@/api/projects", () => ({ projectsApi: { onJournalAdded: async () => () => {} } }));
const lanes = vi.hoisted(() => [{ name: "x-1", path: "/data/races/p1/x-1", branch: "ocul-race/x-1", files: 0, added: 0, removed: 0 }]);
vi.mock("@/api/race", () => ({ raceApi: { lanes: async () => lanes } }));

import { t } from "@/i18n";
import { TerminalScreen, __resetTermLayoutForTests } from "@/features/terminal/TerminalScreen";
import { __resetRaceForTests, __setRaceForTests, laneNumberOf } from "@/features/terminal/race";

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
const idle = { state: "idle", kind: null, msg: null, since: "2026-11-14T10:05:00Z" };
const paneIds = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".tm-pane")].map((p) => p.dataset.termId);

beforeEach(() => {
  __resetTermLayoutForTests();
  __resetRaceForTests();
  store.set([]);
  store.worked.clear();
  store.opened.length = 0;
  store.closed.length = 0;
  store.sent.length = 0;
  store.fail = 0;
  store.digest = { plans: [], needs_user: [], blocked: [], journal_plan: [] };
  store.digestCalls = 0;
});
afterEach(() => cleanup());

describe("status band", () => {
  it("a single session that worked and went idle with no journal gets a band with 'no journal' and a button", async () => {
    store.worked.add(7);
    store.set([info(7, "claude", { status: idle })]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} />);
    const band = screen.getByRole("status");
    expect(within(band).getByText(t("terminal.noRecord"))).toBeInTheDocument();
    // 줄로 끼우지 않고 칸 안에 겹친다 — 격자 크기가 그대로다.
    expect(band.closest(".tm-pane")).toBe(container.querySelector('.tm-pane[data-term-id="7"]'));
    fireEvent.click(within(band).getByRole("button", { name: t("terminal.askRecord") }));
    await waitFor(() => expect(store.sent).toEqual([[7, t("terminal.askRecordPrompt")]]));
  });

  it("the overlay sits absolutely at the top of the pane (the grid never resizes for it)", () => {
    const css = readFileSync(join(__dirname, "..", "features", "terminal", "terminal.css"), "utf8");
    const over = /\.tm-over \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(over).toMatch(/position: absolute; top: 0; left: 0; right: 0/);
  });

  it("an ended session (code 1) reopens in the same folder — claude resumes — and the new session takes its pane", async () => {
    __setRaceForTests(lanes as never, new Map([[lanes[0].path, 5]]));
    store.set([info(5, "claude", { alive: false, exit_code: 1 })]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} />);
    const band = screen.getByRole("status");
    expect(within(band).getByText(t("terminal.ended", { code: 1 })).className).toContain("is-danger");
    expect(container.querySelector(".tm-leaf")?.className).toContain("is-ended");
    fireEvent.click(within(band).getByRole("button", { name: t("terminal.reopen") }));
    await waitFor(() => expect(store.opened).toEqual([[1, null, "/data/races/p1/x-1", true]]));
    await waitFor(() => expect(paneIds(container)).toEqual(["101"]));
    expect(store.closed).toEqual([5]);
    // 시도(레인)의 짝도 새 세션으로 — 탭 이름 「시도 1」 이 그대로 따라간다.
    await waitFor(() => expect(container.querySelector(".tm-leaf")?.className).not.toContain("is-ended"));
    expect(laneNumberOf(101)).toBe(1);
  });

  it("an ended claude next to another live claude in the same folder reopens fresh — --continue would join the other's conversation", async () => {
    store.set([info(5, "claude", { alive: false, exit_code: 0 }), info(6, "claude", { status: idle })]);
    render(<TerminalScreen projectId={1} workday={null} />);
    fireEvent.click(document.querySelector<HTMLElement>('.tm-tab[data-tab-id="5"] [role="tab"]')!);
    const reopen = await screen.findByRole("button", { name: t("terminal.reopen") });
    expect(reopen).toHaveAttribute("title", t("terminal.reopenTitle"));
    fireEvent.click(reopen);
    await waitFor(() => expect(store.opened).toEqual([[1, null, null, false]]));
  });

  it("an ended claude alone in its folder says it continues that folder's latest conversation", () => {
    store.set([info(5, "claude", { alive: false, exit_code: 0 })]);
    render(<TerminalScreen projectId={1} workday={null} />);
    expect(screen.getByRole("button", { name: t("terminal.reopen") })).toHaveAttribute("title", t("terminal.reopenResumeTitle"));
  });

  it("the live 'no journal' band folds with × and comes back only after Claude works again", async () => {
    store.worked.add(7);
    store.set([info(7, "claude", { status: idle })]);
    render(<TerminalScreen projectId={1} workday={null} />);
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: t("terminal.bandFold") }));
    expect(screen.queryByRole("status")).toBeNull();
    // 일하지 않고 상태만 바뀌면(done) 접은 채로.
    act(() => store.set([info(7, "claude", { status: { ...idle, state: "done", since: "2026-11-14T10:10:00Z" } })]));
    expect(screen.queryByRole("status")).toBeNull();
    // 다음 차례 — 일하고(working) 다시 손을 놓았다. 여전히 일지가 없으면 다시 선다.
    act(() => store.set([info(7, "claude", { status: { ...idle, state: "working", since: "2026-11-14T10:20:00Z" } })]));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => store.set([info(7, "claude", { status: { ...idle, since: "2026-11-14T10:30:00Z" } })]));
    expect(within(screen.getByRole("status")).getByText(t("terminal.noRecord"))).toBeInTheDocument();
  });

  it("entering with no session paints no empty card and reads no next item while the first shell opens", async () => {
    render(<TerminalScreen projectId={1} workday={null} />);
    await waitFor(() => expect(store.list.map((s) => s.id)).toEqual([101]));
    expect(screen.queryByText(t("terminal.empty"))).toBeNull();
    expect(store.digestCalls).toBe(0);
  });

  it("when the first shell fails to open, the empty screen says why and offers a retry", async () => {
    store.fail = 1;
    render(<TerminalScreen projectId={1} workday={null} />);
    const retry = await screen.findByRole("button", { name: t("common.retry") });
    expect(retry.className).toContain("primary");
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => expect(store.opened).toHaveLength(2));
    await waitFor(() => expect(store.list.map((s) => s.id)).toEqual([102]));
  });

  it("the empty screen has exactly one filled button — the plan's next item when there is one", async () => {
    store.digest = {
      plans: [{ plan_id: "p", title: "Plan", next: { item_id: "i1", title: "Fix the cache", status: "todo" } }],
      needs_user: [],
      blocked: [],
      journal_plan: [],
    };
    store.set([info(3, "zsh", { alive: false, exit_code: 0 })]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} />);
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: t("terminal.closeAria", { name: "1 zsh" }) }));
    await screen.findByText(t("terminal.emptyNext", { title: "Fix the cache" }));
    expect(container.querySelectorAll(".btn.primary")).toHaveLength(1);
    expect(container.querySelector(".btn.primary")?.textContent).toBe(t("terminal.runNext"));
    expect(screen.getByRole("button", { name: t("terminal.emptyShell") })).toBeInTheDocument();
  });

  it("without a next item the one filled button opens a new session", async () => {
    store.set([info(3, "zsh", { alive: false, exit_code: 0 })]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} />);
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: t("terminal.closeAria", { name: "1 zsh" }) }));
    await screen.findByText(t("terminal.empty"));
    const primary = container.querySelectorAll(".btn.primary");
    expect(primary).toHaveLength(1);
    expect(primary[0].textContent).toContain(t("terminal.new"));
  });
});
