// 최종 검수 고침 (11-15 fix-screens) — 일지 화면. 검증 상자는 본문 서체에 기계 글씨만 mono(V-08), 영어에서도 목록과
// 상세가 같은 날짜 말(RC-23), 머리의 「여럿 중 하나」 는 앱의 라디오 묶음(RC-19), 계획 고리는 글자 링크 한 벌(RC-21),
// 수동 일지 창의 발은 대화상자 한 벌의 약속(RC-10).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/api/oculpm", async () => (await import("./journalHarness")).oculpmModule());
vi.mock("@/api/plan", async () => (await import("./journalHarness")).planModule());
vi.mock("@/lib/bindings", async (importOriginal) =>
  (await import("./journalHarness")).bindingsModule(await importOriginal<typeof import("@/lib/bindings")>()),
);
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { JournalDetail } from "@/features/oculpm/JournalDetail";
import { JournalScreenV2, __resetJournalMemory } from "@/features/oculpm/JournalScreenV2";
import { ManualEntryModalV2 } from "@/features/oculpm/ManualEntryModalV2";
import { setLangSetting, t } from "@/i18n";
import { kbd } from "@/lib/kbd";
import { localWorkdayKey } from "@/lib/workday";
import { workdayDate } from "@/lib/workdayLabel";
import { entry, jfx, resetJournalFixtures } from "./journalHarness";

function renderDetail(e = entry({ type: "bug", evidence: 2 }), planLinks: Parameters<typeof JournalDetail>[0]["planLinks"] = []) {
  return render(
    <WorkspaceProvider projectId={1}>
      <JournalDetail projectId={1} entry={e} planLinks={planLinks} onOpenDiff={vi.fn()} onOpenRelated={vi.fn()} />
    </WorkspaceProvider>,
  );
}

function renderJournal() {
  return render(
    <WorkspaceProvider projectId={1}>
      <JournalScreenV2 projectId={1} todayKey="20260531" oculpmReady onOpenDiff={vi.fn()} focusPath={null} onFocusConsumed={vi.fn()} />
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  resetJournalFixtures();
  __resetJournalMemory();
});
afterEach(() => {
  cleanup();
  setLangSetting("ko");
});

describe("V-08 — the verification box is body type; only commands and results are mono", () => {
  it("the agent's sentence is not drawn in a monospace fallback", async () => {
    const e = entry({ relative_path: "20260531/B/1000_v.md", type: "bug", evidence: 2 });
    jfx.bodies[e.relative_path] = "[x] t\n\n## Verification\n- after merge: `pnpm test` 1652 passed · not eyeballed on the installed build\n";
    const { container } = renderDetail(e);
    await waitFor(() => expect(container.querySelector(".jd-term")).not.toBeNull());
    const box = container.querySelector(".jd-term")!;
    expect(box.tagName).not.toBe("PRE");
    expect([...box.querySelectorAll(".mono")].map((m) => m.textContent)).toEqual(["pnpm test 1652 passed"]);
    expect(box.textContent).toBe("after merge: pnpm test 1652 passed · not eyeballed on the installed build");
  });
});

describe("RC-23 — one date word on the journal screen, English included", () => {
  it("the detail head and 'read on' use the list's date words, never m/d", async () => {
    setLangSetting("en");
    jfx.byWorkday["20260531"] = [entry({ relative_path: "20260531/F/1402_w.md", type: "bug", evidence: 2, created_at: "2026-05-31T14:02:00+09:00" })];
    const { container } = renderJournal();
    await waitFor(() => expect(container.querySelector(".jd-meta")).not.toBeNull());
    const head = container.querySelector("#jl-day-20260531-name")?.textContent ?? "";
    const date = workdayDate("20260531", "en");
    expect(head).toContain(date);
    const meta = container.querySelector(".jd-meta")!;
    expect(meta.textContent).toContain(`${date} 14:02`);
    expect(meta.querySelector(".mono")?.textContent).toBe("14:02");
    expect(meta.textContent).not.toMatch(/\b\d{1,2}\/\d{1,2}\b/);
    fireEvent.click(within(container.querySelector(".jd-verify") as HTMLElement).getByRole("button", { name: t("entry.verify") }));
    await waitFor(() => expect(meta.textContent).toContain(t("journal.readOn", { date: workdayDate(localWorkdayKey(), "en") })));
    expect(meta.textContent).not.toMatch(/\b\d{1,2}\/\d{1,2}\b/);
  });
});

describe("RC-19 — the journal head uses the app's radio group (no local copy)", () => {
  it("period · type are radiogroups; while filtering by verification 'last 14 days' is blocked and says why", async () => {
    jfx.byWorkday["20260531"] = [entry({ relative_path: "20260531/B/1100_m.md", type: "bug", evidence: 0 })];
    jfx.allPeriod = jfx.byWorkday["20260531"];
    const { container } = renderJournal();
    const period = await screen.findByRole("radiogroup", { name: t("journal.periodAria") });
    expect(within(period).getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radiogroup", { name: t("journal.typeFilterAria") })).toBeInTheDocument();
    expect(container.querySelector('[role="tab"], [role="tablist"]')).toBeNull();
    fireEvent.click(container.querySelector(".jl-only") as HTMLElement);
    const recent = await within(screen.getByRole("radiogroup", { name: t("journal.periodAria") })).findByRole("radio", { name: t("journal.period.recent") });
    await waitFor(() => expect(recent).toHaveAttribute("aria-disabled", "true"));
    expect(recent).toHaveAttribute("title", t("journal.period.locked"));
  });
});

describe("RC-21 — the plan link in the detail head is the one text link", () => {
  it("uses .text-link like Today's links and the related entries", async () => {
    const e = entry({ relative_path: "20260531/F/1000_p.md", type: "bug", evidence: 2 });
    const { container } = renderDetail(e, [{ journal_ref: e.relative_path, plan_id: "p", plan_title: "Plan P", item_id: "a" }]);
    await waitFor(() => expect(container.querySelector(".jd-plan-link")).not.toBeNull());
    expect(container.querySelector(".jd-plan-link")?.className.split(" ")).toContain("text-link");
  });
});

describe("RC-10 — the hand-written entry dialog keeps the dialog set's promises", () => {
  it("cancel is a ghost button that says Esc; write says ⌘↩ and ⌘↩ works with focus on the foot", async () => {
    render(<ManualEntryModalV2 projectId={1} workday="20260531" onCreated={vi.fn()} onClose={vi.fn()} />);
    const cancel = screen.getByRole("button", { name: t("common.cancel") });
    expect(cancel.className).toContain("ghost");
    expect(cancel.querySelector(".dlg-key")?.textContent).toBe("Esc");
    const submit = screen.getByRole("button", { name: t("manual.submit") });
    expect(submit.querySelector(".dlg-key")?.textContent).toBe(kbd("⌘↩"));
    fireEvent.change(screen.getByLabelText(new RegExp(t("manual.titleField"))), { target: { value: "Fix the export flag" } });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Enter", metaKey: true, ctrlKey: true });
    await waitFor(() => expect(jfx.created.map((d) => d.title)).toEqual(["Fix the export flag"]));
  });
});
