import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-UI 5 — 도구 4 화면 일괄 (Planner / 코드 검색 / 터미널 / AI 패널) ───
//
// Planner + Search wire real backend commands (goalList/subtaskList/
// subtaskToggle, searchChunks), so we cover their data flow + a11y here.
// Terminal (xterm/PTY) and AI panel (chatStream Channel) need a real runtime;
// their unit coverage is limited to a smoke mount under jsdom mocks.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

// Mutable fixtures.
const fx = {
  plans: [] as unknown[],
  planDetail: null as unknown,
  chunks: [] as unknown[],
  symbols: [] as unknown[],
  conversations: [] as unknown[],
  /** v2 U9 — planApplyEdit 응답을 케이스별로 바꿔치기 (지연/에러 시뮬레이션). */
  applyEditImpl: null as null | (() => Promise<unknown>),
  /** 정리 라운드 — 묶어서 보관이 실제로 한 번만 불리는지 본다. */
  bulkCalls: [] as { ids: string[]; status: string }[],
};

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
              return () => ok(fx.planDetail);
            case "planApplyEdit":
              return () => (fx.applyEditImpl ? fx.applyEditImpl() : ok(fx.planDetail));
            case "planItemHistory":
              return () => ok([]);
            case "planSetStatusBulk":
              return (_pid: number, ids: string[], status: string) => {
                fx.bulkCalls.push({ ids, status });
                return ok(ids.length);
              };
            case "planCreate":
              return () => ok(fx.plans[0] ?? planSummary());
            case "searchChunks":
              return () => ok(fx.chunks);
            case "searchText":
              return () => ok(fx.chunks);
            case "searchSymbols":
              return () => ok(fx.symbols);
            case "conversationList":
              return () => ok(fx.conversations);
            case "conversationCreate":
              return () =>
                ok({
                  id: 1,
                  title: "AI 패널",
                  provider: "anthropic",
                  model: null,
                  project_id: 1,
                  created_at: 0,
                  updated_at: 0,
                  last_message_at: null,
                });
            case "chatMessageList":
              return () => ok([]);
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
import { SearchScreenV2 } from "@/features/search/SearchScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";

function wrap(node: React.ReactNode) {
  return (
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>{node}</WorkspaceProvider>
    </SettingsProvider>
  );
}

function planSummary(over: Record<string, unknown> = {}) {
  return {
    plan_id: "rollover",
    title: "롤오버 안정화",
    status: "active",
    owner_agent: "user",
    progress: 0.5,
    file_path: ".oculpm/planner/rollover.md",
    updated_at: "2026-06-07",
    item_count: 2,
    done_count: 1,
    ...over,
  };
}

function planDetail(over: Record<string, unknown> = {}) {
  return {
    plan: planSummary(),
    items: [
      {
        item_id: "tz",
        phase: "Phase A — 기반",
        title: "타임존 계산",
        status: "todo",
        order_idx: 0,
        parent_item: null,
        note: null,
        last_agent: "claude-code",
        last_update: "2026-06-07T10:00:00+09:00",
        journal_refs: ["journal/20260607/Features_to_add/1000_feature_tz.md"],
      },
    ],
    phases: [
      {
        phase_id: "pa",
        name: "Phase A — 기반",
        status: "in_progress",
        progress: 0.5,
        item_count: 1,
        done_count: 0,
        last_agent: "claude-code",
        last_update: "2026-06-07T10:00:00+09:00",
      },
    ],
    decisions: [],
    warnings: [],
    ...over,
  };
}

function chunk(over: Record<string, unknown> = {}) {
  return {
    chunk_id: 1,
    file_path: "src/lib/workday.ts",
    start_line: 42,
    end_line: 58,
    content: "export function rolloverAt() {}",
    distance: 0.1,
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  fx.plans = [];
  fx.planDetail = null;
  fx.chunks = [];
  fx.symbols = [];
  fx.conversations = [];
  fx.applyEditImpl = null;
  fx.bulkCalls = [];
});
afterEach(() => cleanup());

