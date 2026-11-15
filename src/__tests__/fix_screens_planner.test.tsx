// 최종 검수 고침 (11-15 fix-screens) — 계획 화면. 항목이 다 닫힌 계획의 한 문장이 판정 카드와 같은 상태를 말하고
// (RC-02), 시각은 기계 글씨이며(RC-06), 다시 읽다 실패한 한 줄은 오늘과 같은 모양 · 말이고(RC-11), 「검증 없이 완료」
// 창은 바로 옆 「셸에서 돌리기」 창과 같은 대화상자 한 벌이다(RC-10).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./plannerHarness")).plannerBindings());
vi.mock("@/features/terminal/runPrompt", async () => (await import("./plannerHarness")).runPromptModule());

import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";
import { ko } from "@/i18n/ko";
import { detail, item, pemit, pfx, plan, resetPlanFixtures, stage, verdict } from "./plannerHarness";

function renderPlanner() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <PlannerScreenV2 projectId={1} onNavigate={vi.fn()} onOpenJournal={vi.fn()} />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => resetPlanFixtures());
afterEach(() => cleanup());

describe("RC-02 — every item closed: the sentence says the same state as the verdict card", () => {
  const cases = [
    {
      name: "changed after the pass",
      p: plan("s", { title: "Stale", last_verdict: verdict(), stale_files: ["src/a.ts"] }),
      check: "pnpm test",
      want: () => t("plan.nextRow.allClosedStale"),
      card: ".vl.is-stale",
    },
    {
      name: "passed on another OS",
      p: plan("w", { title: "Away", last_verdict: verdict(), verdict_from: "windows" }),
      check: "pnpm test",
      want: () => t("plan.nextRow.allClosedAway", { os: "Windows" }),
      card: ".vl.is-away",
    },
    {
      name: "no check command at all",
      p: plan("n", { title: "No check" }),
      check: null,
      want: () => t("plan.nextRow.allClosedNoCheck"),
      card: null,
    },
    {
      name: "failed",
      p: plan("f", { title: "Failed", last_verdict: verdict({ passed: false, summary: "2 failed" }) }),
      check: "pnpm test",
      want: () => t("plan.nextRow.allClosed"),
      card: ".vl.is-fail",
    },
    {
      name: "never run",
      p: plan("r", { title: "Never run" }),
      check: "pnpm test",
      want: () => t("plan.nextRow.allClosed"),
      card: null,
    },
    {
      name: "passed",
      p: plan("p", { title: "Passed", last_verdict: verdict() }),
      check: "pnpm test",
      want: () => t("plan.nextRow.allClosedPassed"),
      card: ".vl.is-pass",
    },
    // 확인 명령 줄을 나중에 지운 계획 — 카드가 보이는 기록된 판정이 먼저다(「닫아도 돼요」 가 아니다).
    {
      name: "failed, then the check line was removed",
      p: plan("x", { title: "Failed no line", last_verdict: verdict({ passed: false, summary: "2 failed" }) }),
      check: null,
      want: () => t("plan.nextRow.allClosed"),
      card: ".vl.is-fail",
    },
    {
      name: "changed after the pass, then the check line was removed",
      p: plan("y", { title: "Stale no line", last_verdict: verdict(), stale_files: ["src/a.ts"] }),
      check: null,
      want: () => t("plan.nextRow.allClosedStale"),
      card: ".vl.is-stale",
    },
  ];

  it.each(cases)("$name", async ({ p, check, want, card }) => {
    stage([detail(p, [item("a", "done", 0), item("b", "done", 1)], { check })]);
    const { container } = renderPlanner();
    await screen.findByRole("heading", { level: 2, name: p.title });
    await waitFor(() => expect(container.querySelector(".plv-next .plv-meta")?.textContent).toBe(want()));
    expect(container.querySelector(".plv-next-label")?.textContent).toBe(t("plan.nextRow.doneLabel"));
    if (card) expect(container.querySelector(`.plv-judge-last ${card}`)).not.toBeNull();
    // 「아직 통과하지 않았어요」 는 실패 · 안 돌림에만 선다 — 바뀜 · 다른 기기 · 명령 없음 · 통과에는 서지 않는다.
    if (want() !== t("plan.nextRow.allClosed")) expect(container.textContent).not.toContain(t("plan.nextRow.allClosed"));
  });
});

// 여기는 클래스가 붙었는지만 문다 — `.plv-time` 은 레인 전에도 있던 클래스다. 시각의 모양(mono)은 fix_screens_rules 의
// CSS 규칙 단언이 문다.
describe("RC-06 — item and log times carry the time class", () => {
  it("'Claude · 3 hours ago' and the log row time are .plv-time", async () => {
    const p = plan("t", { title: "Times" });
    const held = item("a", "in_progress", 0, { last_agent: "claude-code", last_update: new Date(Date.now() - 3 * 3600_000).toISOString() });
    stage([detail(p, [held, item("b", "todo", 1)])]);
    pfx.logRows = [{ ts: "2026-11-14T17:26:00+09:00", item_id: "a", agent_id: "claude-code", from_status: "todo", to_status: "in_progress", journal_ref: null, note: null }];
    const { container } = renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Times" });
    await waitFor(() => expect(container.querySelector(".plv-held .plv-time")).not.toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: t("plan.log.rows", { n: 1 }) }));
    await waitFor(() => expect(container.querySelector(".plv-log-row .plv-time")).not.toBeNull());
    expect(container.querySelector(".plv-held .plv-time")?.textContent).toMatch(/\d/);
  });
});

