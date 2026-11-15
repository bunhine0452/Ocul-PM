// 최종 검수 고침 (11-15 fix-screens) — 오늘 화면. 「올리기 맡기기」 는 수 줄 밖의 보통 단추(V-01), 「읽음 표시」 는
// 일지 · 변경과 같은 모양 · 같은 이름(V-06), 「계획별/시간순」 은 앱의 라디오 묶음(RC-19)이다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./todayFixture")).bindingsMock());
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));

import { TodayNumbers } from "@/features/today/TodaySide";
import { TodayWork } from "@/features/today/TodayWork";
import { __resetTodayStoreForTests } from "@/features/today/useTodayExceptions";
import { t } from "@/i18n";
import { ko } from "@/i18n/ko";
import type { TodayDigest } from "@/lib/bindings";
import { digest, entry, fx, resetFx } from "./todayFixture";
import { renderToday } from "./todayRender";

beforeEach(() => resetFx());
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
});

describe("V-01 — 'ask Claude to push' is an action outside the number line", () => {
  it("the numbers stay links that move screens; the hand-off is a normal button with the terminal icon after them", () => {
    const onHandOff = vi.fn();
    const { container } = render(
      <div className="tdy-day">
        <TodayNumbers
          mine={[]}
          plans={[]}
          arrived={null}
          local={{ uncommitted: 5, records: 2, unpushed: 3, unpushed_records: 1 }}
          now={Date.now()}
          opening={false}
          onOpenPlan={vi.fn()}
          onOpenEntry={vi.fn()}
          onOpenDiff={vi.fn()}
          onHandOff={onHandOff}
        />
      </div>,
    );
    const group = screen.getByRole("group", { name: t("today.nums.aria") });
    const handoff = screen.getByRole("button", { name: t("today.local.handoff") });
    expect(group.contains(handoff)).toBe(false);
    expect(group.textContent).not.toContain(t("today.local.handoff"));
    expect(handoff.className).toContain("btn");
    expect(handoff.className).toContain("sm");
    expect(handoff.querySelector("svg")).not.toBeNull();
    expect(handoff.closest(".tdy-day")).toBe(container.firstElementChild);
    // 수 줄의 단추는 화면을 옮기는 수뿐이다.
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([t("today.nums.local", { n: 3 })]);
    fireEvent.click(handoff);
    expect(onHandOff).toHaveBeenCalledTimes(1);
  });

  it("while the terminal opens the button says so and does not take a second press", () => {
    render(
      <TodayNumbers
        mine={[]}
        plans={[]}
        arrived={null}
        local={{ uncommitted: 0, records: 0, unpushed: 2, unpushed_records: 2 }}
        now={Date.now()}
        opening
        onOpenPlan={vi.fn()}
        onOpenEntry={vi.fn()}
        onOpenDiff={vi.fn()}
        onHandOff={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: t("today.busy.opening") })).toBeDisabled();
  });
});

describe("V-06 — 'mark read' looks and reads the same as in the journal and the diff", () => {
  it("a bordered small button 「mark read」 + v, no check mark before it is pressed", async () => {
    fx.entries = [entry(1, { type: "bug", evidence: 0, title: "solo" })];
    renderToday();
    const btn = await screen.findByRole("button", { name: t("today.check.verifyAria", { title: "solo" }) });
    expect(btn.className.split(" ")).toEqual(expect.arrayContaining(["btn", "sm"]));
    expect(btn.className).not.toContain("ghost");
    expect(btn.querySelector("svg")).toBeNull();
    expect(btn.querySelector(".kbd")?.textContent).toBe("v");
    expect(btn.textContent).toBe(`${t("entry.verify")}v`);
    // 오늘만 따로 갖던 낱말(「읽음」)은 걷었다 — 세 곳이 같은 키를 쓴다.
    expect("today.check.verify" in ko).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(fx.verifyCalls).toEqual([[fx.entries[0].relative_path, true]]));
  });
});

describe("RC-19 — 'by plan / by time' is the app's radio group", () => {
  it("a radiogroup with two radios (no pressed toggle buttons); arrows move the choice", () => {
    const entries = [entry(1), entry(2), entry(3)];
    const links = [{ journal_ref: entries[0].relative_path, plan_id: "a", plan_title: "plan a", item_id: "x" }];
    const d = digest({ journal_plan: links as unknown as TodayDigest["journal_plan"] });
    const { container } = render(<TodayWork entries={entries} digest={d} onOpenEntry={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: t("today.work.viewAria") });
    const byPlan = within(group).getByRole("radio", { name: t("today.work.byPlan") });
    const byTime = within(group).getByRole("radio", { name: t("today.work.byTime") });
    expect(byPlan).toHaveAttribute("aria-checked", "true");
    expect(byTime).toHaveAttribute("aria-checked", "false");
    expect(container.querySelector("[aria-pressed]")).toBeNull();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(within(group).getByRole("radio", { name: t("today.work.byTime") })).toHaveAttribute("aria-checked", "true");
    expect(container.querySelectorAll(".tdy-ent")).toHaveLength(3);
  });
});