describe("PR-PLN 3 — Planner", () => {
  it("renders plan + items from the backend", async () => {
    fx.plans = [planSummary()];
    fx.planDetail = planDetail();
    const { findByText, findAllByText } = render(
      wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
    );
    // title appears in both the plan pill and the header.
    expect((await findAllByText(/롤오버 안정화/)).length).toBeGreaterThanOrEqual(1);
    expect(await findByText("타임존 계산")).toBeInTheDocument();
  });

  it("empty plans shows the create hint", async () => {
    fx.plans = [];
    const { findByText } = render(wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />));
    expect(await findByText(/아직 계획이 없어요/)).toBeInTheDocument();
  });

  it("계획이 하나뿐이면 레일을 그리지 않는다 (가로폭 낭비 방지)", async () => {
    fx.plans = [planSummary()];
    fx.planDetail = planDetail();
    const { container, findByText } = render(
      wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
    );
    await findByText("타임존 계산");
    expect(container.querySelector(".pln-rail")).toBeNull();
  });

  it("has no axe violations with data", async () => {
    fx.plans = [planSummary()];
    fx.planDetail = planDetail();
    const { container, findByText } = render(
      wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
    );
    await findByText("타임존 계산");
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  // ── 계획 레일 (2026-07-30 스케일 라운드) ──────────────────────────────────
  //
  // 예전 칩 행은 `flex-wrap:wrap` 에 상한이 없어 계획이 늘수록 본문을 접힘선
  // 밖으로 밀어냈고, 검색·정렬·묶기가 없어 '무엇이 남았나' 를 알 수 없었다.
  describe("계획 레일", () => {
    /** 컨트롤 바가 뜨는 임계값(6) 이상으로 계획을 만든다. */
    const manyPlans = () => [
      planSummary({ plan_id: "rollover", title: "롤오버 안정화" }),
      planSummary({ plan_id: "menubar", title: "메뉴바 트레이" }),
      planSummary({ plan_id: "claude-int", title: "Claude 직접 연동" }),
      planSummary({ plan_id: "docs-view", title: "문서 뷰어" }),
      planSummary({ plan_id: "v2-release", title: "v2 릴리스" }),
      planSummary({ plan_id: "retro", title: "회고 화면", status: "done", progress: 1 }),
      planSummary({ plan_id: "legacy", title: "레거시 정리", status: "archived" }),
    ];

    it("계획이 많으면 레일에 모든 계획을 세로로 나열한다", async () => {
      fx.plans = manyPlans();
      fx.planDetail = planDetail();
      const { container, findByText } = render(
        wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
      );
      await findByText("타임존 계산");
      expect(container.querySelector(".pln-rail")).not.toBeNull();
      // 칩 벽은 완전히 사라졌다.
      expect(container.querySelector(".plan-chip-row")).toBeNull();
      // 활성 5개는 펼쳐진 '진행 중' 섹션에 보이고, 완료·보관은 기본 접힘.
      expect(container.querySelectorAll(".pln-row")).toHaveLength(5);
    });

    it("검색어를 넣으면 일치하는 계획만 남는다", async () => {
      fx.plans = manyPlans();
      fx.planDetail = planDetail();
      const { container, findByLabelText } = render(
        wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
      );
      const search = await findByLabelText("계획 검색");
      fireEvent.change(search, { target: { value: "메뉴바" } });
      await waitFor(() => expect(container.querySelectorAll(".pln-row")).toHaveLength(1));
      expect(container.querySelector(".pln-row-title")?.textContent).toBe("메뉴바 트레이");
    });

    it("검색은 기본으로 접혀 있는 완료 계획도 찾아낸다", async () => {
      fx.plans = manyPlans();
      fx.planDetail = planDetail();
      const { container, findByLabelText } = render(
        wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
      );
      const search = await findByLabelText("계획 검색");
      fireEvent.change(search, { target: { value: "회고" } });
      await waitFor(() => expect(container.querySelectorAll(".pln-row")).toHaveLength(1));
    });

    it("섹션 헤더를 누르면 완료 계획이 펼쳐진다", async () => {
      fx.plans = manyPlans();
      fx.planDetail = planDetail();
      const { container, findByText } = render(
        wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
      );
      const doneHead = await findByText("완료");
      expect(container.querySelectorAll(".pln-row")).toHaveLength(5);
      fireEvent.click(doneHead);
      await waitFor(() => expect(container.querySelectorAll(".pln-row")).toHaveLength(6));
    });

    it("활동 기록이 없으면 '멈춤' 을 주장하지 않는다", async () => {
      // planRecentUpdates 목은 ok(null) 을 돌려준다 — updated_at 이 아무리
      // 오래돼도(2026-06-07) 멈춤 배지를 붙이면 거짓말이 된다.
      fx.plans = manyPlans();
      fx.planDetail = planDetail();
      const { container, findByText } = render(
        wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
      );
      await findByText("타임존 계산");
      expect(container.querySelector(".pln-row-stale")).toBeNull();
    });

    /** 완료 계획 n개 — 월이 갈리도록 `updated_at` 을 나눠 준다. */
    const manyDone = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        planSummary({
          plan_id: `done-${i}`,
          title: `끝난 일 ${i}`,
          status: "done",
          progress: 1,
          updated_at: i < 8 ? "2026-08-10" : "2026-07-10",
        }),
      );

    it("완료가 쌓이면 월별로 갈리고, 한 섹션은 상한까지만 그린다", async () => {
      fx.plans = [planSummary(), ...manyDone(14)];
      fx.planDetail = planDetail();
      const { container, findByText } = render(
        wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
      );
      // 월 섹션 두 개 — 최신 달이 위.
      const aug = await findByText("완료 · 2026.08");
      expect(aug).toBeInTheDocument();
      expect(await findByText("완료 · 2026.07")).toBeInTheDocument();
      // 기본은 접힘이라 활성 1개만 보인다.
      expect(container.querySelectorAll(".pln-row")).toHaveLength(1);
    });

    it("한 섹션이 상한을 넘으면 '더 보기' 뒤에 접는다", async () => {
      fx.plans = [planSummary(), ...manyDone(20).map((p) => ({ ...p, updated_at: "2026-08-10" }))];
      fx.planDetail = planDetail();
      const { container, findByText } = render(
        wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
      );
      fireEvent.click(await findByText("완료 · 2026.08"));
      // 활성 1 + 완료 10 (상한).
      await waitFor(() => expect(container.querySelectorAll(".pln-row")).toHaveLength(11));
      fireEvent.click(await findByText("10개 더 보기"));
      await waitFor(() => expect(container.querySelectorAll(".pln-row")).toHaveLength(21));
    });

    it("완료 묶음을 보관으로 — 확인을 거쳐 한 번만 호출한다", async () => {
      fx.plans = [planSummary(), ...manyDone(14)];
      fx.planDetail = planDetail();
      const { findByText, findByLabelText } = render(
        wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
      );
      fireEvent.click(await findByLabelText("이 묶음 8개를 보관으로 옮기기"));
      // 한 번 눌러서는 아무 일도 일어나지 않는다 — 확인이 먼저다.
      expect(fx.bulkCalls).toHaveLength(0);
      fireEvent.click(await findByText("보관"));
      await waitFor(() => expect(fx.bulkCalls).toHaveLength(1));
      expect(fx.bulkCalls[0].status).toBe("archived");
      expect(fx.bulkCalls[0].ids).toHaveLength(8);
    });

    it("레일을 오른쪽으로 옮기면 본문 뒤로 간다", async () => {
      fx.plans = manyPlans();
      fx.planDetail = planDetail();
      const { container, findByText, findByLabelText } = render(
        wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
      );
      await findByText("타임존 계산");
      const kids = () => [...(container.querySelector(".pln-body")?.children ?? [])];
      expect(kids()[0]?.className).toContain("pln-rail-slot");
      fireEvent.click(await findByLabelText("계획 목록 오른쪽으로"));
      await waitFor(() => expect(kids()[0]?.className).toContain("pln-main"));
      expect(container.querySelector(".pln-rail")?.className).toContain("on-right");
    });

    it("리사이저를 키보드로 밀면 폭이 바뀐다", async () => {
      fx.plans = manyPlans();
      fx.planDetail = planDetail();
      const { container, findByText, findByLabelText } = render(
        wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
      );
      await findByText("타임존 계산");
      const slot = () => container.querySelector<HTMLElement>(".pln-rail-slot");
      expect(slot()?.style.width).toBe("236px");
      fireEvent.keyDown(await findByLabelText("계획 목록 폭 조절"), { key: "ArrowRight" });
      await waitFor(() => expect(slot()?.style.width).toBe("252px"));
    });

    it("레일이 있어도 axe 위반이 없다", async () => {
      fx.plans = manyPlans();
      fx.planDetail = planDetail();
      const { container, findByText } = render(
        wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
      );
      await findByText("타임존 계산");
      expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
    });
  });

  it("v2 U9 — 상태 토글이 낙관적으로 즉시 반영된다 (백엔드 응답 전)", async () => {
    fx.plans = [planSummary()];
    fx.planDetail = planDetail();
    fx.applyEditImpl = () => new Promise(() => {}); // 영원히 pending — 응답 없이도 UI 는 변해야 한다
    const { findByText, findByTitle } = render(
      wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
    );
    await findByText("타임존 계산");
    const toggle = await findByTitle(/클릭하여 진행/);
    const glyphBefore = toggle.textContent;
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.textContent).not.toBe(glyphBefore));
  });

  it("v2 U9 — 백엔드 실패 시 이전 상태로 롤백한다", async () => {
    fx.plans = [planSummary()];
    fx.planDetail = planDetail();
    fx.applyEditImpl = () =>
      Promise.resolve({ status: "error" as const, error: "plan write lock" });
    const { findByText, findByTitle } = render(
      wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
    );
    await findByText("타임존 계산");
    const toggle = await findByTitle(/클릭하여 진행/);
    const glyphBefore = toggle.textContent;
    fireEvent.click(toggle);
    // 낙관 반영 → 에러 응답 → 롤백 (최종적으로 원래 글리프).
    await waitFor(() => expect(toggle.textContent).toBe(glyphBefore));
  });
});

