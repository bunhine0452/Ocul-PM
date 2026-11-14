// 오늘 — 예외마다 다음 한 걸음 · 동작은 영수증대로 (11-15 TD-06).
//
// 「일지 없이 끝난 대화」 행이 「변경 보기」 로 갔고, 「출력 보기」 는 같은 끝 줄을 다시 보여 줄 뿐이었고, 확인
// 명령 없는 계획의 「다시 확인」 은 빈 명령을 보냈고, 「모두 읽음」 은 못 한 것을 버리고 되돌릴 수 없었고,
// 실행 단추는 두 번 누르면 두 번 돌았다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./todayFixture")).bindingsMock());
// 터미널(xterm)은 띄우지 않는다 — 세션을 여는 자리만 센다. 실행 경로(runPrompt)는 진짜를 탄다.
const term = vi.hoisted(() => ({ opened: [] as Array<string | null> }));
vi.mock("@/features/terminal/termStore", () => ({
  openTerm: async (_projectId: number, prompt: string | null) => {
    term.opened.push(prompt);
    return term.opened.length;
  },
}));

import { __resetTodayStoreForTests } from "@/features/today/useTodayExceptions";
import { takeTermFocus } from "@/features/terminal/focusRequest";
import { t } from "@/i18n";
import { getToasts } from "@/lib/toast";
import { digest, entry, fx, plan, resetFx } from "./todayFixture";
import { renderToday } from "./todayRender";

const checkCard = () => screen.getByRole("region", { name: t("today.check.title") });
const unreadCard = () => screen.getByRole("region", { name: t("today.unread.title") });
/** 먼저 볼 것 안의 그 종류 행이 설 때까지. */
const rowOf = (kind: string) =>
  waitFor(() => {
    const el = checkCard().querySelector<HTMLElement>(`[data-kind="${kind}"]`);
    if (!el) throw new Error(`no ${kind} row yet`);
    return el;
  });
const failed = { passed: false, summary: "2 failed, 418 passed", ts: new Date().toISOString(), agent_id: "claude-code", item_id: "x" };
/** 이 창의 터미널 세션 — `busy` 면 셸 위에서 무언가 돈다. */
const termSession = (id: number, busy: boolean) => ({ id, project_id: 1, label: "zsh", started_at: new Date().toISOString(), alive: true, exit_code: null, busy, status: null });
/** 150분째 기록이 없는 작업 세션 — 「지금 일하는 중」 이 조용하다고 말한다. */
const quietSession = {
  id: "s-1",
  started_at: new Date(Date.now() - 150 * 60_000).toISOString(),
  ended_at: null,
  ended_reason: null,
  active_window_ms: 0,
  file_event_count: 1,
  files_unique: 1,
  git_head_at_start: null,
  git_head_at_end: null,
  agent_label_guess: "claude-code",
  linked_journal_entries: [],
};

beforeEach(() => {
  resetFx();
  term.opened.length = 0;
});
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
});

