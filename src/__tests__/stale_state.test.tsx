import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// JN-06 (11-15) — no stale state, no stuck errors. A plan read that failed once kept its error card even
// after a successful reread; a quiet (disk-change) reread that failed tore the document down; actions fired
// while another plan was loading went to the new plan id with the old item; the journal detail showed the
// old body for a frame after moving, and a late "read" answer landed on the entry you moved to.

vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));

// 계획 쪽은 bindings 를 통째로 가짜로, 일지 쪽은 oculpmApi 를 가짜로 — 두 화면이 한 파일에서 서도록
// bindings 가짜는 둘을 합친다(일지의 14일 창 명령 + 계획 명령 + 이벤트 버스 하나).
vi.mock("@/lib/bindings", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/bindings")>();
  const planner = (await import("./plannerHarness")).plannerBindings();
  const journal = (await import("./journalHarness")).bindingsModule(orig);
  return {
    ...orig,
    commands: new Proxy({}, { get: (_t, p) => (p === "oculpmWorkdayBrief" ? journal.commands.oculpmWorkdayBrief : (planner.commands as Record<string | symbol, unknown>)[p]) }),
    events: planner.events,
  };
});
vi.mock("@/api/oculpm", async () => (await import("./journalHarness")).oculpmModule());
vi.mock("@/features/terminal/runPrompt", async () => (await import("./plannerHarness")).runPromptModule());
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { JournalScreenV2, __resetJournalMemory } from "@/features/oculpm/JournalScreenV2";
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";
import { detail, item, pemit, pfx, plan, resetPlanFixtures, stage } from "./plannerHarness";
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

function renderJournal() {
  return render(
    <WorkspaceProvider projectId={1}>
      <JournalScreenV2 projectId={1} todayKey="20260531" oculpmReady onOpenDiff={vi.fn()} focusPath={null} onFocusConsumed={vi.fn()} />
    </WorkspaceProvider>,
  );
}

const diskChanged = () => pemit("oculpmDataChanged", { project_id: 1, area: "planner" });

beforeEach(() => {
  __resetJournalMemory();
  resetPlanFixtures();
  resetJournalFixtures();
});
afterEach(() => cleanup());

