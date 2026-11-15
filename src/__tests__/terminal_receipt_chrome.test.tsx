// 최종 검수 뒤의 터미널 크롬 — 같은 뜻은 같은 모양 (영수증 규칙 1 · 4):
//   RC-12 · V-05  고른 탭 · 고른 칸 머리는 다른 「고른」 줄처럼 회색 면이다. 강조색 아랫선이던 때는 세션이 하나여도,
//                 포커스가 딴 데 있어도 초록 선이 서 있었다.
//   V-02          격자가 가운데 선다 — 좌우 여백 차 8px 이하(Claude 상자에서 14px 였다). 나눈 칸의 경계선은 왼쪽 칸의
//                 스크롤바를 덮지 않는다.
//   RC-13         빈 화면의 단추는 일지 · 계획 빈 화면과 같은 30px 다.
//   RC-18         단추 안의 키 표기는 접근명 밖이다(aria-hidden + aria-keyshortcuts).
//   RC-15         찾기 안내는 「스크롤백에 없어서 지금 보이는 화면만」 으로 읽힌다(「없어 보이는」 이 아니라).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  hasWorked: () => false,
  closeTerm: (id: number) => store.set(store.list.filter((s) => s.id !== id)),
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: { list: async () => store.list, onSessionsChanged: async () => () => {} },
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
import { ko } from "@/i18n/ko";
import { TerminalScreen, __resetTermLayoutForTests } from "@/features/terminal/TerminalScreen";
import { TermToolbar } from "@/features/terminal/TermToolbar";

const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");
const css = read("features", "terminal", "terminal.css");
/** 선택자가 꼭 같은 규칙 하나의 선언들. */
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
};

function info(id: number, label: string, extra: Partial<TermInfo> = {}): TermInfo {
  return {
    id,
    project_id: 1,
    label,
    started_at: "2026-11-15T10:00:00Z",
    alive: true,
    exit_code: null,
    status: null,
    busy: false,
    unseen: false,
    ...extra,
  };
}

beforeEach(() => {
  __resetTermLayoutForTests();
  store.set([]);
});
afterEach(() => cleanup());

describe("picked is grey, not accent (RC-12 · V-05)", () => {
  it("the picked tab is the grey surface of the top bar's picked tab, with no underline", () => {
    expect(rule(".tm-tab.is-active")).toMatch(/background: var\(--bg-active\)/);
    expect(css).not.toMatch(/\.tm-tab\.is-active::after/);
    const topbar = read("styles", "shell.css");
    expect(topbar).toMatch(/\.topnav-item\.active \{ background: var\(--bg-active\)/);
  });

  it("no picked tab or pane head uses the accent colour", () => {
    expect(rule(".tm-leaf.is-active .tm-pane-head")).toMatch(/var\(--bg-active\)/);
    for (const m of css.matchAll(/([^{}]*is-active[^{}]*)\{([^}]*)\}/g)) {
      expect(m[2], m[1].trim()).not.toMatch(/--accent/);
    }
  });
});

describe("the grid is centred (V-02)", () => {
  // 스타일시트의 실제 값으로 잰다: 터미널 칸의 여백(토큰), xterm 이 비워 두는 스크롤바 폭, `termSize.afterFit` 이
  // 왼쪽으로 옮기는 자투리의 반. Claude 상자는 마지막 칸을 비운다.
  const tokens = read("styles", "tokens.css");
  const space = (v: string) => {
    if (v === "0") return 0;
    const name = /--space-\d+/.exec(v)?.[0];
    return Number(new RegExp(`${name}: (\\d+)px`).exec(tokens)?.[1]);
  };
  const [top, right, , left] = (/inset: ([^;]+);/.exec(rule(".term-host"))?.[1] ?? "").split(/\s+/).map(space);
  const scrollbar = Number(/::-webkit-scrollbar \{ width: (\d+)px/.exec(read("styles", "base.css"))?.[1]);

  it.each([1440, 960, 520])("pane %ipx: left and right gaps differ by 8px or less", (pane) => {
    expect([top, right, left, scrollbar].every(Number.isFinite)).toBe(true);
    const cell = 7.8; // 기본 13px 의 D2Coding
    const usable = pane - left - right - scrollbar;
    const cols = Math.floor(usable / cell);
    const shift = Math.floor((usable - cols * cell) / 2);
    const leftGap = left + shift;
    const rightGap = pane - (left + shift + cols * cell);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(8);
    expect(Math.abs(leftGap - (rightGap + cell))).toBeLessThanOrEqual(8);
  });

  it("the split divider's grab area stays off the left pane's scrollbar, still 7px wide", () => {
    // 왼쪽 칸의 스크롤바는 칸 끝(오른쪽 여백 `right`)에 붙는다 — 경계선이 왼쪽 칸으로 넘어가는 폭(-margin-left)이 그
    // 여백보다 크면 스크롤바 끝을 끌 때 칸 크기가 바뀌었다. CSS 줄임: 값 1 · 2 · 3 · 4개가 (위, 오른, 아래, 왼)으로 펴진다.
    const divider = rule(".tm-node.is-row > .tm-divider");
    const sides = (prop: string) => {
      const v = new RegExp(`${prop}: ([^;]+);`).exec(divider)?.[1].trim().split(/\s+/) ?? [];
      return [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]].map(parseFloat);
    };
    expect(-sides("margin")[3]).toBeLessThanOrEqual(right);
    const border = sides("border-width");
    expect(1 + border[1] + border[3]).toBe(7);
  });
});

