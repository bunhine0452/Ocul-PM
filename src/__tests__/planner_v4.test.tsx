import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

import type { PlanDetail, PlanItemDto, PlanSummary, PlanVerdict } from "@/lib/bindings";

// ─── 4.0 계획 — 완료 조건 · 확인 명령 · 마지막 판정 ───────────────────────────
//
// 무는 것:
//  1. 판정 카드가 ✓ / ✗ / 「아직 안 돌렸어요」 셋을 가르고, ✗ 에는 결과 끝 줄이 붙는다.
//  2. 「다음」은 digest.rs 와 같은 규칙의 리프이고, [프롬프트 복사]·[until-done 으로 복사]가
//     같은 프롬프트(뒤에 until-done 지시)를 클립보드에 둔다.
//  3. 상태 상자를 누르면 여섯 상태 메뉴 — 고르면 set_status. 검증 일지 없는 완료는 한 번 묻는다.
//  4. 레일: 진행 중 계획과 판정, 끝난 계획은 접힌 한 줄.

const fx = vi.hoisted(() => ({
  plans: [] as unknown[],
  details: {} as Record<string, unknown>,
  edits: [] as Array<{ planId: string; op: unknown }>,
  dispatch: [] as Array<[string, string]>,
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "planList":
              return () => ok(fx.plans);
            case "planGet":
              return (_p: number, id: string) => ok(fx.details[id] ?? null);
            case "planApplyEdit":
              return (_p: number, planId: string, op: unknown) => {
                fx.edits.push({ planId, op });
                return ok(fx.details[planId]);
              };
            case "planLog":
              return () => ok([]);
            case "planLockedOpen":
              return () => ok([]);
            case "planDispatchPrompt":
              return (_p: number, planId: string, itemId: string) => {
                fx.dispatch.push([planId, itemId]);
                return ok({ file_rel: "x", command: "x", prompt: "PROMPT", item_title: "트레이 제거" });
              };
            case "settingsGetAll":
              return () => ok([] as Array<[string, string]>);
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));
const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } } as const;

function summary(id: string, over: Partial<PlanSummary> = {}): PlanSummary {
  return {
    plan_id: id,
    title: `계획 ${id}`,
    status: "active",
    owner_agent: "claude-code",
    progress: 0.5,
    file_path: `.oculpm/planner/${id}.md`,
    updated_at: "2026-10-28",
    item_count: 4,
    done_count: 1,
    last_verdict: null,
    ...over,
  };
}

function it_(id: string, status: string, order: number, over: Partial<PlanItemDto> = {}): PlanItemDto {
  return {
    item_id: id,
    phase: "덜어내기 — 화면",
    title: `항목 ${id}`,
    status,
    order_idx: order,
    parent_item: null,
    note: null,
    last_agent: null,
    last_update: null,
    journal_refs: [],
    ...over,
  };
}

function detail(plan: PlanSummary, items: PlanItemDto[], over: Partial<PlanDetail> = {}): PlanDetail {
  return {
    plan,
    items,
    phases: [],
    decisions: [],
    warnings: [],
    done_when: "앱이 다섯 화면만 남는다",
    check: "pnpm test && (cd src-tauri && cargo test --locked)",
    ...over,
  };
}

const FAIL: PlanVerdict = { passed: false, summary: "2 failed, 418 passed", ts: new Date().toISOString(), agent_id: "claude-code", item_id: "x" };

function stage(plans: PlanSummary[], details: PlanDetail[]) {
  fx.plans = plans;
  fx.details = Object.fromEntries(details.map((d) => [d.plan.plan_id, d]));
}

function renderPlanner() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <PlannerScreenV2 projectId={1} onNavigate={vi.fn()} onOpenJournal={vi.fn()} />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

const judge = () => screen.getByRole("region", { name: t("plan.judge.aria") });

beforeEach(() => {
  fx.plans = [];
  fx.details = {};
  fx.edits = [];
  fx.dispatch = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
});
afterEach(() => cleanup());

describe("판정 카드", () => {
  it("✗ — 실패 칩과 결과 끝 줄, 완료 조건·확인 명령, 그리고 규칙 한 줄", async () => {
    const p = summary("drop", { title: "4.0 덜어내기", last_verdict: FAIL });
    stage([p], [detail(p, [it_("a", "done", 0), it_("b", "todo", 1)])]);
    renderPlanner();
    expect(await screen.findByRole("heading", { level: 2, name: "4.0 덜어내기" })).toBeInTheDocument();
    const card = judge();
    expect(within(card).getByText(t("plan.judge.fail"))).toBeInTheDocument();
    expect(within(card).getByText("2 failed, 418 passed")).toBeInTheDocument();
    expect(within(card).getByText("앱이 다섯 화면만 남는다")).toBeInTheDocument();
    expect(within(card).getByText("pnpm test && (cd src-tauri && cargo test --locked)")).toBeInTheDocument();
  });

  it("✓ — 통과 칩", async () => {
    const p = summary("ok", { last_verdict: { ...FAIL, passed: true, summary: "418 passed · exit 0" } });
    stage([p], [detail(p, [it_("a", "done", 0)])]);
    renderPlanner();
    expect(await within(await screen.findByRole("region", { name: t("plan.judge.aria") })).findByText(t("plan.judge.pass"))).toBeInTheDocument();
  });

  it("판정 없음 — 「아직 안 돌렸어요」, 완료 조건이 없으면 그렇다고 말한다", async () => {
    const p = summary("none");
    stage([p], [detail(p, [it_("a", "todo", 0)], { done_when: null })]);
    renderPlanner();
    const card = await screen.findByRole("region", { name: t("plan.judge.aria") });
    expect(within(card).getByText(t("plan.judge.notRun"))).toBeInTheDocument();
    expect(within(card).getByText(t("plan.judge.noDoneWhen"))).toBeInTheDocument();
  });
});

