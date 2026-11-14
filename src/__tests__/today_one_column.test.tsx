// 오늘 — 한 기둥 · 숫자 한 줄 (11-15 TD-01).
//
// 「먼저 볼 것」 밖에 한 줄이 넷까지 쌓이던 것(내 차례 · 닫을 계획 · 받아 온 일지 · 이 기기에만)을 날짜 줄
// 오른쪽의 수 한 줄로, 따로 카드였던 「다음」 을 먼저 볼 것 목록의 마지막 행으로, 오른쪽 칸에 있던 「검증
// 없이 끝난 일지」 를 왼쪽 기둥으로(5행 + N건 더) 옮겼다. 날짜 줄의 「기록 N건」 은 오늘 한 일 머리와 같은
// 수를 두 번 말해 걷었다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./todayFixture")).bindingsMock());
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));

import { __resetTodayStoreForTests } from "@/features/today/useTodayExceptions";
import { t } from "@/i18n";
import { digest, entry, fx, plan, resetFx } from "./todayFixture";
import { DATE_LABEL, renderToday } from "./todayRender";

const checkCard = () => screen.getByRole("region", { name: t("today.check.title") });
const unreadCard = () => screen.getByRole("region", { name: t("today.unread.title") });
const NEXT = { plan_id: "a", plan_title: "plan a", item_id: "ship", title: "ship it", status: "todo" };

beforeEach(() => resetFx());
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
});

describe("one column on the left, only the day's work on the right", () => {
  it("puts the unverified journals under 'look first' in the main column, and only 'done today' in the side", async () => {
    fx.entries = [entry(1, { type: "bug", evidence: 0 }), entry(2)];
    fx.digest = digest({ plans: [plan("a", { next: NEXT })] });
    const { container } = renderToday();
    await waitFor(() => expect(unreadCard()).toBeInTheDocument());
    const main = container.querySelector(".tdy-main") as HTMLElement;
    const side = container.querySelector(".tdy-side") as HTMLElement;
    expect(within(main).getByRole("region", { name: t("today.unread.title") })).toBeInTheDocument();
    expect(within(main).getByRole("region", { name: t("today.check.title") })).toBeInTheDocument();
    expect(within(side).getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"))).toEqual(["tdy-work-h"]);
  });

  it("keeps the keyboard hint outside both columns, at the very end", async () => {
    fx.entries = [entry(1, { type: "bug", evidence: 0 })];
    const { container } = renderToday();
    await waitFor(() => expect(container.querySelector(".tdy-keys")).not.toBeNull());
    const hint = container.querySelector(".tdy-keys") as HTMLElement;
    expect(hint.closest(".tdy-cols")).toBeNull();
    expect(hint.previousElementSibling?.classList.contains("tdy-cols")).toBe(true);
  });
});

describe("the date line carries one line of numbers", () => {
  it("has no loose lines — one number line, each number a link, zeros left out", async () => {
    fx.digest = digest({
      plans: [plan("a"), plan("b", { closable: true })],
      needs_user: [
        { plan_id: "a", plan_title: "plan a", item_id: "x", title: "[user] tag", status: "todo" },
        { plan_id: "a", plan_title: "plan a", item_id: "y", title: "[user] call", status: "todo" },
      ],
    });
    fx.arrived = { journals: ["20261112/Bugs/b.md"], synced_at: 1 };
    fx.localOnly = { uncommitted: 12, records: 0, unpushed: 2 };
    const { container, onNavigate } = renderToday();
    const mine = await screen.findByRole("button", { name: t("today.nums.mine", { n: 2 }) });
    expect(container.querySelectorAll(".tdy-mine")).toHaveLength(0);
    expect(container.querySelectorAll(".tdy-nums")).toHaveLength(1);
    const nums = container.querySelector(".tdy-nums") as HTMLElement;
    expect(nums.closest(".tdy-day")).not.toBeNull();
    expect(within(nums).getAllByRole("button").map((b) => b.textContent)).toEqual([
      t("today.nums.mine", { n: 2 }),
      t("today.nums.closable", { n: 1 }),
      t("today.nums.arrived", { n: 1 }),
    ]);
    // 커밋 안 한 코드 · 안 올린 커밋만 있으면 「이 기기에만」 은 서지 않는다 — 일하는 내내 서 있던 줄이었다.
    expect(nums.textContent).not.toContain(t("today.nums.local", { n: 12 }));
    fireEvent.click(mine);
    expect(onNavigate).toHaveBeenCalledWith("planner");
  });

  it("drops the 'N records' count from the date line", async () => {
    fx.entries = [entry(1), entry(2), entry(3)];
    const { container } = renderToday();
    await screen.findByRole("region", { name: t("today.work.title") });
    const day = container.querySelector(".tdy-day") as HTMLElement;
    expect(day.textContent).toBe(DATE_LABEL);
    expect(day.querySelector("b")).toBeNull();
  });
});

describe("'next' is the last row of 'look first'", () => {
  it("stands in the same list, with a hairline chip, and is not counted in the badge", async () => {
    fx.unrecorded = ["src/a.ts"];
    fx.digest = digest({ plans: [plan("a", { next: NEXT })] });
    renderToday();
    await waitFor(() => expect(within(checkCard()).getAllByRole("listitem")).toHaveLength(2));
    const rows = within(checkCard()).getAllByRole("listitem");
    const last = rows[rows.length - 1];
    expect(last.dataset.kind).toBe("next");
    expect(last.querySelector(".chip.hairline")?.textContent).toBe(t("today.nextUp.title"));
    expect(within(last).getByRole("button", { name: t("today.nextUp.run") })).toBeInTheDocument();
    // 칩 칸은 한 목록(subgrid) — 「다음」 이 따로 카드가 아니다.
    expect(last.parentElement).toBe(rows[0].parentElement);
    expect(checkCard().querySelector(".tdy-cnt")?.textContent).toBe("1");
  });
});

describe("unverified journals: five rows, then a number", () => {
  it("shows 5 of 8 and says '3 more'; pressing it shows the rest", async () => {
    fx.entries = Array.from({ length: 8 }, (_, i) => entry(i + 1, { type: "bug", evidence: 0 }));
    renderToday();
    await waitFor(() => expect(within(unreadCard()).getAllByRole("listitem")).toHaveLength(5));
    expect(unreadCard().querySelector(".tdy-cnt")?.textContent).toBe("8");
    fireEvent.click(screen.getByRole("button", { name: t("today.unread.more", { n: 3 }) }));
    expect(within(unreadCard()).getAllByRole("listitem")).toHaveLength(8);
    expect(screen.queryByRole("button", { name: t("today.unread.more", { n: 3 }) })).toBeNull();
  });
});
