// 오늘 — 좁은 창 · 빈 상태 · 낱말 (11-15 TD-07).
//
// 칩이 「Claude 가 기다려요」 같은 문장이라 좁은 창에서 제목 칸이 가장 먼저 짓눌렸고, 빈 상태는 날짜 줄도
// 없는 820px 카드 한 장이라 덜 만든 화면처럼 보였다. 「기록」 · 「변경」 이 한 화면에서 두 뜻이었다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/bindings", async () => (await import("./todayFixture")).bindingsMock());
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));

import { __resetTodayStoreForTests } from "@/features/today/useTodayExceptions";
import { t } from "@/i18n";
import { en } from "@/i18n/en";
import { ko } from "@/i18n/ko";
import { digest, entry, fx, plan, resetFx } from "./todayFixture";
import { DATE_LABEL, renderToday } from "./todayRender";

const css = readFileSync(join(__dirname, "..", "features", "today", "today.css"), "utf8");
const failed = (summary: string) => ({ passed: false, summary, ts: new Date().toISOString(), agent_id: "claude-code", item_id: "x" });
const passed = { passed: true, summary: "12 passed", ts: new Date().toISOString(), agent_id: "claude-code", item_id: "x" };

beforeEach(() => resetFx());
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
});

describe("the empty day uses the busy day's frame", () => {
  it("has the date line and the same body width class as a busy day", async () => {
    fx.total = 0;
    const empty = renderToday();
    await screen.findByRole("region", { name: t("today.first.title") });
    expect(empty.container.querySelector(".tdy-day .tdy-date")?.textContent).toBe(DATE_LABEL);
    const emptyBody = (empty.container.querySelector(".tdy-body") as HTMLElement).className;
    expect(empty.container.querySelector(".tdy-side")).not.toBeNull();
    cleanup();
    __resetTodayStoreForTests();
    fx.total = 10;
    fx.entries = [entry(1), entry(2)];
    const busy = renderToday();
    await screen.findByRole("region", { name: t("today.work.title") });
    expect((busy.container.querySelector(".tdy-body") as HTMLElement).className).toBe(emptyBody);
  });

  it("shows three steps to the first entry; the connect step has a link, not a filled button (11-23)", async () => {
    fx.total = 0;
    fx.plugin = null;
    const { container, onNavigate } = renderToday();
    await screen.findByRole("region", { name: t("today.first.title") });
    expect(container.querySelectorAll(".tdy-step")).toHaveLength(3);
    expect(container.querySelectorAll(".btn.primary")).toHaveLength(0);
    expect(screen.getByText(t("today.first.step1Body"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("today.first.connect") }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
    // 볼 것이 없으면 먼저 볼 것 카드는 서지 않는다 — 세 걸음이 대신 말한다.
    expect(screen.queryByRole("region", { name: t("today.check.title") })).toBeNull();
  });

  it("greys a finished step with a check and moves the filled button to the next one", async () => {
    fx.total = 0;
    const { container } = renderToday();
    await waitFor(() => expect(container.querySelector(".tdy-step[data-done]")).not.toBeNull());
    const steps = [...container.querySelectorAll<HTMLElement>(".tdy-step")];
    expect(steps[0].querySelector(".tdy-step-mark")?.textContent).toBe("✓");
    expect(steps[0].querySelector(".btn")).toBeNull();
    expect(steps[1].querySelector(".btn.primary")?.textContent).toBe(t("today.first.step2Run"));
    expect(container.querySelectorAll(".btn.primary")).toHaveLength(1);
  });
});

describe("chips are short state names", () => {
  // 낱말 사이 공백은 세지 않는다 — 「일지 없음」 · 「다른 기기」 는 두 낱말 넉 자다(공백 포함 다섯 칸).
  it("every chip on a full screen is at most four letters in Korean, spaces not counted", async () => {
    const since = new Date().toISOString();
    fx.questions = [{ id: "q1", question: "ship?", options: [], asked_at: since }];
    fx.terms = [{ id: 3, project_id: 1, label: "claude", started_at: since, alive: true, exit_code: null, busy: true, status: { state: "blocked", kind: "permission", msg: "approve Bash", since } }];
    fx.digest = digest({
      plans: [
        plan("f", { last_verdict: failed("1 failed") }),
        plan("s", { last_verdict: passed, stale_files: ["src/a.ts"] }),
        plan("e", { last_verdict: passed, verdict_from: "mac" }),
        plan("n", { next: { plan_id: "n", plan_title: "plan n", item_id: "go", title: "go", status: "todo" } }),
      ],
      blocked: [{ plan_id: "b", plan_title: "plan b", item_id: "hook", title: "hook", status: "blocked" }],
    });
    fx.unrecorded = ["src/x.ts"];
    fx.missing = [{ ts: since, session_id: "conv-1", segments: 1 }];
    fx.plugin = { state: "connected", ahead: false, other_behind: 0, app_reachable: true, installed: true, behind: true, installed_version: "3.0.0", bundled_version: "4.0.0", path: "/p", scope: "user" };
    const { container } = renderToday();
    await waitFor(() => expect(container.querySelectorAll(".tdy-rows .chip")).toHaveLength(10));
    const chips = [...container.querySelectorAll(".tdy-rows .chip")].map((c) => c.textContent ?? "");
    expect(chips.filter((c) => c.replace(/\s/g, "").length > 4)).toEqual([]);
  });
});

describe("words", () => {
  it("drops 'remote' from Korean and 'Look first' from English", () => {
    const koHits = Object.entries(ko).filter(([, v]) => v.includes("리모트")); // i18n-ignore -- 금지어 검사 재료
    const enHits = Object.entries(en).filter(([, v]) => v.includes("Look first"));
    expect(koHits.map(([k]) => k)).toEqual([]);
    expect(enHits.map(([k]) => k)).toEqual([]);
  });

  it("uses 'record' only for journals — the local-only tooltip names files and journal/plan files", () => {
    expect(t("today.local.files", { n: 44, r: 4 })).toBe(ko["today.local.files"].replace("{n}", "44").replace("{r}", "4"));
    expect(en["today.local.files"]).toContain("journal or plan files");
    expect(en["today.check.title"]).toBe("Needs your eyes");
    expect(en["today.mine.line"]).toBe("Your turn: {n} {n|item|items} in {p} {p|plan|plans}");
    expect(en["today.arrived.line"]).toBe("{n} {n|entry|entries} from other machines today");
  });
});

describe("the narrow window", () => {
  it("folds rows into two lines at 640 — the action drops under the title line — with 16px sides", () => {
    const narrow = css.slice(css.indexOf("@container screen (max-width: 640px)"));
    expect(narrow).toMatch(/:is\(\.btn, \.tdy-acts\) \{ grid-column: 2 \/ -1; grid-row: 2; justify-self: start; \}/);
    expect(narrow).toMatch(/\.tdy-body \{ margin-inline: calc\(var\(--space-6\) - var\(--space-8\)\); \}/);
    // 접힘 선은 한 벌(640 · 460) — 세 번째 숫자를 고르지 않는다.
    expect([...css.matchAll(/@container screen \(max-width: (\d+)px\)/g)].map((m) => m[1]).sort()).toEqual(["460", "640"]);
  });
});
