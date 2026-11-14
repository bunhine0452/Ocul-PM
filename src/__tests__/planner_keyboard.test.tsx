import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// JN-07 (11-15) — planner keys and item guidance. The planner had no shortcuts; the status menu was
// role=menu but moved no focus and dropped focus on body after a pick. Now: j/k between items, [ ] between
// plans, Enter opens the menu on the current status, 1–6 pick, focus returns to the box; r runs the next
// item. An in-progress row says who holds it and since when (held over 24h → warn chip); unreadable plan
// lines surface as a warn chip; finished boxes are grey, not accent.

vi.mock("@/lib/bindings", async () => (await import("./plannerHarness")).plannerBindings());
vi.mock("@/features/terminal/runPrompt", async () => (await import("./plannerHarness")).runPromptModule());

import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";
import { relativeTime } from "@/lib/format";
import { buildShortcutGroups } from "@/lib/shortcutRegistry";
import { detail, item, pfx, plan, resetPlanFixtures, stage } from "./plannerHarness";

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } } as const;
const summarize = (r: AxeResults) => r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));
const css = readFileSync(join(__dirname, "..", "features", "planner", "planner.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
const HOUR = 60 * 60 * 1000;

function renderPlanner() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <PlannerScreenV2 projectId={1} onNavigate={vi.fn()} onOpenJournal={vi.fn()} />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

const body = (c: HTMLElement) => c.querySelector(".plv-body") as HTMLElement;

beforeEach(() => {
  resetPlanFixtures();
});
afterEach(() => cleanup());

describe("planner keys", () => {
  const seed = () => {
    const p = plan("k", { title: "Keys plan" });
    stage([
      detail(p, [
        item("a", "todo", 0, { title: "Alpha", journal_refs: ["journal/x.md"] }),
        item("b", "in_progress", 1, { title: "Bravo", journal_refs: ["journal/y.md"] }),
      ]),
    ]);
  };

  it("j moves between items; Enter opens the menu on the current status; 3 picks done and focus returns", async () => {
    seed();
    const { container } = renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Keys plan" });
    body(container).focus();
    fireEvent.keyDown(body(container), { key: "j" });
    expect(document.activeElement?.getAttribute("aria-label")).toContain("Alpha");
    fireEvent.keyDown(document.activeElement!, { key: "j" });
    const trigger = document.activeElement as HTMLElement;
    expect(trigger.getAttribute("aria-label")).toContain("Bravo");
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-checked")).toBe("true"));
    expect(document.activeElement?.textContent).toContain(t("plan.status.in_progress"));
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain(t("plan.status.done"));
    fireEvent.keyDown(document.activeElement!, { key: "3" });
    await waitFor(() => expect(pfx.edits).toEqual([{ planId: "k", op: { kind: "set_status", item_id: "b", status: "done" } }]));
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("[ and ] switch plans in rail order; r runs the next item", async () => {
    const a = plan("a", { title: "First plan", updated_at: "2026-11-03" });
    const b = plan("b", { title: "Second plan", updated_at: "2026-11-02" });
    stage([detail(a, [item("x", "todo", 0, { title: "Next up" })]), detail(b, [item("y", "todo", 0)])]);
    const { container } = renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "First plan" });
    fireEvent.keyDown(body(container), { key: "r" });
    await waitFor(() => expect(pfx.dispatch).toEqual([["a", "x"]]));
    fireEvent.keyDown(body(container), { key: "]" });
    expect(await screen.findByRole("heading", { level: 2, name: "Second plan" })).toBeInTheDocument();
    fireEvent.keyDown(body(container), { key: "[" });
    expect(await screen.findByRole("heading", { level: 2, name: "First plan" })).toBeInTheDocument();
  });

  it("the cheatsheet lists the planner keys", () => {
    const g = buildShortcutGroups().find((x) => x.id === "plan")!;
    expect(g.rows.map((r) => r.keys)).toEqual(["j / k", "[ / ]", "Enter", "r"]);
  });
});

describe("planner item guidance", () => {
  it("an in-progress row says who holds it and since when; over 24 hours it is held too long", async () => {
    const recent = new Date(Date.now() - 3 * HOUR).toISOString();
    const old = new Date(Date.now() - 25 * HOUR).toISOString();
    const p = plan("g", { title: "Guide plan" });
    stage([
      detail(p, [
        item("c", "in_progress", 0, { title: "Charlie", last_agent: "claude-code", last_update: recent }),
        item("d", "in_progress", 1, { title: "Delta", last_agent: "codex", last_update: old }),
        item("e", "todo", 2, { title: "Echo", journal_refs: ["journal/1.md", "journal/2.md", "journal/3.md"] }),
      ]),
    ]);
    const { container } = renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Guide plan" });
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".plv-item"));
    const charlie = rows.find((r) => r.dataset.item === "c")!;
    const delta = rows.find((r) => r.dataset.item === "d")!;
    expect(charlie.querySelector(".plv-held")?.textContent).toBe(`Claude Code · ${relativeTime(recent, Date.now())}`);
    expect(charlie.querySelector(".plv-held .plv-time")).not.toBeNull();
    expect(charlie.querySelector(".chip.warn")).toBeNull();
    expect(delta.querySelector(".chip.warn")?.textContent).toBe(t("plan.item.heldLong"));
    expect(screen.getByRole("button", { name: t("plan.item.journalAria", { title: "Echo" }) }).textContent).toBe(t("plan.item.journalN", { n: 3 }));
  });

  it("unreadable plan lines surface as a warn chip that opens into the lines and a way to the file", async () => {
    const p = plan("w", { title: "Warned plan" });
    stage([detail(p, [item("a", "todo", 0)], { warnings: ["line 12: broken glyph", "line 30: missing id"] })]);
    renderPlanner();
    const chip = await screen.findByRole("button", { name: t("plan.warnLines", { n: 2 }) });
    expect(chip.className).toContain("warn");
    fireEvent.click(chip);
    expect(screen.getByText("line 12: broken glyph")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("plan.openFile") })).toBeInTheDocument();
  });

  it("a parent's box says why it cannot be pressed", async () => {
    const p = plan("pp", { title: "Parent plan" });
    stage([detail(p, [item("mom", "todo", 0, { title: "Mother" }), item("kid", "todo", 1, { title: "Kid", parent_item: "mom" })])]);
    renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Parent plan" });
    const mom = screen.getByRole("button", { name: t("plan.item.statusAria", { title: "Mother", status: t("plan.status.todo") }) });
    expect(mom.getAttribute("aria-disabled")).toBe("true");
    expect(mom.getAttribute("title")).toBe(t("plan.item.parentReason"));
  });

  it("finished and in-progress boxes are grey, and the menu's current row is a surface, not the accent", () => {
    for (const sel of [".plv-box.is-done", ".plv-box.is-in_progress", '.plv-status-item[aria-checked="true"]']) {
      const m = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
      expect(m, sel).not.toBeNull();
      expect(m![1], sel).not.toMatch(/--accent/);
    }
    expect(css).toMatch(/\.plv-box\.is-done\s*\{[^}]*var\(--text-2\)/);
  });

  it("the screen with the status menu open has no axe violations", async () => {
    const p = plan("ax", { title: "Axe plan" });
    stage([detail(p, [item("a", "todo", 0, { title: "Alpha" }), item("b", "in_progress", 1, { title: "Bravo", last_agent: "claude-code", last_update: new Date().toISOString() })])]);
    const { container } = renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Axe plan" });
    fireEvent.click(screen.getByRole("button", { name: t("plan.item.statusAria", { title: "Alpha", status: t("plan.status.todo") }) }));
    await screen.findByRole("menu");
    await act(async () => {});
    expect(summarize(await axe(container, AXE))).toEqual([]);
  });
});