describe("RC-11 — a failed reread reads like Today's: '14:12 couldn't read since' + a text link", () => {
  it("no warn chip around a sentence, one shared retry word, time in machine text", async () => {
    stage([detail(plan("k", { title: "Kept" }), [item("x", "todo", 0)])]);
    const { container } = renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Kept" });
    pfx.failGet = 1;
    act(() => pemit("oculpmDataChanged", { project_id: 1, area: "planner" }));
    await waitFor(() => expect(container.querySelector(".plv-stale .stale-note")).not.toBeNull());
    const note = container.querySelector(".plv-stale .stale-note") as HTMLElement;
    expect(note.getAttribute("role")).toBe("status");
    const time = note.querySelector(".mono")?.textContent ?? "";
    expect(time).toMatch(/^\d{2}:\d{2}$/);
    expect(note.textContent).toBe(t("state.staleSince", { time }) + t("common.retry"));
    expect(within(note).getByRole("button", { name: t("common.retry") }).className).toBe("text-link");
    expect(container.querySelector(".plv-stale .chip")).toBeNull();
    // 같은 동작에 따로 두던 낱말(「Try again」)과 칩 문장은 사전에서 걷었다.
    expect("plan.retry" in ko).toBe(false);
    expect("plan.staleRead" in ko).toBe(false);
  });
});

describe("RC-10 — 'done without a check' is the same dialog set as 'run in shell'", () => {
  /** 대화상자 한 벌의 모양 — 머리(제목) · 발, 취소 = 테 없는 단추 + Esc. */
  function shapeOf(dialog: HTMLElement) {
    const foot = dialog.querySelector(".dlg-foot");
    const cancel = within(dialog).getByRole("button", { name: t("common.cancel") });
    return {
      head: dialog.querySelector(".dlg-head .dlg-title") != null,
      foot: foot != null,
      cancelGhost: cancel.className.includes("ghost"),
      cancelKey: cancel.querySelector(".dlg-key")?.textContent ?? null,
      primaries: dialog.querySelectorAll(".btn.primary").length,
    };
  }

  it("head + foot, cancel is a ghost button that says Esc, one filled confirm — like CheckRunDialog", async () => {
    stage([detail(plan("d", { title: "Dialogs" }), [item("a", "todo", 0, { title: "Alpha" }), item("b", "todo", 1)])]);
    renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Dialogs" });
    fireEvent.click(screen.getByRole("button", { name: t("plan.item.statusAria", { title: "Alpha", status: t("plan.status.todo") }) }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: t("plan.status.done") }));
    const confirm = await screen.findByRole("dialog", { name: t("plan.confirmDoneTitle") });
    const done = shapeOf(confirm);
    expect(done).toEqual({ head: true, foot: true, cancelGhost: true, cancelKey: "Esc", primaries: 1 });
    expect(confirm.querySelector(".dlg-title")?.textContent).toBe(t("plan.confirmDoneTitle"));
    expect(within(confirm).getByRole("button", { name: t("plan.confirmDoneAction") }).className).toContain("primary");
    expect(document.querySelector(".plv-confirm")).toBeNull();
    fireEvent.click(within(confirm).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pfx.edits).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: t("plan.check.run") }));
    const check = await screen.findByRole("dialog", { name: t("plan.check.confirmTitle") });
    expect(shapeOf(check)).toEqual(done);
  });

  it("a held ↩ (key repeat from the status menu) does not pass the gate", async () => {
    stage([detail(plan("h", { title: "Held" }), [item("a", "todo", 0, { title: "Alpha" }), item("b", "todo", 1)])]);
    renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Held" });
    fireEvent.click(screen.getByRole("button", { name: t("plan.item.statusAria", { title: "Alpha", status: t("plan.status.todo") }) }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: t("plan.status.done") }));
    const dialog = await screen.findByRole("dialog", { name: t("plan.confirmDoneTitle") });
    const ok = within(dialog).getByRole("button", { name: t("plan.confirmDoneAction") });
    // 기본 동작(단추 누름)까지 막힌다 — fireEvent 가 false 를 돌려준다.
    expect(fireEvent.keyDown(ok, { key: "Enter", repeat: true })).toBe(false);
    expect(fireEvent.keyDown(ok, { key: "Enter", repeat: true, metaKey: true, ctrlKey: true })).toBe(false);
    expect(screen.getByRole("dialog", { name: t("plan.confirmDoneTitle") })).toBeInTheDocument();
    expect(pfx.edits).toEqual([]);
  });
});
