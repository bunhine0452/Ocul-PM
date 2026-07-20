import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-CI6 (EDD-lite) — eval 추이 카드 + 플래너 완료 소프트 게이트 ─────────
//
// (a) EvalTrendPanel: EVALS.md 없으면(None) 미렌더 / 기록 없으면 안내 /
//     기록 있으면 스위트별 최신 점수·추이 렌더.
// (b) 플래너 게이트: 검증 일지가 연결되지 않은 항목의 done 전환은 확인을
//     거치고(취소 시 무변경), "검증 없이 완료" 로 무시 가능(소프트). 일지가
//     연결된 항목은 게이트 없이 바로 적용.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

type Dict = Record<string, unknown>;

const EVALS = {
  records: [
    { date: "2026-07-18", suite: "frontend", passed: 6, total: 10, memo: "초기" },
    { date: "2026-07-20", suite: "frontend", passed: 8, total: 10, memo: "개선" },
    { date: "2026-07-19", suite: "backend", passed: 12, total: 12, memo: "" },
  ],
  suites: ["frontend", "backend"],
};

function planItem(over: Dict = {}): Dict {
  return {
    item_id: "it-1",
    phase: "할 일",
    title: "검증 없는 항목",
    status: "in_progress",
    order_idx: 0,
    parent_item: null,
    note: null,
    last_agent: null,
    last_update: null,
    journal_refs: [],
    ...over,
  };
}

const fx = {
  evals: null as Dict | null,
  detail: {} as Dict,
  calls: { applyEdit: [] as unknown[][] },
};

function resetPlanner() {
  fx.detail = {
    plan: {
      plan_id: "p1",
      title: "테스트 플랜",
      status: "active",
      owner_agent: "user",
      progress: 0,
      file_path: ".oculpm/planner/p1.md",
      updated_at: "",
      item_count: 2,
      done_count: 0,
    },
    items: [
      planItem(),
      planItem({ item_id: "it-2", title: "검증 있는 항목", journal_refs: ["journal/20260720/Bugs/x.md"] }),
    ],
    phases: [
      {
        phase_id: null,
        name: "할 일",
        status: "in_progress",
        progress: 0,
        item_count: 2,
        done_count: 0,
        last_agent: null,
        last_update: null,
      },
    ],
    decisions: [],
    warnings: [],
  };
  fx.calls.applyEdit = [];
}

vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "evalSignals":
              return () => ok(fx.evals);
            case "planList":
              return () => ok([fx.detail.plan]);
            case "planGet":
              return () => ok(fx.detail);
            case "planApplyEdit":
              return (...a: unknown[]) => {
                fx.calls.applyEdit.push(a);
                return ok(null);
              };
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { EvalTrendPanel } from "@/features/retro/EvalTrend";
import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";

beforeEach(() => {
  fx.evals = null;
  resetPlanner();
});

afterEach(() => {
  cleanup();
});

describe("EvalTrendPanel (PR-CI6)", () => {
  it("EVALS.md 가 없으면(None) 아무것도 그리지 않는다", async () => {
    const { container } = render(<EvalTrendPanel projectId={1} />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("기록이 비면 run-evals 안내를, 있으면 스위트별 최신 점수를 그린다 + axe", async () => {
    fx.evals = { records: [], suites: [] };
    const first = render(<EvalTrendPanel projectId={1} />);
    await first.findByText(/run-evals/);
    first.unmount();

    fx.evals = EVALS;
    const { container, findByText, getByText } = render(<EvalTrendPanel projectId={1} />);
    await findByText("frontend");
    expect(getByText("backend")).toBeTruthy();
    // 최신(날짜 정렬 마지막) 점수 표기.
    expect(getByText(/8\/10 \(80%\) · 2026-07-20/)).toBeTruthy();
    expect(getByText(/12\/12 \(100%\) · 2026-07-19/)).toBeTruthy();

    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });
});

describe("플래너 완료 소프트 게이트 (PR-CI6)", () => {
  const renderPlanner = () =>
    render(
      <WorkspaceProvider>
        <PlannerScreenV2 projectId={1} onNavigate={() => {}} onOpenJournal={() => {}} />
      </WorkspaceProvider>,
    );

  it("검증 일지 없는 항목의 done 전환은 확인을 거치고, 취소하면 무변경", async () => {
    const { findAllByTitle, getByRole, queryByRole } = renderPlanner();
    // in_progress 글리프(클릭 시 done) 두 개 — 첫 번째가 검증 없는 항목.
    const glyphs = await findAllByTitle(/클릭하여 진행/);
    fireEvent.click(glyphs[0]);

    const dialog = getByRole("dialog", { name: "검증 일지 없이 완료" });
    expect(within(dialog).getByText(/검증 일지가 없습니다/)).toBeTruthy();
    // 게이트 단계에서는 아무 것도 기록되지 않는다.
    expect(fx.calls.applyEdit).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(queryByRole("dialog", { name: "검증 일지 없이 완료" })).toBeNull());
    expect(fx.calls.applyEdit).toHaveLength(0);
  });

  it("'검증 없이 완료' 를 누르면 그대로 진행된다 (소프트 — 강제 아님)", async () => {
    const { findAllByTitle, getByRole } = renderPlanner();
    fireEvent.click((await findAllByTitle(/클릭하여 진행/))[0]);
    const dialog = getByRole("dialog", { name: "검증 일지 없이 완료" });
    fireEvent.click(within(dialog).getByRole("button", { name: "검증 없이 완료" }));

    await waitFor(() => expect(fx.calls.applyEdit).toHaveLength(1));
    const [pid, planId, op] = fx.calls.applyEdit[0] as [number, string, Dict];
    expect([pid, planId]).toEqual([1, "p1"]);
    expect(op).toMatchObject({ kind: "set_status", item_id: "it-1", status: "done" });
  });

  it("검증 일지가 연결된 항목은 게이트 없이 바로 done 이 된다", async () => {
    const { findAllByTitle, queryByRole } = renderPlanner();
    fireEvent.click((await findAllByTitle(/클릭하여 진행/))[1]);

    await waitFor(() => expect(fx.calls.applyEdit).toHaveLength(1));
    expect(queryByRole("dialog", { name: "검증 일지 없이 완료" })).toBeNull();
    const [, , op] = fx.calls.applyEdit[0] as [number, string, Dict];
    expect(op).toMatchObject({ kind: "set_status", item_id: "it-2", status: "done" });
  });
});
