// 오늘 — 질문은 편지처럼 · 채운 단추 하나 · 굵기 세 단계 (11-15 TD-04).
//
// 앱 안에서 Claude 의 질문을 읽고 답하는 곳은 여기뿐인데 한 줄로 잘렸고, 「보내기」 는 늘 45% 흐린 채운
// 단추라 「터미널에서 실행」 과 채운 단추가 둘이었다(영수증 규칙 3). 가장 급한 질문이 가장 가벼운 글자였다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/bindings", async () => (await import("./todayFixture")).bindingsMock());
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));

import { __resetTodayStoreForTests } from "@/features/today/useTodayExceptions";
import { t } from "@/i18n";
import { digest, fx, plan, resetFx } from "./todayFixture";
import { renderToday } from "./todayRender";

const css = readFileSync(join(__dirname, "..", "features", "today", "today.css"), "utf8");
const LONG = "Should the v4.11.0 release notes mention folding journals of removed code, or should that wait for the next version so the notes stay short?";

beforeEach(() => {
  resetFx();
  fx.questions = [{ id: "q1", question: LONG, options: ["Put it in this release", "Next version"], asked_at: new Date().toISOString() }];
  fx.digest = digest({ plans: [plan("a", { next: { plan_id: "a", plan_title: "plan a", item_id: "ship", title: "ship it", status: "todo" } })] });
});
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
});

async function questionRow() {
  renderToday();
  return (await screen.findByText(LONG)).closest("li") as HTMLElement;
}

describe("a question reads like a letter", () => {
  it("wraps the whole question instead of cutting it, and its content runs into the action column", async () => {
    const row = await questionRow();
    expect(row.dataset.kind).toBe("question");
    const title = within(row).getByText(LONG);
    expect(title.classList.contains("tdy-wrap")).toBe(true);
    expect(title.getAttribute("title")).toBeNull();
    expect(css).toMatch(/\.tdy-rows\.is-ex > \.tdy-row\[data-kind="question"\] > \.tdy-row-t \{ grid-column: 2 \/ -1; \}/);
    expect(css).toMatch(/\.tdy-row \.tdy-wrap \{[^}]*white-space: normal;[^}]*text-wrap: pretty/);
    // 고를 답이 길면 단추 안에서 줄을 바꾼다 — 단추가 칸 밖으로 나가지 않게.
    expect(css).toMatch(/\.tdy-option \{[^}]*max-width: 100%;[^}]*white-space: normal;[^}]*text-align: start/);
    expect(css).toMatch(/\.tdy-rows\.is-ex > \.tdy-row > \.chip \{[^}]*align-self: start/);
  });
});

describe("one filled button on the screen", () => {
  it("shows only a return hint while the answer box is empty, and a regular send button once typed", async () => {
    const row = await questionRow();
    expect(within(row).queryByRole("button", { name: t("send.submit") })).toBeNull();
    expect(row.querySelector(".tdy-answer-hint")?.textContent).toBe("↩");
    fireEvent.change(within(row).getByRole("textbox"), { target: { value: "later" } });
    const send = within(row).getByRole("button", { name: t("send.submit") });
    expect(send.classList.contains("primary")).toBe(false);
    expect(row.querySelector(".tdy-answer-hint")).toBeNull();
  });

  it("keeps exactly one .btn.primary on the whole screen — Run in terminal", async () => {
    const row = await questionRow();
    fireEvent.change(within(row).getByRole("textbox"), { target: { value: "later" } });
    const primaries = document.querySelectorAll(".btn.primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toContain(t("today.nextUp.run"));
  });

  it("clears the box after sending and says when it was sent", async () => {
    const row = await questionRow();
    const box = within(row).getByRole("textbox") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "next version please" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("");
    await waitFor(() => expect(fx.answers).toEqual([["q1", "next version please"]]));
    await waitFor(() => expect(row.querySelector(".tdy-sent")?.textContent).toContain(t("today.check.sent")));
    expect(row.querySelector(".tdy-sent .mono")?.textContent).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("three weights", () => {
  it("card heads are small and grey, row titles take the label weight, meta stays body weight", () => {
    expect(css).toMatch(/\.tdy-ch h2 \{[^}]*font-size: var\(--fs-3\);[^}]*font-weight: var\(--fw-strong\);[^}]*color: var\(--text-2\)/);
    expect(css).toMatch(/\.tdy-row-title \{[^}]*font-weight: var\(--fw-label\)/);
    expect(css).toMatch(/\.tdy-meta \{[^}]*font-weight: var\(--fw-body\)/);
    expect(css).toMatch(/\.tdy-grp b \{[^}]*font-weight: var\(--fw-label\)/);
  });

  it("gives cut row titles and meta lines a tooltip with the full text", async () => {
    fx.questions = [];
    fx.unrecorded = ["src/a.ts", "src/b.ts", "src/c.ts"];
    renderToday();
    const title = await screen.findByText(t("today.check.unrecordedTitle", { n: 3 }));
    expect(title.getAttribute("title")).toBe(t("today.check.unrecordedTitle", { n: 3 }));
    expect((title.nextElementSibling as HTMLElement).title).toBe("src/a.ts\nsrc/b.ts\nsrc/c.ts");
  });
});
