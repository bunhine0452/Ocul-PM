// 터미널 탭 (4.0 다시) — 세션 목록 한 칸 · 시작 뒤 일지 수 · 닫기 · 처음엔 셸 하나.
// xterm 은 jsdom 에서 그릴 수 없다 — 세션 저장소를 흉내 내고 화면의 약속만 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { TermInfo } from "@/api/terminal";

const store = vi.hoisted(() => {
  let list: TermInfo[] = [];
  const subs = new Set<() => void>();
  const set = (next: TermInfo[]) => {
    list = next;
    for (const fn of subs) fn();
  };
  return {
    get list() {
      return list;
    },
    set,
    opened: [] as Array<string | null>,
    closed: [] as number[],
    mounted: [] as number[],
    subscribe: (fn: () => void) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
});

vi.mock("@/features/terminal/termStore", () => ({
  subscribeTerms: store.subscribe,
  termsSnapshot: () => store.list,
  openTerm: async (_projectId: number, prompt: string | null = null) => {
    store.opened.push(prompt);
    const id = store.list.length + 1;
    store.set([...store.list, info(id, prompt ? "claude" : "zsh")]);
    return id;
  },
  mountTerm: (id: number) => {
    store.mounted.push(id);
    return () => {};
  },
  closeTerm: (id: number) => {
    store.closed.push(id);
    store.set(store.list.filter((s) => s.id !== id));
  },
}));

const journal = vi.hoisted(() => ({ created: [] as string[] }));
vi.mock("@/api/oculpm", () => ({
  oculpmApi: { listJournalEntries: async () => journal.created.map((c) => ({ created_at: c })) },
}));
vi.mock("@/api/projects", () => ({ projectsApi: { onJournalAdded: async () => () => {} } }));

import { __resetLangForTests, setLangSetting, t } from "@/i18n";
import { TerminalScreen } from "@/features/terminal/TerminalScreen";
import { runPromptInTerminal } from "@/features/terminal/runPrompt";
import { NAV_BUS } from "@/lib/navRegistry";

function info(id: number, label: string, extra: Partial<TermInfo> = {}): TermInfo {
  return {
    id,
    project_id: 1,
    label,
    started_at: "2026-10-29T10:00:00Z",
    alive: true,
    exit_code: null,
    status: null,
    busy: false,
    ...extra,
  };
}

beforeEach(() => {
  setLangSetting("ko");
  store.set([]);
  store.opened.length = 0;
  store.closed.length = 0;
  store.mounted.length = 0;
  journal.created = [];
});
afterEach(() => {
  cleanup();
  __resetLangForTests();
});

describe("터미널 탭", () => {
  it("세션이 없으면 셸 하나를 띄우고 그 세션을 화면에 붙인다", async () => {
    render(<TerminalScreen projectId={1} workday="20261029" />);
    await waitFor(() => expect(store.opened).toEqual([null]));
    const list = screen.getByRole("region", { name: t("terminal.listAria") });
    expect(await within(list).findByText("zsh")).toBeInTheDocument();
    await waitFor(() => expect(store.mounted).toContain(1));
  });

  it("세션 줄은 도는 중/끝남과 시작 뒤 일지 수를 말한다", async () => {
    store.set([info(1, "zsh"), info(2, "claude", { alive: false, exit_code: 0 })]);
    journal.created = ["2026-10-29T09:00:00Z", "2026-10-29T10:30:00Z", "2026-10-29T11:00:00Z"];
    render(<TerminalScreen projectId={1} workday="20261029" />);
    expect(store.opened).toEqual([]); // 이미 있으면 새로 띄우지 않는다
    expect(await screen.findAllByText(new RegExp(t("terminal.records", { n: 2 })))).toHaveLength(2);
    expect(screen.getByText(t("terminal.running"), { exact: false })).toBeInTheDocument();
    expect(screen.getByText(t("terminal.ended", { code: 0 }), { exact: false })).toBeInTheDocument();
  });

  it("안의 프로그램이 알린 상태(OSC 7501)를 말하고, 내 손을 기다리면 그 까닭 한 줄을 붙인다", async () => {
    const since = "2026-10-29T10:05:00Z";
    store.set([
      info(1, "claude", { status: { state: "blocked", kind: "question", msg: "비울까요? (예 · 아니오)", since } }),
      info(2, "claude", { status: { state: "working", kind: null, msg: "읽는 중", since } }),
    ]);
    render(<TerminalScreen projectId={1} workday="20261029" />);
    expect(await screen.findByText(t("terminal.state.question"), { exact: false })).toBeInTheDocument();
    expect(screen.getByText("비울까요? (예 · 아니오)")).toBeInTheDocument();
    expect(screen.getByText(t("terminal.state.working"), { exact: false })).toBeInTheDocument();
    // 작업 중일 때의 한 줄은 예외가 아니다 — 기다릴 때만 보인다.
    expect(screen.queryByText("읽는 중")).toBeNull();
  });

  it("닫기는 그 세션을 닫고, 새 세션 단추는 셸을 하나 더 연다", async () => {
    store.set([info(1, "zsh"), info(2, "claude")]);
    render(<TerminalScreen projectId={1} workday="20261029" />);
    fireEvent.click(screen.getByRole("button", { name: t("terminal.closeAria", { name: "claude" }) }));
    expect(store.closed).toEqual([2]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(t("terminal.new")) }));
    });
    expect(store.opened).toEqual([null]);
  });
});

describe("「다음」 실행", () => {
  it("프롬프트로 새 세션을 열고 터미널 탭으로 간다", async () => {
    const views: string[] = [];
    const onSet = (e: Event) => views.push((e as CustomEvent<string>).detail);
    window.addEventListener(NAV_BUS.setView, onSet);
    await runPromptInTerminal(1, "다음 항목을 잡아");
    window.removeEventListener(NAV_BUS.setView, onSet);
    expect(store.opened).toEqual(["다음 항목을 잡아"]);
    expect(views).toEqual(["terminal"]);
  });
});