describe("each exception offers its next step", () => {
  it("a conversation that ended without a journal is a 'no journal' row whose action asks Claude for the entry", async () => {
    fx.missing = [{ ts: new Date().toISOString(), session_id: "conv-1234567890abcdef", segments: 1 }];
    renderToday();
    const row = await rowOf("silent");
    expect(row.querySelector(".chip")?.textContent).toBe(t("today.chip.noJournal"));
    expect(row.querySelector(".chip")?.textContent).not.toBe(t("today.check.kind.unrecorded"));
    expect(within(row).getByText(t("today.check.silentTitle", { n: 1 }))).toBeInTheDocument();
    // 대화 id 는 줄이 아니라 툴팁에.
    expect(row.textContent).not.toContain("conv-123");
    expect(within(row).queryByRole("button", { name: t("today.check.viewChanges") })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: t("today.check.askJournal") }));
    await waitFor(() => expect(term.opened).toHaveLength(1));
    expect(term.opened[0]).toContain("conv-1234567890abcdef");
    expect(term.opened[0]).toBe(t("today.check.askJournalPrompt", { ids: "conv-1234567890abcdef" }));
  });

  it("a failed check offers 'check again' first and 'open plan' second; without a check command 'check again' says why", async () => {
    fx.digest = digest({ plans: [plan("a", { last_verdict: failed }), plan("b", { check: null, last_verdict: failed })] });
    const { onNavigate } = renderToday();
    await waitFor(() => expect(checkCard().querySelectorAll('[data-kind="verdict"]')).toHaveLength(2));
    const [withCheck, without] = [...checkCard().querySelectorAll<HTMLElement>('[data-kind="verdict"]')];
    expect(within(withCheck).getAllByRole("button").map((b) => b.textContent)).toEqual([t("today.check.recheck"), t("today.check.openPlan")]);
    const blockedRecheck = within(without).getByRole("button", { name: t("today.check.recheck") });
    expect(blockedRecheck).toHaveAttribute("aria-disabled", "true");
    expect(blockedRecheck).toHaveAttribute("title", t("today.check.noCheck"));
    fireEvent.click(blockedRecheck);
    fireEvent.click(within(withCheck).getByRole("button", { name: t("today.check.recheck") }));
    await waitFor(() => expect(term.opened).toHaveLength(1));
    expect(term.opened[0]).toContain("`pnpm test`");
    fireEvent.click(within(without).getByRole("button", { name: t("today.check.openPlan") }));
    expect(onNavigate).toHaveBeenCalledWith("planner");
  });

  it("a blocked item keeps its #id in the tooltip, not on the line", async () => {
    fx.digest = digest({ blocked: [{ plan_id: "a", plan_title: "plan a", item_id: "hook", title: "start hook", status: "blocked" }] });
    renderToday();
    const row = await rowOf("blocked");
    const meta = row.querySelector(".tdy-meta") as HTMLElement;
    expect(meta.textContent).not.toContain("#hook");
    expect(meta.title).toBe("#hook");
  });

  it("a quiet session says how long in hours, plainly, and offers the one terminal session running something", async () => {
    fx.terms = [termSession(9, true), termSession(4, false)];
    fx.sessions = [quietSession];
    const { onNavigate } = renderToday();
    const live = await screen.findByRole("region", { name: t("today.live.title") });
    expect(within(live).getByText(t("today.live.quietHours", { n: 2 }))).toBeInTheDocument();
    fireEvent.click(within(live).getByRole("button", { name: t("today.check.openTerminal") }));
    expect(takeTermFocus()).toBe(9);
    expect(onNavigate).toHaveBeenCalledWith("terminal");
  });

  it("does not guess a terminal: only an idle shell (the agent runs outside) or two running sessions — no button", async () => {
    fx.sessions = [quietSession];
    fx.terms = [termSession(4, false)];
    renderToday();
    const live = await screen.findByRole("region", { name: t("today.live.title") });
    expect(within(live).queryByRole("button", { name: t("today.check.openTerminal") })).toBeNull();
    cleanup();
    __resetTodayStoreForTests();
    fx.terms = [termSession(9, true), termSession(10, true)];
    renderToday();
    const again = await screen.findByRole("region", { name: t("today.live.title") });
    expect(within(again).queryByRole("button", { name: t("today.check.openTerminal") })).toBeNull();
  });
});

describe("actions behave like receipts", () => {
  it("'mark all read' counts what the backend did, brings the skipped row back, and can be undone", async () => {
    fx.entries = [1, 2, 3, 4].map((i) => entry(i, { type: "bug", evidence: 0, title: `unread ${i}` }));
    const skipped = fx.entries[3].relative_path;
    fx.bulkSkipped = [skipped];
    renderToday();
    await waitFor(() => expect(within(unreadCard()).getAllByRole("listitem")).toHaveLength(4));
    fireEvent.click(within(unreadCard()).getByRole("button", { name: t("today.unread.allRead") }));
    await waitFor(() => expect(getToasts().map((x) => x.message)).toContain(t("today.unread.allReadPartial", { n: 3, m: 1 })));
    await waitFor(() => expect(within(unreadCard()).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["unread 4"]));
    const toast = getToasts().find((x) => x.message === t("today.unread.allReadPartial", { n: 3, m: 1 }));
    expect(toast?.actions?.[0].label).toBe(t("today.unread.undo"));
    toast?.actions?.[0].onClick();
    await waitFor(() => expect(fx.bulkCalls[fx.bulkCalls.length - 1]).toEqual([fx.entries.slice(0, 3).map((e) => e.relative_path), false]));
  });

  it("'run in terminal' pressed twice quickly opens one session", async () => {
    fx.digest = digest({ plans: [plan("a", { next: { plan_id: "a", plan_title: "plan a", item_id: "ship", title: "ship it", status: "todo" } })] });
    renderToday();
    const run = await screen.findByRole("button", { name: t("today.nextUp.run") });
    fireEvent.click(run);
    fireEvent.click(run);
    await waitFor(() => expect(term.opened).toEqual(["PROMPT"]));
    await new Promise((r) => setTimeout(r, 30));
    expect(term.opened).toHaveLength(1);
    expect(fx.dispatchCalls).toHaveLength(1);
  });

  it("with one unverified journal there is no 'mark all read' — the row's own button is always shown", async () => {
    fx.entries = [entry(1, { type: "bug", evidence: 0, title: "only one" })];
    renderToday();
    const row = await waitFor(() => within(unreadCard()).getByRole("listitem"));
    expect(within(unreadCard()).queryByRole("button", { name: t("today.unread.allRead") })).toBeNull();
    const read = within(row).getByRole("button", { name: t("today.check.verifyAria", { title: "only one" }) });
    expect(read.classList.contains("tdy-row-quiet")).toBe(false);
  });
});
