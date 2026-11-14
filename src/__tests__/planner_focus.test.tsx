import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// JN-07 (11-15) — where focus goes after the status menu closes. The menu used to hand focus back to the
// box on the *next frame*. Two common cases broke: picking "done" on an item with no linked journal opens
// the "done without a check" dialog, and that late focus stole it back to the box behind the scrim (Esc no
// longer reached the dialog, Enter reopened the menu behind it, and closing left focus on body); picking a
// status that finishes a phase folds it, the box unmounts and focus fell to body, where j/k are dead.

vi.mock("@/lib/bindings", async () => (await import("./plannerHarness")).plannerBindings());
vi.mock("@/features/terminal/runPrompt", async () => (await import("./plannerHarness")).runPromptModule());

import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";
import { detail, item, pfx, plan, resetPlanFixtures, stage } from "./plannerHarness";

function renderPlanner() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <PlannerScreenV2 projectId={1} onNavigate={vi.fn()} onOpenJournal={vi.fn()} />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

/** 두 프레임 — 메뉴가 닫히며 건 요청(rAF)까지 다 돈 뒤를 본다. */
const frames = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const box = (title: string, status: string) =>
  screen.getByRole("button", { name: t("plan.item.statusAria", { title, status: t(`plan.status.${status}` as "plan.status.todo") }) });

beforeEach(() => {
  resetPlanFixtures();
});
afterEach(() => cleanup());

describe("planner focus after the status menu", () => {
  it("done on an item with no journal: the dialog keeps focus, Esc closes it, focus returns to the box", async () => {
    stage([detail(plan("f", { title: "Focus plan" }), [item("a", "todo", 0, { title: "Alpha" }), item("b", "todo", 1, { title: "Bravo" })])]);
    renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Focus plan" });
    const alpha = box("Alpha", "todo");
    alpha.focus();
    fireEvent.keyDown(alpha, { key: "Enter" });
    await screen.findByRole("menu");
    fireEvent.keyDown(document.activeElement!, { key: "3" });
    const dialog = await screen.findByRole("dialog");
    await frames();
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await frames();
    expect(document.activeElement).toBe(box("Alpha", "todo"));
    expect(pfx.edits).toEqual([]);
  });

  it("confirming 'done without a check' that finishes the phase leaves focus on a box, not on body", async () => {
    stage([
      detail(plan("g", { title: "Fold plan" }), [
        item("a", "done", 0, { title: "Alpha", phase: "One" }),
        item("b", "todo", 1, { title: "Bravo", phase: "One" }),
        item("c", "todo", 2, { title: "Charlie", phase: "Two" }),
      ]),
    ]);
    renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Fold plan" });
    const bravo = box("Bravo", "todo");
    bravo.focus();
    fireEvent.keyDown(bravo, { key: "Enter" });
    await screen.findByRole("menu");
    fireEvent.keyDown(document.activeElement!, { key: "3" });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: t("plan.confirmDoneAction") }));
    await waitFor(() => expect(pfx.edits).toHaveLength(1));
    await frames();
    // 단계 「One」 이 끝나 접혔다 — 상자는 사라졌고 같은 자리의 상자(Charlie)가 포커스를 받는다.
    expect(screen.queryByRole("button", { name: t("plan.item.statusAria", { title: "Bravo", status: t("plan.status.done") }) })).toBeNull();
    expect(document.activeElement).toBe(box("Charlie", "todo"));
  });

  it("a status that folds the phase (item with a journal, no dialog) also keeps focus on a box", async () => {
    stage([
      detail(plan("h", { title: "Fold again" }), [
        item("a", "todo", 0, { title: "Alpha", phase: "One", journal_refs: ["journal/x.md"] }),
        item("c", "todo", 1, { title: "Charlie", phase: "Two" }),
      ]),
    ]);
    const { container } = renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Fold again" });
    const alpha = box("Alpha", "todo");
    alpha.focus();
    fireEvent.keyDown(alpha, { key: "Enter" });
    await screen.findByRole("menu");
    fireEvent.keyDown(document.activeElement!, { key: "3" });
    await waitFor(() => expect(pfx.edits).toHaveLength(1));
    await frames();
    expect(document.activeElement).toBe(box("Charlie", "todo"));
    // 키가 다시 먹는다 — 포커스가 본문 안이라 k 가 그대로 상자 사이를 걷는다.
    fireEvent.keyDown(document.activeElement!, { key: "k" });
    expect(container.querySelector(".plv-body")?.contains(document.activeElement)).toBe(true);
  });
});
