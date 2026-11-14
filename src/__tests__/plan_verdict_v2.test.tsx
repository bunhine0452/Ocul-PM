import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DigestPlan } from "@/lib/bindings";

// JN-05 (11-15) — the plan's verdict card: the whole last line shows, the check command never breaks inside a
// word, and the planner speaks the same four states as Today (pass · fail · changed after pass · not here yet).
// Both read the same backend fields (`stale_files` · `verdict_from`, computed by `digest::mark_stale`).

vi.mock("@/lib/bindings", async () => (await import("./plannerHarness")).plannerBindings());
vi.mock("@/features/terminal/runPrompt", async () => (await import("./plannerHarness")).runPromptModule());

import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { checkLines, railSummary, verdictStateOf } from "@/features/planner/verdictState";
import { buildExceptions } from "@/features/today/todayModel";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";
import { detail, item, pfx, plan, resetPlanFixtures, stage, verdict } from "./plannerHarness";

const css = readFileSync(join(__dirname, "..", "features", "planner", "planner.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

function renderPlanner() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <PlannerScreenV2 projectId={1} onNavigate={vi.fn()} onOpenJournal={vi.fn()} />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => {
  resetPlanFixtures();
});
afterEach(() => cleanup());

describe("verdict states — the same four as Today", () => {
  const digestPlan = (id: string, over: Partial<DigestPlan>): DigestPlan => ({
    plan_id: id,
    title: id,
    progress: 0.5,
    done_count: 1,
    item_count: 2,
    closable: false,
    updated_at: "2026-11-01",
    done_when: null,
    check: null,
    last_verdict: verdict(),
    stale_files: [],
    verdict_from: null,
    next: null,
    ...over,
  });
  const cases = {
    pass: digestPlan("p", {}),
    fail: digestPlan("f", { last_verdict: verdict({ passed: false, summary: "2 failed" }) }),
    stale: digestPlan("s", { stale_files: ["src/a.ts"] }),
    away: digestPlan("a", { verdict_from: "windows" }),
  } as const;

  it("todayModel and verdictStateOf agree on every case of the same fixture", () => {
    const rows = buildExceptions({
      entries: [],
      digest: { plans: Object.values(cases), needs_user: [], blocked: [], journal_plan: [] },
      unrecorded: null,
      silent: null,
      plugin: null,
    });
    const todayState = (id: string) => {
      const kind = rows.find((r) => "plan" in r && r.plan.plan_id === id)?.kind;
      return kind === "verdict" ? "fail" : kind === "stale" ? "stale" : kind === "elsewhere" ? "away" : "pass";
    };
    for (const [state, p] of Object.entries(cases)) {
      expect(verdictStateOf(p)).toBe(state);
      expect(todayState(p.plan_id)).toBe(state);
      // 계획 화면은 PlanSummary 를 넘긴다 — 같은 칸 이름이라 그대로 같은 답이다.
      expect(verdictStateOf(plan(p.plan_id, { last_verdict: p.last_verdict, stale_files: p.stale_files, verdict_from: p.verdict_from }))).toBe(state);
    }
    expect(verdictStateOf(plan("none"))).toBeNull();
  });

  it("the rail shows the state and only the first number of the last line", async () => {
    const stale = plan("stale", { title: "Stale plan", updated_at: "2026-11-03", last_verdict: verdict({ summary: "pnpm test 1117 passed · cargo test" }), stale_files: ["src/a.ts"] });
    const away = plan("away", { title: "Away plan", updated_at: "2026-11-02", verdict_from: "windows", last_verdict: verdict() });
    stage([detail(stale, [item("a", "done", 0)]), detail(away, [item("b", "done", 0)])]);
    renderPlanner();
    const rail = await screen.findByRole("navigation", { name: t("plan.list.aria") });
    const rowStale = within(rail).getByRole("button", { name: /Stale plan/ });
    await waitFor(() => expect(rowStale.querySelector(".vl.is-stale")).not.toBeNull());
    expect(rowStale.querySelector(".vl-out")?.textContent).toContain("1117 passed");
    expect(rowStale.querySelector(".vl-out")?.textContent).not.toContain("pnpm");
    expect(within(rail).getByRole("button", { name: /Away plan/ }).querySelector(".vl.is-away")).not.toBeNull();
    expect(railSummary("ok")).toBe("ok");
  });
});

describe("verdict card — nothing cut", () => {
  const check = "pnpm typecheck && pnpm test && cd src-tauri && cargo test --locked";
  const summary = "pnpm test 1117 passed · cargo test 1168 passed 0 failed · typecheck/lint/build exit 0 · install not eyeballed yet";

  it("the check command breaks only after && — cargo stays whole on one line", async () => {
    const p = plan("c", { last_verdict: verdict({ summary }) });
    stage([detail(p, [item("a", "done", 0)], { check })]);
    const { container } = renderPlanner();
    await screen.findByRole("region", { name: t("plan.judge.aria") });
    const lines = container.querySelector(".plv-code")!.textContent!.split("\n");
    expect(lines).toEqual(checkLines(check));
    expect(lines).toContain("cargo test --locked");
    expect(css).toMatch(/\.plv-code\s*\{[^}]*word-break:\s*normal/);
    expect(css).not.toMatch(/break-all/);
  });

  it("the last result keeps its whole line in the DOM and wraps instead of clipping", async () => {
    const p = plan("c", { last_verdict: verdict({ summary }) });
    stage([detail(p, [item("a", "done", 0)], { check })]);
    const { container } = renderPlanner();
    await screen.findByRole("region", { name: t("plan.judge.aria") });
    expect(container.querySelector(".plv-judge-last .vl-out")?.textContent).toContain(summary);
    expect(css).toMatch(/\.plv-judge-last \.vl-out\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow:\s*visible/);
  });

  it("a passing plan with nothing left says it passed; a failing one says the check must pass first", async () => {
    const ok = plan("ok", { title: "Passing", last_verdict: verdict(), updated_at: "2026-11-03" });
    const bad = plan("bad", { title: "Failing", last_verdict: verdict({ passed: false, summary: "2 failed" }), updated_at: "2026-11-02" });
    stage([detail(ok, [item("a", "done", 0)]), detail(bad, [item("b", "done", 0)])]);
    const { container } = renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Passing" });
    await waitFor(() => expect(container.querySelector(".plv-next")?.textContent).toContain(t("plan.nextRow.allClosedPassed")));
    expect(container.querySelector(".plv-next-label")?.textContent).toBe(t("plan.nextRow.doneLabel"));
    within(screen.getByRole("navigation", { name: t("plan.list.aria") })).getByRole("button", { name: /Failing/ }).click();
    await screen.findByRole("heading", { level: 2, name: "Failing" });
    await waitFor(() => expect(container.querySelector(".plv-next")?.textContent).toContain(t("plan.nextRow.allClosed")));
    expect(pfx.edits).toEqual([]);
  });
});
