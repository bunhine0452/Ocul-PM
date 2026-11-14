// 나란히 돌린 시도의 띠 (TS-06) — 한 줄로 접힌다 · 변경 보기에서 가져온다 · 탭과 같은 원천 · 사용자의 말.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
  };
});
type Lane = { name: string; path: string; branch: string; files: number; added: number; removed: number; journals?: number };
const h = vi.hoisted(() => ({ lanes: [] as Lane[], lanesCalls: 0, taken: [] as string[] }));

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
vi.mock("@/api/race", () => ({
  raceApi: {
    lanes: async () => {
      h.lanesCalls += 1;
      return h.lanes;
    },
    patch: async () => "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n",
    take: async (_p: number, path: string) => void h.taken.push(path),
    clear: async () => 0,
  },
}));
vi.mock("@/api/oculpm", () => ({
  // 원래 프로젝트의 일지는 다섯 — 레인 탭은 이것이 아니라 레인 worktree 의 수를 말해야 한다.
  oculpmApi: { listJournalEntries: async () => Array.from({ length: 5 }, () => ({ created_at: "2026-11-14T12:00:00Z" })) },
}));
vi.mock("@/api/projects", () => ({ projectsApi: { onJournalAdded: async () => () => {} } }));

import { setLangSetting, t } from "@/i18n";
import { ko } from "@/i18n/ko";
import { RaceStrip } from "@/features/terminal/RacePanel";
import { TerminalScreen, __resetTermLayoutForTests } from "@/features/terminal/TerminalScreen";
import { __resetRaceForTests, __setRaceForTests } from "@/features/terminal/race";

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
const lane = (n: number, extra: Partial<Lane> = {}): Lane => ({
  name: `r-${n}`,
  path: `/data/races/p1/r-${n}`,
  branch: `ocul-race/r-${n}`,
  files: 1,
  added: 2,
  removed: 1,
  journals: 0,
  ...extra,
});
const blocked = { state: "blocked", kind: "permission", msg: "approve Bash", since: "2026-11-14T10:01:00Z" };
const idle = { state: "idle", kind: null, msg: null, since: "2026-11-14T10:01:00Z" };

beforeEach(() => {
  setLangSetting("ko");
  __resetRaceForTests();
  __resetTermLayoutForTests();
  store.set([]);
  store.worked.clear();
  h.lanes = [];
  h.lanesCalls = 0;
  h.taken.length = 0;
});
afterEach(() => cleanup());

function threeLanes() {
  h.lanes = [lane(1), lane(2), lane(3)];
  store.set([info(1, "claude"), info(2, "claude", { status: blocked }), info(3, "claude")]);
  __setRaceForTests(h.lanes as never, new Map(h.lanes.map((l, i) => [l.path, i + 1])));
}

describe("race strip folds to one line", () => {
  it("three runs with one waiting: the folded line says 3 and '1 waiting'; expanding shows three rows", () => {
    threeLanes();
    render(<RaceStrip projectId={1} />);
    const summary = screen.getByRole("button", { expanded: false });
    expect(summary.textContent).toContain(t("race.summary", { n: 3 }));
    expect(summary.textContent).toContain(t("race.summaryWaiting", { n: 1 }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(summary);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    // 펼친 줄은 탭과 같은 점 · 앰버 낱말.
    expect(rows[1].querySelector(".tm-dot")?.className).toContain("is-wait");
    expect(rows[1].textContent).toContain(t("terminal.state.permission"));
    expect(rows[0].querySelector(".tm-meta")).toBeNull();
  });

  it("with no runs, five status changes read the lanes at most once (on entering the screen)", async () => {
    store.set([info(1, "zsh")]);
    render(<RaceStrip projectId={1} />);
    for (const state of ["working", "idle", "working", "done", "idle"]) {
      act(() => store.set([info(1, "zsh", { status: { state, kind: null, msg: null, since: "" } })]));
    }
    await new Promise((r) => setTimeout(r, 750));
    expect(h.lanesCalls).toBeLessThanOrEqual(1);
  });

  it("the run's name opens its changes; the dialog has close buttons and 'bring these changes' through the confirm", async () => {
    threeLanes();
    render(<RaceStrip projectId={1} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: t("race.lane", { n: 2 }) }));
    const dialog = await screen.findByRole("dialog", { name: t("race.lane", { n: 2 }) });
    expect(within(dialog).getAllByRole("button", { name: t("common.close") })).toHaveLength(2);
    // ‹ 시도 1 · 시도 3 › — 대화상자를 닫지 않고 옆 시도로.
    expect(within(dialog).getByRole("button", { name: t("race.lane", { n: 3 }) })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: t("race.take") }));
    const confirmTake = await screen.findAllByRole("button", { name: t("race.take") });
    fireEvent.click(confirmTake[confirmTake.length - 1]);
    await waitFor(() => expect(h.taken).toEqual(["/data/races/p1/r-2"]));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: t("race.lane", { n: 2 }) })).toBeNull());
  });
});

describe("one source for a run's journals", () => {
  it("a run session's tab counts the run worktree's journals, not the project's", async () => {
    h.lanes = [lane(1, { journals: 2 }), lane(2, { journals: 0 })];
    store.worked.add(2);
    store.set([info(1, "claude", { status: idle }), info(2, "claude", { status: idle }), info(3, "zsh")]);
    __setRaceForTests(h.lanes as never, new Map([[h.lanes[0].path, 1], [h.lanes[1].path, 2]]));
    render(<TerminalScreen projectId={1} workday="20261114" />);
    const tabOf = (id: number) => document.querySelector<HTMLElement>(`.tm-tab[data-tab-id="${id}"] [role="tab"]`)!;
    await waitFor(() => expect(tabOf(3).title).toContain(t("terminal.records", { n: 5 })));
    expect(tabOf(1).title).toContain(t("terminal.records", { n: 2 }));
    expect(tabOf(1).textContent).toContain(t("race.lane", { n: 1 }));
    expect(tabOf(2).textContent).toContain(t("terminal.noRecord"));
  });
});

describe("the user's words", () => {
  it("race.* says 'side by side' and 'run n', never the internal lane / race words or retired terms", () => {
    const values = Object.entries(ko)
      .filter(([k]) => k.startsWith("race."))
      .map(([, v]) => v);
    for (const v of values) {
      // i18n-ignore-next-line -- 걷은 옛 이름 검출 정규식(검사 재료)
      expect(v).not.toMatch(/레인|^여럿에서$|이것으로|증거|판정|확인함|사용자 몫/);
    }
    expect(ko["race.lane"]).toContain("{n}");
  });
});
