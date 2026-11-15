// 「기록 남기게 하기」 는 셸에 치지 않는다 (최종 검수 TERM-3 · SEC-02). 띠는 낡은 idle 상태로도 선다 — claude 가
// `state=clear` 없이 죽고 셸이 다시 앞에 섰을 때. 그래서 보내기는 목록을 다시 읽어 Claude 가 아직 도는 칸(살아 있음 ·
// 도는 중 · 상태를 알렸거나 claude 로 연 칸 · 이름이 Claude)에만 붙여 넣고, 아니면 아무것도 치지 않은 채 띠를 접고
// 까닭을 말한다. 목록을 못 읽은 것은 「없음」 이 아니다 — 치지 않되 띠를 두고 그렇게 말한다. 줄 세운 말도 넣을 때 같은
// 규칙을 따르고, 넣지 못한 말은 세션마다 개수를 말하고 쓰던 말로 돌아간다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { TermInfo, TermStatus } from "@/api/terminal";

const api = vi.hoisted(() => ({
  list: [] as TermInfo[],
  writes: [] as Array<[number, string]>,
  failList: false,
  changed: new Set<() => void>(),
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => {
      if (api.failList) throw new Error("ipc");
      return api.list;
    },
    write: async (id: number, data: string) => void api.writes.push([id, data]),
    onSessionsChanged: async (cb: () => void) => {
      api.changed.add(cb);
      return () => void api.changed.delete(cb);
    },
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
import { dismissToast, getToasts } from "@/lib/toast";
import { TerminalScreen, __resetTermLayoutForTests } from "@/features/terminal/TerminalScreen";
import { SendToClaudeHost, __resetSendDraftsForTests } from "@/features/terminal/SendToClaudeHost";
import {
  cancelQueued,
  enqueue,
  flushQueue,
  queuedStore,
  requestSendToClaude,
  sendOrQueue,
  type SendContext,
} from "@/features/terminal/sendToClaude";

const idle: TermStatus = { state: "idle", kind: null, msg: null, since: "2026-11-15T10:05:00Z" };
const working: TermStatus = { ...idle, state: "working" };
const plan: SendContext = { kind: "plan", label: "Fix the cache", ref: "cache-plan#ttl" };

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
const promptBox = () => screen.findByRole("textbox", { name: t("send.placeholder") });

beforeEach(() => {
  __resetTermLayoutForTests();
  __resetSendDraftsForTests();
  api.list = [];
  api.writes = [];
  api.failList = false;
  store.worked.clear();
  store.set([]);
  for (const q of queuedStore.get()) cancelQueued(q.key);
  for (const x of [...getToasts()]) dismissToast(x.id);
});
afterEach(() => cleanup());

describe("sendOrQueue pastes only where Claude still runs", () => {
  it("writes nothing to a session whose shell is back in front, even with an idle status left over", async () => {
    api.list = [info(4, "claude", { busy: false })];
    expect(await sendOrQueue(4, "write the journal")).toEqual({ outcome: "absent" });
    expect(api.writes).toEqual([]);
  });

  it("writes nothing to a Codex session or a session that ended", async () => {
    api.list = [info(4, "claude", { status: { ...idle, app: "codex" } }), info(5, "claude", { alive: false })];
    expect(await sendOrQueue(4, "x")).toEqual({ outcome: "absent" });
    expect(await sendOrQueue(5, "x")).toEqual({ outcome: "absent" });
    expect(api.writes).toEqual([]);
  });

  it("writes nothing when the list can't be read, and says 'unknown' rather than 'absent'", async () => {
    api.list = [info(4, "claude")];
    api.failList = true;
    expect(await sendOrQueue(4, "x")).toEqual({ outcome: "unknown" });
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

  it("calls onDropped for the messages it gives up on, not for the ones it delivers", async () => {
    const gaveUp = vi.fn();
    const sent = vi.fn();
    enqueue(4, "to a shell", undefined, gaveUp);
    enqueue(5, "to an ended session", undefined, gaveUp);
    enqueue(6, "to claude", undefined, sent);
    const list = [info(4, "claude", { busy: false }), info(5, "claude", { alive: false }), info(6, "claude")];
    const res = await flushQueue(list, vi.fn(async () => {}));
    expect(res.delivered.map((q) => q.sessionId)).toEqual([6]);
    expect(gaveUp).toHaveBeenCalledTimes(2);
    expect(sent).not.toHaveBeenCalled();
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

  it("when the list can't be read, writes nothing but keeps the band and says the list failed", async () => {
    store.worked.add(7);
    store.set([info(7, "claude")]);
    api.failList = true;
    render(<TerminalScreen projectId={1} workday={null} />);
    const band = screen.getByRole("status");
    fireEvent.click(within(band).getByRole("button", { name: t("terminal.askRecord") }));
    await waitFor(() => expect(toasted(t("terminal.noList"))).toBe(true));
    expect(toasted(t("terminal.noClaude", { n: 1 }))).toBe(false);
    expect(api.writes).toEqual([]);
    expect(screen.getByRole("status")).toBeInTheDocument();
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

describe("the send dialog and its queue", () => {
  it("keeps the dialog and the words when the list can't be read at send time", async () => {
    api.list = [info(4, "claude")];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(plan));
    fireEvent.change(await promptBox(), { target: { value: "check the cache" } });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("4"));
    api.failList = true;
    fireEvent.click(screen.getByRole("button", { name: t("send.submit") }));
    await waitFor(() => expect(toasted(t("terminal.noList"))).toBe(true));
    expect(api.writes).toEqual([]);
    expect(await promptBox()).toHaveValue("check the cache");
  });

  it("queued words Claude never got are counted per session and go back to the draft", async () => {
    api.list = [info(4, "claude", { status: working })];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(plan));
    fireEvent.change(await promptBox(), { target: { value: "check the cache" } });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("4"));
    fireEvent.click(screen.getByRole("button", { name: t("send.submitQueue") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => void enqueue(4, "a second message"));
    expect(queuedStore.get()).toHaveLength(2);
    // claude 가 state=clear 없이 죽었다 — idle 이 남고 셸이 앞에 섰다.
    api.list = [info(4, "claude", { busy: false })];
    await act(async () => {
      for (const cb of api.changed) cb();
    });
    await waitFor(() => expect(toasted(t("terminal.noClaudeQueued", { n: 1, count: 2 }))).toBe(true));
    expect(api.writes).toEqual([]);
    act(() => requestSendToClaude(plan));
    expect(await promptBox()).toHaveValue("check the cache");
  });

  it("leaves the queue alone when the list can't be read — no words dropped as 'the session ended'", async () => {
    render(<SendToClaudeHost projectId={1} />);
    api.failList = true;
    act(() => void enqueue(4, "queued words"));
    await act(async () => {
      for (const cb of api.changed) cb();
    });
    expect(queuedStore.get().map((q) => q.message)).toEqual(["queued words"]);
    expect(getToasts()).toEqual([]);
  });
});
