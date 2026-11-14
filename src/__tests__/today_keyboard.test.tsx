// 오늘 — 키보드가 끊기지 않는다 (11-15 TD-03).
//
// 한 글자 키는 `readChord(e).key` 로 읽는다 — 두벌식 자판에서 j 가 ㅓ 로 와도 셸 레인의 `readChord` 가 라틴
// 글자로 되찾는다(여기서는 그 약속을 모의로 세운다). v · r · ↩ 는 포커스가 행 안일 때만 듣고, 행이 빠지면
// 같은 자리(없으면 앞) 행으로 포커스를 옮겨 v 를 연달아 누르는 흐름이 첫 v 에서 끊기지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

vi.mock("@/lib/bindings", async () => (await import("./todayFixture")).bindingsMock());
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));
// 두벌식의 ㅓ 는 셸 레인의 readChord 가 j 로 되돌린다 — 그 약속만 세운다.
vi.mock("@/lib/kbd", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/kbd")>();
  return {
    ...real,
    readChord: (e: Parameters<typeof real.readChord>[0], family?: "app" | "terminal") => {
      const c = real.readChord(e, family);
      return e.code === "KeyJ" ? { ...c, key: "j" } : c;
    },
  };
});

import { __resetTodayStoreForTests } from "@/features/today/useTodayExceptions";
import { t } from "@/i18n";
import { buildShortcutGroups } from "@/lib/shortcutRegistry";
import { entry, fx, resetFx } from "./todayFixture";
import { renderToday } from "./todayRender";

const unreadCard = () => screen.getByRole("region", { name: t("today.unread.title") });
const rowsOf = (card: HTMLElement) => within(card).getAllByRole("listitem");
const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } } as const;
const summarize = (r: AxeResults) => r.violations.map((v: Result) => ({ id: v.id, nodes: v.nodes.length }));

beforeEach(() => {
  resetFx();
  fx.entries = [1, 2, 3].map((i) => entry(i, { type: "bug", evidence: 0, title: `unread ${i}` }));
});
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
});

async function mount() {
  const utils = renderToday();
  await waitFor(() => expect(rowsOf(unreadCard())).toHaveLength(3));
  return { ...utils, root: utils.container.querySelector(".page.tdy") as HTMLElement };
}

describe("moving between rows", () => {
  it("j from the screen enters the list, j / k / arrows walk it, Home · End jump, Esc leaves", async () => {
    const { root } = await mount();
    const rows = rowsOf(unreadCard());
    fireEvent.keyDown(root, { key: "j" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: "j" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(rows[2], { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: "Home" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: "End" });
    expect(document.activeElement).toBe(rows[2]);
    // 지금 행은 옅게 표시된다 — 하나만.
    expect(document.querySelectorAll(".tdy-row[data-active]")).toHaveLength(1);
    fireEvent.keyDown(rows[2], { key: "Escape" });
    expect(document.activeElement).toBe(root);
  });

  it("reads the key through readChord — a Korean-layout ㅓ (the j key) moves too", async () => {
    const { root } = await mount();
    fireEvent.keyDown(root, { key: "ㅓ", code: "KeyJ" });
    expect(document.activeElement).toBe(rowsOf(unreadCard())[0]);
  });

  it("arrow keys on the screen itself are left to scrolling", async () => {
    const { root } = await mount();
    root.focus();
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(document.activeElement).toBe(root);
  });
});

describe("v · r · Enter act only inside a row", () => {
  it("v with the screen focused does not mark the row it just left read", async () => {
    const { root } = await mount();
    // 먼저 목록에 들어가 「지금 행」 을 만든 뒤 나온다 — 그 행이 보이지 않는 대상이 되던 것이 결함이었다.
    fireEvent.keyDown(root, { key: "j" });
    const first = rowsOf(unreadCard())[0];
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Escape" });
    expect(document.activeElement).toBe(root);
    fireEvent.keyDown(root, { key: "v" });
    await new Promise((r) => setTimeout(r, 30));
    expect(fx.verifyCalls).toEqual([]);
    expect(rowsOf(unreadCard())).toHaveLength(3);
  });

  it("after v the focus moves to the row that took its place, so j keeps going (not to body)", async () => {
    const { root } = await mount();
    const [a, b, c] = rowsOf(unreadCard());
    fireEvent.keyDown(root, { key: "j" });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a, { key: "v" });
    await waitFor(() => expect(rowsOf(unreadCard())).toHaveLength(2));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: "j" });
    expect(document.activeElement).toBe(c);
    await waitFor(() => expect(fx.verifyCalls).toEqual([[fx.entries[0].relative_path, true]]));
  });

  it("Enter on a question row goes to its answer box", async () => {
    fx.questions = [{ id: "q1", question: "ship it?", options: ["yes"], asked_at: new Date().toISOString() }];
    const { root } = await mount();
    fireEvent.keyDown(root, { key: "j" });
    const row = document.activeElement as HTMLElement;
    expect(row.dataset.kind).toBe("question");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(document.activeElement).toBe(within(row).getByRole("textbox", { name: t("today.check.answerPlaceholder") }));
  });
});

describe("the focus never falls to body when what held it goes away", () => {
  it("after 'mark all read' the focus lands on the row that is left", async () => {
    fx.unrecorded = ["src/a.ts"];
    const { root } = await mount();
    const all = within(unreadCard()).getByRole("button", { name: t("today.unread.allRead") });
    all.focus();
    fireEvent.click(all);
    await waitFor(() => expect(screen.queryByRole("region", { name: t("today.unread.title") })).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByRole("region", { name: t("today.check.title") }).querySelector("[data-row]"));
    expect(root.contains(document.activeElement)).toBe(true);
  });

  it("a row's own 'read' button lands on the row that took its place — not the top of the list", async () => {
    await mount();
    const [, second, third] = rowsOf(unreadCard());
    const read = within(second).getByRole("button", { name: t("today.check.verifyAria", { title: "unread 2" }) });
    read.focus();
    fireEvent.click(read);
    await waitFor(() => expect(rowsOf(unreadCard())).toHaveLength(2));
    expect(document.activeElement).toBe(third);
  });

  it("'N more' turns into 'show fewer' in place — the focus stays on it, and it folds back", async () => {
    fx.entries = Array.from({ length: 7 }, (_, i) => entry(i + 1, { type: "bug", evidence: 0, title: `unread ${i + 1}` }));
    renderToday();
    await waitFor(() => expect(rowsOf(unreadCard())).toHaveLength(5));
    const more = within(unreadCard()).getByRole("button", { name: t("today.unread.more", { n: 2 }) });
    more.focus();
    fireEvent.click(more);
    expect(rowsOf(unreadCard())).toHaveLength(7);
    expect(document.activeElement).toBe(more);
    expect(more).toHaveTextContent(t("today.unread.less"));
    expect(more).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(more);
    expect(rowsOf(unreadCard())).toHaveLength(5);
  });
});

describe("the cheatsheet knows Today's keys", () => {
  it("lists a Today group with the keys this screen listens to", () => {
    const group = buildShortcutGroups().find((g) => g.id === "today");
    expect(group?.titleKey).toBe("keys.todayGroup");
    expect(group?.rows.map((r) => r.keys)).toEqual(["j / k", "↑ / ↓", "Home / End", "↩", "v", "r", "Esc"]);
  });

  it("has no axe violations with the rows and the keyboard hints", async () => {
    const { container } = await mount();
    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });
});