describe("다음 · 복사", () => {
  it("다음은 사람 몫을 건너뛴 첫 할 일 — 프롬프트 복사와 until-done 복사", async () => {
    const p = summary("drop");
    stage(
      [p],
      [
        detail(p, [
          it_("done1", "done", 0),
          it_("busy", "in_progress", 1),
          it_("tag", "todo", 2, { title: "[사용자] v4.0.0 태그" }),
          it_("drop-tray", "todo", 3, { title: "트레이 제거" }),
        ]),
      ],
    );
    renderPlanner();
    await screen.findByText("트레이 제거", { selector: ".plv-next-title" });
    fireEvent.click(screen.getByRole("button", { name: t("plan.nextRow.copy") }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("PROMPT"));
    fireEvent.click(screen.getByRole("button", { name: t("plan.nextRow.untilDone") }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(`PROMPT\n\n${t("plan.nextRow.untilDoneSuffix")}`),
    );
    expect(t("plan.nextRow.untilDoneSuffix")).toContain("/oculpm:next until-done");
    expect(fx.dispatch).toEqual([
      ["drop", "drop-tray"],
      ["drop", "drop-tray"],
    ]);
    // 사람 몫은 칩으로, 머리표는 문구에서 뗀다.
    expect(screen.getByText("v4.0.0 태그")).toBeInTheDocument();
    expect(screen.getAllByText(t("plan.item.user")).length).toBeGreaterThan(0);
  });

  it("항목이 다 닫히면 「판정이 통과해야 끝」을 말한다", async () => {
    const p = summary("closed");
    stage([p], [detail(p, [it_("a", "done", 0), it_("b", "dropped", 1)])]);
    renderPlanner();
    expect(await screen.findByText(t("plan.nextRow.allClosed"))).toBeInTheDocument();
  });
});

describe("상태 메뉴", () => {
  it("상자를 누르면 여섯 상태 — 막힘을 고르면 set_status", async () => {
    const p = summary("drop");
    stage([p], [detail(p, [it_("hook", "todo", 0, { title: "시작 훅" })])]);
    renderPlanner();
    const box = await screen.findByRole("button", {
      name: t("plan.item.statusAria", { title: "시작 훅", status: t("plan.status.todo") }),
    });
    fireEvent.click(box);
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(6);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: t("plan.status.blocked") }));
    await waitFor(() => expect(fx.edits).toEqual([{ planId: "drop", op: { kind: "set_status", item_id: "hook", status: "blocked" } }]));
  });

  it("검증 일지 없는 완료는 한 번 묻고, 확인하면 그대로 간다", async () => {
    const p = summary("drop");
    stage([p], [detail(p, [it_("hook", "in_progress", 0, { title: "시작 훅" })])]);
    renderPlanner();
    fireEvent.click(
      await screen.findByRole("button", { name: t("plan.item.statusAria", { title: "시작 훅", status: t("plan.status.in_progress") }) }),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: t("plan.status.done") }));
    expect(fx.edits).toEqual([]);
    fireEvent.click(await screen.findByRole("button", { name: t("plan.confirmDoneAction") }));
    await waitFor(() => expect(fx.edits).toHaveLength(1));
  });

  it("끝난 계획은 고치지 않는다 — 상자가 잠기고 다음 줄이 없다", async () => {
    const p = summary("old", { status: "done" });
    stage([p], [detail(p, [it_("a", "todo", 0, { title: "남은 것" })])]);
    renderPlanner();
    const box = await screen.findByRole("button", { name: t("plan.item.statusAria", { title: "남은 것", status: t("plan.status.todo") }) });
    expect(box).toBeDisabled();
    expect(screen.queryByRole("button", { name: t("plan.nextRow.copy") })).toBeNull();
  });
});

describe("레일", () => {
  it("진행 중 계획과 판정, 끝난 계획은 접힌 한 줄 — 고르면 그 계획이 열린다", async () => {
    const a = summary("a", { title: "4.0 덜어내기", updated_at: "2026-10-28", last_verdict: FAIL });
    const b = summary("b", { title: "크로스플랫폼 포팅", updated_at: "2026-10-01" });
    const c = summary("c", { title: "옛 계획", status: "done", updated_at: "2026-09-01" });
    stage([b, c, a], [detail(a, [it_("x", "todo", 0)]), detail(b, [it_("y", "todo", 0)]), detail(c, [it_("z", "done", 0)])]);
    const { container } = renderPlanner();
    const rail = await screen.findByRole("navigation", { name: t("plan.list.aria") });
    expect(within(rail).getByText(t("plan.list.active", { n: 2 }))).toBeInTheDocument();
    expect(within(rail).getByText(t("plan.list.closed", { n: 1 }))).toBeInTheDocument();
    // 최신 갱신이 먼저 열린다 — 오늘 화면의 계획 카드와 같은 순서.
    expect(await screen.findByRole("heading", { level: 2, name: "4.0 덜어내기" })).toBeInTheDocument();
    expect(within(rail).getAllByText(t("plan.list.noVerdict"))).toHaveLength(2);
    expect(within(rail).getByText("✗")).toBeInTheDocument();
    expect((container.querySelector(".plv-closed") as HTMLDetailsElement).open).toBe(false);

    fireEvent.click(within(rail).getByRole("button", { name: /크로스플랫폼 포팅/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "크로스플랫폼 포팅" })).toBeInTheDocument();

    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });

  it("계획이 없으면 — 에이전트가 세운다는 한 문단", async () => {
    stage([], []);
    renderPlanner();
    expect(await screen.findByText(t("plan.emptyAgents"))).toBeInTheDocument();
  });
});
