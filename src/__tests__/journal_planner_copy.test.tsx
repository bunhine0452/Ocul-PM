import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// JN-09 (11-15) — empty states, the plan log, related links and words. No plans is no longer a dead end
// (one filled button hands the planning skill to the terminal); the plan log speaks status names and item
// titles instead of `in_progress → done` · `#id` · ISO stamps; rail titles carry their full text; related
// links look like the plan link (body ink, faint underline) with numbers-only reasons; one name per thing
// in the dictionary; the hand-written entry starts with three fields.

vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/lib/bindings", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/bindings")>();
  const planner = (await import("./plannerHarness")).plannerBindings();
  return { ...orig, commands: planner.commands, events: planner.events };
});
vi.mock("@/api/oculpm", async () => (await import("./journalHarness")).oculpmModule());
vi.mock("@/features/terminal/runPrompt", async () => (await import("./plannerHarness")).runPromptModule());
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { INCEPTION_PROMPT, PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { JournalDetail } from "@/features/oculpm/JournalDetail";
import { ManualEntryModalV2 } from "@/features/oculpm/ManualEntryModalV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";
import { detail, item, pfx, plan, resetPlanFixtures, stage } from "./plannerHarness";
import { entry, jfx, resetJournalFixtures } from "./journalHarness";

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
  resetJournalFixtures();
});
afterEach(() => cleanup());

describe("planner copy", () => {
  it("with no plans there is one filled button, and it hands /oculpm:inception to the terminal", async () => {
    stage([]);
    const { container } = renderPlanner();
    const start = await screen.findByRole("button", { name: t("plan.emptyStart") });
    expect(container.querySelectorAll(".btn.primary")).toHaveLength(1);
    expect(container.querySelector(".plv-main")).toBeNull();
    fireEvent.click(start);
    await waitFor(() => expect(pfx.runs).toEqual([INCEPTION_PROMPT]));
    expect(INCEPTION_PROMPT).toBe("/oculpm:inception");
  });

  it("plan log rows speak status names and item titles — no raw status codes or ids", async () => {
    const p = plan("l", { title: "Logged plan" });
    stage([detail(p, [item("ship-it", "done", 0, { title: "Ship the thing" })])]);
    pfx.logRows = [
      { ts: "2026-11-14T17:26:00+09:00", item_id: "ship-it", agent_id: "claude-code", from_status: "in_progress", to_status: "done", journal_ref: null, note: "ok" },
    ];
    const { container } = renderPlanner();
    const head = await screen.findByRole("button", { name: t("plan.log.rows", { n: 1 }) });
    fireEvent.click(head);
    const list = await screen.findByRole("list", { name: t("plan.log.listAria") });
    const text = list.textContent ?? "";
    expect(text).not.toMatch(/in_progress|ship-it|2026-11-14T/);
    expect(text).toContain(`${t("plan.status.in_progress")} → ${t("plan.status.done")}`);
    expect(text).toContain("Ship the thing");
    expect(within(list).getByText("Ship the thing").getAttribute("title")).toBe("#ship-it");
    expect(container.querySelector(".plv-log-row .plv-time")).not.toBeNull();
  });

  it("rail titles carry their full text in title", async () => {
    const p = plan("r", { title: "A long plan title that the rail would cut short on a narrow column" });
    stage([detail(p, [item("a", "todo", 0)])]);
    const { container } = renderPlanner();
    await screen.findByRole("navigation", { name: t("plan.list.aria") });
    expect(container.querySelector(".plv-li-title")?.getAttribute("title")).toBe(p.title);
  });

  it("the dictionary keeps one name per thing", () => {
    const ko = readFileSync(join(__dirname, "..", "i18n", "ko.ts"), "utf8");
    const values = [...ko.matchAll(/^\s*"[\w.]+":\s*"((?:[^"\\]|\\.)*)"/gm)].map((m) => m[1]);
    // i18n-ignore-next-line -- 사전에서 걷은 옛 낱말 목록이 검사 재료다
    for (const word of ["플래너", "활성 계획", "잠긴", "oculpm_create_manual_entry"]) {
      expect(values.filter((v) => v.includes(word)), word).toEqual([]);
    }
  });
});

describe("journal copy", () => {
  it("related links look like the plan link, give numbers-only reasons, and say when an entry is missing", async () => {
    const e = entry({ relative_path: "20260531/F/1000_x.md", type: "bug" });
    jfx.byWorkday["20260531"] = [e];
    jfx.explicit[e.relative_path] = [{ ref: "20260101/F/0900_gone.md", kind: "followup" }];
    jfx.missing.add("20260101/F/0900_gone.md");
    jfx.related = [{ relative_path: "20260530/F/0900_y.md", title: "**Earlier** work", score: 1, reasons: [{ code: "shared_files", params: ["2", "src/features/a.ts"] }] }];
    const { container } = render(
      <WorkspaceProvider projectId={1}>
        <JournalDetail projectId={1} entry={e} planLinks={[]} onOpenDiff={vi.fn()} onOpenRelated={vi.fn()} />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(container.querySelector(".jd-related-missing")).not.toBeNull());
    await waitFor(() => expect(container.querySelector(".jd-related button")).not.toBeNull());
    const link = container.querySelector(".jd-related button")!;
    expect(link.className).toContain("text-link");
    expect(link.className).not.toMatch(/accent/);
    expect(link.textContent).toBe("Earlier work");
    const why = Array.from(container.querySelectorAll(".jd-related-why")).map((w) => w.textContent);
    expect(why).toContain(` · ${t("entry.related.why.files", { n: 2 })}`);
    expect(why.join(" ")).not.toContain("src/features/a.ts");
    expect(container.querySelector('.jd-related-why[title="src/features/a.ts"]')).not.toBeNull();
    expect(container.querySelector(".jd-related-missing")?.textContent).toBe(t("journal.related.missing"));
  });

  it("a hand-written entry starts with three fields; the rest waits under 'More'; ⌘↩ writes", async () => {
    const { container } = render(<ManualEntryModalV2 projectId={1} workday="20260531" onCreated={vi.fn()} onClose={vi.fn()} />);
    const form = container.ownerDocument.querySelector("form.entry-form") as HTMLFormElement;
    expect(form.querySelectorAll(":scope > .entry-field")).toHaveLength(3);
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.queryByLabelText(new RegExp(t("manual.slugField")))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("journal.manualMore") }));
    expect(screen.getByLabelText(new RegExp(t("manual.slugField")))).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(new RegExp(t("manual.titleField"))), { target: { value: "Fix the export flag" } });
    fireEvent.keyDown(form, { key: "Enter", metaKey: true, ctrlKey: true });
    await waitFor(() => expect(jfx.created.map((d) => d.title)).toEqual(["Fix the export flag"]));
  });
});