describe("planner — errors clear, stale reads stay quiet", () => {
  it("a failed list read followed by a good one removes the error card", async () => {
    const p = plan("a", { title: "Recovered plan" });
    stage([detail(p, [item("x", "todo", 0)])]);
    pfx.failList = 1;
    renderPlanner();
    expect(await screen.findByText(t("plan.error"))).toBeInTheDocument();
    act(() => diskChanged());
    expect(await screen.findByRole("heading", { level: 2, name: "Recovered plan" })).toBeInTheDocument();
    expect(screen.queryByText(t("plan.error"))).toBeNull();
  });

  it("a failed list read is not cleared by a good read of the remembered plan — no false 'no plans' screen", async () => {
    stage([detail(plan("a", { title: "Remembered plan" }), [item("x", "todo", 0)])]);
    pfx.failList = 1;
    // 오늘 화면의 「계획 열기」처럼 고른 계획이 기억된 채로 들어온다 — 목록과 상세가 같이 돈다.
    function Remembered() {
      const { state, setState } = useWorkspace();
      useEffect(() => setState((prev) => ({ ...prev, plannerPlanId: "a" })), [setState]);
      return state.plannerPlanId === "a" ? <PlannerScreenV2 projectId={1} onNavigate={vi.fn()} onOpenJournal={vi.fn()} /> : null;
    }
    render(<SettingsProvider><WorkspaceProvider projectId={1}><Remembered /></WorkspaceProvider></SettingsProvider>);
    expect(await screen.findByText(t("plan.error"))).toBeInTheDocument();
    // 기억된 계획의 상세 읽기(성공)까지 다 돈 뒤에도 — 목록을 못 읽었다는 말이 남는다.
    await act(async () => {});
    await act(async () => {});
    expect(screen.getByText(t("plan.error"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("plan.emptyStart") })).toBeNull();
  });

  it("a quiet reread that fails keeps the document and adds one warn line with a retry", async () => {
    const p = plan("a", { title: "Kept plan" });
    stage([detail(p, [item("x", "todo", 0)])]);
    renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Kept plan" });
    pfx.failGet = 1;
    act(() => diskChanged());
    await waitFor(() => expect(document.querySelector(".plv-stale .stale-note")).not.toBeNull());
    expect(screen.getByRole("heading", { level: 2, name: "Kept plan" })).toBeInTheDocument();
    expect(screen.queryByText(t("plan.error"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("common.retry") }));
    await waitFor(() => expect(document.querySelector(".stale-note")).toBeNull());
  });

  it("switching to B while it loads blocks the run button; after it loads, run sends B's item to B", async () => {
    const a = plan("a", { title: "Plan A", updated_at: "2026-11-03" });
    const b = plan("b", { title: "Plan B", updated_at: "2026-11-02" });
    stage([detail(a, [item("a1", "todo", 0, { title: "A item" })]), detail(b, [item("b1", "todo", 0, { title: "B item" })])]);
    renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Plan A" });
    pfx.hold.add("b");
    fireEvent.click(within(screen.getByRole("navigation", { name: t("plan.list.aria") })).getByRole("button", { name: /Plan B/ }));
    // 아직 A 의 문서가 보인다 — 그동안 단추는 막혀 있다(A 의 항목을 B 로 보내지 않게).
    await waitFor(() => expect(screen.getByRole("button", { name: t("plan.nextRow.run") })).toBeDisabled());
    act(() => pfx.held.splice(0).forEach((go) => go()));
    await screen.findByRole("heading", { level: 2, name: "Plan B" });
    const run = screen.getByRole("button", { name: t("plan.nextRow.run") });
    await waitFor(() => expect(run).not.toBeDisabled());
    fireEvent.click(run);
    await waitFor(() => expect(pfx.dispatch).toEqual([["b", "b1"]]));
  });

  it("a planner disk event makes the plan log read again", async () => {
    const p = plan("a", { title: "Logged plan" });
    stage([detail(p, [item("x", "done", 0)])]);
    pfx.logRows = [{ ts: "2026-11-14T17:26:00+09:00", item_id: "x", agent_id: "claude-code", from_status: "todo", to_status: "done", journal_ref: null, note: null }];
    const { container } = renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Logged plan" });
    await waitFor(() => expect(container.querySelector(".plv-log")).not.toBeNull());
    const before = pfx.logCalls;
    act(() => diskChanged());
    await waitFor(() => expect(pfx.logCalls).toBeGreaterThan(before));
  });
});

describe("journal — the detail belongs to the entry on screen", () => {
  const seed = () => {
    jfx.byWorkday["20260531"] = [
      entry({ relative_path: "20260531/F/1200_a.md", title: "Entry A", evidence: 1, type: "bug", created_at: "2026-05-31T12:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1100_b.md", title: "Entry B", evidence: 1, type: "bug", created_at: "2026-05-31T11:00:00+09:00" }),
    ];
  };

  it("right after moving from a to b, the first render shows none of a's body", async () => {
    seed();
    const { container } = renderJournal();
    await waitFor(() => expect(container.querySelector(".jd-prose")?.textContent).toContain("body of Entry A"));
    fireEvent.keyDown(container.querySelector(".jl-split")!, { key: "j" });
    expect(container.querySelector(".jd-title")?.textContent).toBe("Entry B");
    expect(container.textContent).not.toContain("body of Entry A");
    await waitFor(() => expect(container.querySelector(".jd-prose")?.textContent).toContain("body of Entry B"));
  });

  it("a late answer to 'read' on a does not land on b", async () => {
    seed();
    jfx.holdVerify = true;
    const { container, findByRole } = renderJournal();
    fireEvent.click(await findByRole("button", { name: t("entry.verify"), pressed: false }));
    await waitFor(() => expect(jfx.verified).toHaveLength(1));
    fireEvent.keyDown(container.querySelector(".jl-split")!, { key: "j" });
    await waitFor(() => expect(container.querySelector(".jd-title")?.textContent).toBe("Entry B"));
    act(() => jfx.held.splice(0).forEach((go) => go()));
    await act(async () => {});
    const read = container.querySelector(".jd-read") as HTMLButtonElement;
    expect(read.getAttribute("aria-pressed")).toBe("false");
    expect(read.textContent).toBe(t("entry.verify"));
    expect(jfx.verified).toEqual([{ relativePath: "20260531/F/1200_a.md", verified: true }]);
  });
});
