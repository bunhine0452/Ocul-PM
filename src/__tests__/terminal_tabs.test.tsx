// 터미널 탭은 번호 · 이름과 예외만 (TS-01) — 평상 낱말 · 일지 수는 툴팁, 점은 모양으로도 갈린다.
// xterm 은 jsdom 에서 그릴 수 없다 — 세션 저장소를 흉내 내고 화면의 약속만 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
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
const journal = vi.hoisted(() => ({ created: [] as string[] }));
vi.mock("@/api/oculpm", () => ({
  oculpmApi: { listJournalEntries: async () => journal.created.map((c) => ({ created_at: c })) },
}));
vi.mock("@/api/projects", () => ({ projectsApi: { onJournalAdded: async () => () => {} } }));
vi.mock("@/api/race", () => ({ raceApi: { lanes: async () => [] } }));

import { t } from "@/i18n";
import { TerminalScreen, __resetTermLayoutForTests } from "@/features/terminal/TerminalScreen";
import { sessionNumber, sessionView } from "@/features/terminal/status";

type Titled = TermInfo & { title?: string | null };

function info(id: number, label: string, extra: Partial<Titled> = {}): Titled {
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

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const tabOf = (id: number) => document.querySelector<HTMLElement>(`.tm-tab[data-tab-id="${id}"]`)!;
const pickOf = (id: number) => tabOf(id).querySelector<HTMLElement>('[role="tab"]')!;

beforeEach(() => {
  __resetTermLayoutForTests();
  store.set([]);
  store.worked.clear();
  journal.created = [];
});
afterEach(() => cleanup());

describe("terminal tabs say only the exceptions", () => {
  it("an idle shell tab shows neither 'running' nor the journal count — both live in the tooltip", async () => {
    journal.created = ["2026-11-14T10:30:00Z"];
    store.set([info(1, "zsh"), info(2, "zsh")]);
    render(<TerminalScreen projectId={1} workday="20261114" />);
    await waitFor(() => expect(pickOf(1).title).toContain(t("terminal.records", { n: 1 })));
    const tab = pickOf(1);
    expect(tab.textContent).not.toContain(t("terminal.running"));
    expect(tab.textContent).not.toContain(t("terminal.records", { n: 1 }));
    expect(tab.title).toContain(t("terminal.running"));
    // 살아 있는 세션의 점은 회색 — 초록 점이 줄마다 서지 않는다.
    expect(tab.querySelector(".tm-dot")?.className).toBe("tm-dot is-live");
  });

  it("a blocked session shows its reason and is marked as waiting (amber dot with a ring)", () => {
    const status = { state: "blocked", kind: "permission", msg: "approve Write: a.ts", since: minutesAgo(1) };
    store.set([info(1, "claude", { status }), info(2, "zsh")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    expect(tabOf(1).classList.contains("is-wait")).toBe(true);
    expect(pickOf(1).textContent).toContain(t("terminal.state.permission"));
    expect(pickOf(1).querySelector(".tm-meta")?.className).toContain("is-warn");
    expect(pickOf(1).querySelector(".tm-dot")?.className).toContain("is-wait");
    expect(pickOf(1).title).toContain("approve Write: a.ts");
  });

  it("exit code 1 marks the tab as failed and says the code in red", () => {
    store.set([info(1, "zsh", { alive: false, exit_code: 1 }), info(2, "zsh")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    expect(tabOf(1).classList.contains("is-fail")).toBe(true);
    expect(pickOf(1).textContent).toContain(t("terminal.ended", { code: 1 }));
    expect(pickOf(1).querySelector(".tm-meta")?.className).toContain("is-danger");
    // 0 으로 끝나면 실패가 아니라 빈 고리.
    cleanup();
    __resetTermLayoutForTests();
    store.set([info(1, "zsh", { alive: false, exit_code: 0 }), info(2, "zsh")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    expect(tabOf(1).classList.contains("is-fail")).toBe(false);
    expect(pickOf(1).querySelector(".tm-dot")?.className).toContain("is-ended");
  });

  it("an info that carries a title (OSC) is named by it", () => {
    store.set([info(1, "zsh", { title: "vim notes.md" }), info(2, "zsh")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    expect(pickOf(1).querySelector(".tm-name")?.textContent).toBe("vim notes.md");
    expect(pickOf(2).querySelector(".tm-name")?.textContent).toBe("zsh");
  });

  it("three sessions with the same label are told apart by their window numbers 1 · 2 · 3", () => {
    store.set([info(11, "claude"), info(12, "claude"), info(13, "claude")]);
    render(<TerminalScreen projectId={1} workday={null} />);
    const nums = [...document.querySelectorAll(".tm-tab .tm-num")].map((n) => n.textContent);
    expect(nums).toEqual(["1", "2", "3"]);
    // 닫혀도 번호는 다시 쓰지 않는다 — 새 세션은 4.
    expect(sessionNumber(14)).toBe(4);
  });

  it("'working' with no change for over 30 minutes reads as no recent news; a fresh one says nothing", () => {
    store.set([
      info(1, "claude", { status: { state: "working", kind: null, msg: null, since: minutesAgo(31) } }),
      info(2, "claude", { status: { state: "working", kind: null, msg: null, since: minutesAgo(2) } }),
      info(3, "zsh"),
    ]);
    render(<TerminalScreen projectId={1} workday={null} />);
    expect(pickOf(1).textContent).toContain(t("terminal.state.quiet"));
    expect(pickOf(2).querySelector(".tm-meta")).toBeNull();
    expect(pickOf(2).title).toContain(t("terminal.state.working"));
  });

  it("a session that worked and went idle with no journal shows 'no journal' with an amber dot", () => {
    store.worked.add(1);
    const idle = { state: "idle", kind: null, msg: null, since: minutesAgo(1) };
    const view = sessionView(t, info(1, "claude", { status: idle }), true, 0);
    expect(view).toMatchObject({ mark: "live", word: null, norec: true });
    expect(sessionView(t, info(1, "claude", { status: idle }), true, 2).norec).toBe(false);
  });
});

describe("terminal.css — colour only for exceptions (receipt rule 1)", () => {
  it("has no --ok / --ok-text: a live session is grey, a journal count is not green", () => {
    const css = readFileSync(join(__dirname, "..", "features", "terminal", "terminal.css"), "utf8");
    expect(css).not.toMatch(/var\(--ok(-text)?\)/);
  });
});