describe("the empty screen's buttons (RC-13 · RC-18)", () => {
  it("are the regular 30px size, and the key label stays out of the button's name", async () => {
    store.set([info(3, "zsh", { alive: false, exit_code: 0 })]);
    const { container } = render(<TerminalScreen projectId={1} workday={null} />);
    const band = screen.getByRole("status");
    fireEvent.click(within(band).getByRole("button", { name: t("terminal.closeAria", { name: "1 zsh" }) }));
    await screen.findByText(t("terminal.empty"));
    const empty = container.querySelector(".tm-empty-state")!;
    const buttons = [...empty.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.className.split(" ")).not.toContain("sm");
    const add = within(empty as HTMLElement).getByRole("button", { name: t("terminal.new") });
    expect(add).toHaveAttribute("aria-keyshortcuts", "Meta+T Control+Shift+T");
    expect(add.querySelector("kbd")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("toolbar key labels (RC-18)", () => {
  const props = {
    hasSessions: true,
    count: 1,
    zoomed: false,
    roomFor: () => true,
    onNew: vi.fn(),
    onSplit: vi.fn(),
    onUnsplit: vi.fn(),
    onRace: vi.fn(),
    onFind: vi.fn(),
    onZoom: vi.fn(),
  };

  it("every key label in a button or menu item is hidden from the name and announced as a shortcut", () => {
    const { container } = render(<TermToolbar {...props} />);
    expect(screen.getByRole("button", { name: t("terminal.new") })).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+T Control+Shift+T",
    );
    fireEvent.click(screen.getByRole("button", { name: t("terminal.newMenu") }));
    const menu = screen.getByRole("menu", { name: t("terminal.newMenu") });
    expect(within(menu).getByRole("menuitem", { name: t("terminal.splitRight") })).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+D Control+Shift+D",
    );
    expect(within(menu).getByRole("menuitem", { name: t("terminal.splitDown") })).toHaveAttribute(
      "aria-keyshortcuts",
      "Shift+Meta+D Control+Alt+Shift+D",
    );
    const kbds = [...container.querySelectorAll("kbd"), ...menu.querySelectorAll("kbd")];
    expect(kbds.length).toBeGreaterThanOrEqual(4);
    for (const k of kbds) {
      expect(k, k.textContent ?? "").toHaveAttribute("aria-hidden", "true");
      expect(k.closest("button")?.getAttribute("aria-keyshortcuts"), k.textContent ?? "").toBeTruthy();
    }
  });
});

describe("the find hint (RC-15)", () => {
  it("says the conversation is not in the scrollback, so only the visible screen is searched", () => {
    for (const key of ["terminal.find.altClaude", "terminal.find.altOther"] as const) {
      const value = ko[key];
      expect(value, key).toMatch(/없어서 지금 보이는 화면만/); // i18n-ignore -- 검사하는 문구, 표시 문자열이 아니다
      expect(value, key).not.toMatch(/없어 보이는/); // i18n-ignore -- 검수가 찾은 잘못 읽히는 이음
    }
  });
});