describe("PR-UI 5 — Search", () => {
  it("runs semantic search on submit + renders results", async () => {
    fx.chunks = [chunk({ file_path: "src/lib/workday.ts" })];
    const { getByLabelText, findByText } = render(wrap(<SearchScreenV2 projectId={1} projectRoot="/tmp/proj" />));
    const input = getByLabelText("코드 검색");
    fireEvent.change(input, { target: { value: "롤오버" } });
    fireEvent.submit(input.closest("form")!);
    expect(await findByText("src/lib/workday.ts")).toBeInTheDocument();
  });

  it("심볼 scope — 칩 활성 + searchSymbols 결과 렌더 (PR-R1b A2)", async () => {
    fx.symbols = [
      { name: "rolloverAt", kind: "function", file_path: "src/lib/workday.ts", start_line: 42, end_line: 58 },
    ];
    const { container, getByText, getByLabelText, findByText } = render(
      wrap(<SearchScreenV2 projectId={1} projectRoot="/tmp/proj" />),
    );
    expect(getByText("심볼").closest("button")).not.toBeDisabled();
    expect(getByText("정확히 일치").closest("button")).not.toBeDisabled();
    fireEvent.click(getByText("심볼"));
    const input = getByLabelText("코드 검색");
    fireEvent.change(input, { target: { value: "rollover" } });
    fireEvent.submit(input.closest("form")!);
    expect(await findByText(/1개 심볼/)).toBeInTheDocument();
    // 이름은 매치 하이라이트(<mark>)로 쪼개져 렌더된다 — textContent 로 확인.
    await waitFor(() => {
      expect(container.querySelector(".sresult-symrow strong")?.textContent).toBe("rolloverAt");
      expect(container.querySelector(".sresult-symrow mark.s-hit")?.textContent).toBe("rollover");
    });
  });

  it("정확히 일치 scope — searchText 결과 (점수 막대 없음) (PR-R1b A2)", async () => {
    fx.chunks = [chunk({ file_path: "src/lib/exact.ts" })];
    const { getByText, getByLabelText, findByText, container } = render(
      wrap(<SearchScreenV2 projectId={1} projectRoot="/tmp/proj" />),
    );
    fireEvent.click(getByText("정확히 일치"));
    const input = getByLabelText("코드 검색");
    fireEvent.change(input, { target: { value: "rolloverAt" } });
    fireEvent.submit(input.closest("form")!);
    expect(await findByText("src/lib/exact.ts")).toBeInTheDocument();
    expect(await findByText(/개 결과 · 정확히 일치/)).toBeInTheDocument();
    expect(container.querySelector(".score")).toBeNull(); // text mode = no similarity score
  });

  it("empty query shows the hint; no results shows the retry hint", async () => {
    fx.chunks = [];
    const { getByText, getByLabelText, findByText } = render(wrap(<SearchScreenV2 projectId={1} projectRoot="/tmp/proj" />));
    expect(getByText(/검색어를 입력하면/)).toBeInTheDocument();
    const input = getByLabelText("코드 검색");
    fireEvent.change(input, { target: { value: "없는키워드" } });
    fireEvent.submit(input.closest("form")!);
    expect(await findByText(/결과가 없어요/)).toBeInTheDocument();
  });

  it("has no axe violations with results", async () => {
    fx.chunks = [chunk()];
    const { container, getByLabelText, findByText } = render(wrap(<SearchScreenV2 projectId={1} projectRoot="/tmp/proj" />));
    const input = getByLabelText("코드 검색");
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.submit(input.closest("form")!);
    await findByText("src/lib/workday.ts");
    await waitFor(async () =>
      expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]),
    );
  });
});
