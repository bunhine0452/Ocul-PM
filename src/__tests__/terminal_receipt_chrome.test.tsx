// Terminal chrome after the final review — one meaning, one look (receipt rules 1 and 4):
//   RC-12 · V-05  the picked tab and the picked pane head are a grey surface like every other "picked" row, not an
//                 accent underline that stood even with one session and focus elsewhere;
//   V-02          the grid sits centred: left and right gaps differ by 8px or less (it was 14px with Claude's box);
//   RC-13         the empty screen's buttons are the same 30px size as the journal and plan empty screens;
//   RC-18         key labels inside buttons stay out of the accessible name (aria-hidden + aria-keyshortcuts);
//   RC-15         the find hint reads "not in the scrollback, so only what is on screen", not "seems missing".
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
/** The declarations of one rule, by its exact selector. */
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
  // Real numbers from the stylesheets: the host's insets (tokens), the scrollbar width xterm leaves free, and the
  // half-remainder that `termSize.afterFit` moves to the left. Claude's box leaves its last column empty.
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
    const cell = 7.8; // D2Coding at the default 13px
    const usable = pane - left - right - scrollbar;
    const cols = Math.floor(usable / cell);
    const shift = Math.floor((usable - cols * cell) / 2);
    const leftGap = left + shift;
    const rightGap = pane - (left + shift + cols * cell);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(8);
    expect(Math.abs(leftGap - (rightGap + cell))).toBeLessThanOrEqual(8);
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
      expect(value, key).toMatch(/없어서 지금 보이는 화면만/); // i18n-ignore -- the wording under test, not a display string
      expect(value, key).not.toMatch(/없어 보이는/); // i18n-ignore -- the misreading the review found
    }
  });
});
