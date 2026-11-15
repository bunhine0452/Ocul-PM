// "Ask for a journal entry" must never type into a shell (final review TERM-3 · SEC-02). The band can stand on a stale
// idle status: claude died without `state=clear` and the shell came back to the front. So the send re-reads the list
// and pastes only where Claude still runs (alive, busy, reported or opened as claude, named claude); otherwise it
// writes nothing, folds the band and says why. Queued messages follow the same rule when they flush.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { TermInfo, TermStatus } from "@/api/terminal";

const api = vi.hoisted(() => ({
  list: [] as TermInfo[],
  writes: [] as Array<[number, string]>,
  failList: false,
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => {
      if (api.failList) throw new Error("ipc");
      return api.list;
    },
    write: async (id: number, data: string) => void api.writes.push([id, data]),
    onSessionsChanged: async () => () => {},
  },
}));

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
  closeTerm: () => {},
}));
vi.mock("@/api/plan", () => ({
  planApi: {
    todayDigest: async () => ({ plans: [], needs_user: [], blocked: [], journal_plan: [] }),
    dispatchPrompt: async () => ({ prompt: "" }),
  },
}));
vi.mock("@/api/oculpm", () => ({ oculpmApi: { listJournalEntries: async () => [] } }));
vi.mock("@/api/projects", () => ({ projectsApi: { onJournalAdded: async () => () => {} } }));
vi.mock("@/api/race", () => ({ raceApi: { lanes: async () => [] } }));

import { t } from "@/i18n";
import { getToasts } from "@/lib/toast";
import { TerminalScreen, __resetTermLayoutForTests } from "@/features/terminal/TerminalScreen";
import { cancelQueued, enqueue, flushQueue, queuedStore, sendOrQueue } from "@/features/terminal/sendToClaude";

const idle: TermStatus = { state: "idle", kind: null, msg: null, since: "2026-11-15T10:05:00Z" };

function info(id: number, label: string, extra: Partial<TermInfo> = {}): TermInfo {
  return {
    id,
    project_id: 1,
    label,
    started_at: "2026-11-15T10:00:00Z",
    alive: true,
    exit_code: null,
    status: idle,
    busy: true,
    unseen: false,
    ...extra,
  };
}

const toasted = (message: string) => getToasts().some((x) => x.message === message);

beforeEach(() => {
  __resetTermLayoutForTests();
  api.list = [];
  api.writes = [];
  api.failList = false;
  store.worked.clear();
  store.set([]);
  for (const q of queuedStore.get()) cancelQueued(q.key);
});
afterEach(() => cleanup());

describe("sendOrQueue pastes only where Claude still runs", () => {
  it("writes nothing to a session whose shell is back in front, even with an idle status left over", async () => {
    api.list = [info(4, "claude", { busy: false })];
    expect(await sendOrQueue(4, "write the journal")).toEqual({ outcome: "absent" });
    expect(api.writes).toEqual([]);
  });

  it("writes nothing to a Codex session, a session that ended, or when the list can't be read", async () => {
    api.list = [info(4, "claude", { status: { ...idle, app: "codex" } }), info(5, "claude", { alive: false })];
    expect(await sendOrQueue(4, "x")).toEqual({ outcome: "absent" });
    expect(await sendOrQueue(5, "x")).toEqual({ outcome: "absent" });
    api.failList = true;
    expect(await sendOrQueue(4, "x")).toEqual({ outcome: "absent" });
    expect(api.writes).toEqual([]);
  });

  it("still pastes into a Claude that is idle in front", async () => {
    api.list = [info(4, "claude")];
    expect(await sendOrQueue(4, "x", {})).toEqual({ outcome: "sent" });
    expect(api.writes.map(([id]) => id)).toEqual([4, 4]);
  });
});

describe("flushQueue", () => {
  it("drops a queued message instead of typing it into the shell once Claude has left (status cleared)", async () => {
    const deliver = vi.fn(async () => {});
    enqueue(4, "queued words");
    const res = await flushQueue([info(4, "claude", { status: null, busy: false })], deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(res.delivered).toEqual([]);
    expect(res.absent.map((q) => q.message)).toEqual(["queued words"]);
    expect(queuedStore.get()).toEqual([]);
  });
});

describe("the band", () => {
  it("pressing 'ask for a journal entry' over a shell writes nothing, folds the band and says why", async () => {
    store.worked.add(7);
    store.set([info(7, "claude", { busy: false })]);
    api.list = [info(7, "claude", { busy: false })];
    render(<TerminalScreen projectId={1} workday={null} />);
    const band = screen.getByRole("status");
    fireEvent.click(within(band).getByRole("button", { name: t("terminal.askRecord") }));
    await waitFor(() => expect(toasted(t("terminal.noClaude", { n: 1 }))).toBe(true));
    expect(api.writes).toEqual([]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a Codex session gets the 'no journal' fact but no button that sends a Claude prompt", () => {
    store.worked.add(7);
    store.set([info(7, "zsh", { status: { ...idle, app: "codex" } })]);
    render(<TerminalScreen projectId={1} workday={null} />);
    const band = screen.getByRole("status");
    expect(within(band).getByText(t("terminal.noRecord"))).toBeInTheDocument();
    expect(within(band).queryByRole("button", { name: t("terminal.askRecord") })).toBeNull();
  });
});
