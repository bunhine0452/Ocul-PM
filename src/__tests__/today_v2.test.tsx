import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, within, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-UI 2 — Today 6-block dashboard ────────────────────────────────────
//
// TodayScreenV2 aggregates the brief on the frontend from listJournalEntries
// (+ getJournalEntry for line counts) — no new backend command (§0.8). These
// tests mock oculpmApi and assert: 4 stat values match the aggregated backend
// response, empty-day shows the hint, nav callbacks fire, and axe is clean.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: {
    "color-contrast": { enabled: false },
    region: { enabled: false },
  },
} as const;

function summary(over: Partial<Record<string, unknown>> = {}) {
  return {
    relative_path: "20260531/Features_to_add/1000_feature_x.md",
    workday: "20260531",
    type: "feature",
    slug: "x",
    status: "done",
    difficulty: null,
    title: "샘플 작업",
    checkbox: null,
    session_id: "20260531-001",
    agent_id: "claude-code",
    verified_by_user: false,
    created_at: "2026-05-31T10:00:00+09:00",
    updated_at: null,
    tags: [],
    files_count: 2,
    ...over,
  };
}

// Mutable fixtures the mock reads, so each test can stage its own data.
const fixtures: {
  byWorkday: Record<string, ReturnType<typeof summary>[]>;
} = { byWorkday: {} };

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    listJournalEntries: (_pid: number, workday: string) =>
      Promise.resolve(fixtures.byWorkday[workday] ?? []),
    getJournalEntry: (_pid: number, relPath: string) =>
      Promise.resolve({
        relative_path: relPath,
        frontmatter: {
          files_touched: [
            { path: "a.ts", op: "update", bytes_added: 10, bytes_removed: 3, rename_from: null },
            { path: "b.ts", op: "create", bytes_added: 5, bytes_removed: 0, rename_from: null },
          ],
        },
      }),
    // code-search round — useTodayMonitor reads sessions for active-time.
    listSessions: () => Promise.resolve([]),
  },
}));

// PR-R1 (A1) — NextTasks pulls Planner subtasks via @/lib/bindings commands.
// Mirrors the `fixtures` pattern above so each test can stage its own goals.
const nextFx: {
  plans: Array<Record<string, unknown>>;
  items: Record<string, Array<Record<string, unknown>>>;
} = {
  plans: [],
  items: {},
};

vi.mock("@/lib/bindings", () => ({
  commands: {
    // v2 U12 — Today/타임라인의 단일 집계 커맨드. fixtures 를 그대로 버킷팅하고
    // bytes 는 구 per-entry 하이드레이션 mock 과 동일한 수치(엔트리당 15/3)로.
    oculpmWorkdayBrief: (_pid: number, workdays: string[], bytesWorkday: string | null) => {
      const todayCount = bytesWorkday ? (fixtures.byWorkday[bytesWorkday] ?? []).length : 0;
      const openItems = nextFx.plans
        .filter((p) => p.status === "active")
        .flatMap((p) =>
          (nextFx.items[p.plan_id as string] ?? [])
            .filter((it) => it.status !== "done")
            .map((it) => ({
              plan_id: p.plan_id,
              plan_title: p.title,
              item_id: it.item_id,
              item_title: it.title,
              phase: it.phase ?? null,
              status: it.status,
            })),
        )
        .sort(
          (a, b) =>
            (b.status === "in_progress" ? 1 : 0) - (a.status === "in_progress" ? 1 : 0),
        );
      return Promise.resolve({
        status: "ok",
        data: {
          days: workdays.map((wd) => ({
            workday: wd,
            entries: fixtures.byWorkday[wd] ?? [],
          })),
          bytes_added: todayCount * 15,
          bytes_removed: todayCount * 3,
          open_plan_items: openItems,
          total_entries: 0,
        },
      });
    },
    planList: () => Promise.resolve({ status: "ok", data: nextFx.plans }),
    planGet: (_pid: number, planId: string) =>
      Promise.resolve({
        status: "ok",
        data: {
          plan: nextFx.plans.find((p) => p.plan_id === planId) ?? null,
          items: nextFx.items[planId] ?? [],
          phases: [],
          decisions: [],
          warnings: [],
        },
      }),
    planRecentUpdates: () => Promise.resolve({ status: "ok", data: [] }),
    // Discussion feature (PR-DISC 4) — Today's "결정 대기" widget.
    discussionList: () => Promise.resolve({ status: "ok", data: [] }),
    // H3b — 일지 없이 끝난 세션 카드 (0건 → 자기은닉).
    journalMissingSignals: () => Promise.resolve({ status: "ok", data: [] }),
    // code-search round — useTodayMonitor reads git + goal stats.
    gitHeadStatusBrief: () =>
      Promise.resolve({ status: "ok", data: { is_git_repo: false, head_branch: null, uncommitted: 0 } }),
    gitLog: () => Promise.resolve({ status: "ok", data: [] }),
    gitGraph: () => Promise.resolve({ status: "ok", data: [] }),
    gitStatus: () =>
      Promise.resolve({ status: "ok", data: { is_git_repo: false, head_branch: null, remotes: [] } }),
  },
  // WorkspaceProvider registers events.oculpm*.listen on mount; stub no-ops.
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));

// planner-unify (2026-06-22): Today 다음 할 일 now reads the file-based plan
// (plan_list/plan_get), so stage PlanSummary + PlanItemDto shapes.
function planSummary(over: Partial<Record<string, unknown>> = {}) {
  return {
    plan_id: "p1",
    title: "로그인 리팩터",
    status: "active",
    owner_agent: "user",
    progress: 0,
    file_path: ".oculpm/planner/p1.md",
    updated_at: "",
    item_count: 1,
    done_count: 0,
    ...over,
  };
}
function planItem(over: Partial<Record<string, unknown>> = {}) {
  return {
    item_id: "i1",
    phase: null,
    title: "할 일",
    status: "todo",
    order_idx: 0,
    parent_item: null,
    note: null,
    last_agent: null,
    last_update: null,
    journal_refs: [],
    ...over,
  };
}

import { TodayScreenV2 } from "@/features/today/TodayScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";

function renderToday(onNavigate = vi.fn()) {
  const utils = render(
    <WorkspaceProvider projectId={1}>
      <TodayScreenV2
        projectId={1}
        projectRoot="/tmp/proj"
        workday="20260531"
        oculpmReady
        onNavigate={onNavigate}
        dateLabel="2026년 5월 31일 (일)"
        tz="Asia/Seoul"
      />
    </WorkspaceProvider>,
  );
  return { ...utils, onNavigate };
}

/** Read a stat card's value by its label (stat structure: .stat > .stat-top
 *  (label) + .stat-val (value)). Returns the .stat-val text. */
function statValue(container: HTMLElement, label: string): string {
  const labels = Array.from(container.querySelectorAll(".stat-top"));
  const top = labels.find((el) => el.textContent?.includes(label));
  const card = top?.closest(".stat");
  return card?.querySelector(".stat-val")?.textContent ?? "";
}

afterEach(() => {
  cleanup();
  nextFx.plans = [];
  nextFx.items = {};
});

describe("PR-UI 2 — Today stat aggregation", () => {
  it("4 stat values reflect the aggregated backend response", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", type: "feature", agent_id: "claude-code", files_count: 2 }),
      summary({ relative_path: "b", type: "error", agent_id: "cursor", files_count: 3 }),
      summary({ relative_path: "c", type: "chore", agent_id: "claude-code", files_count: 1 }),
    ];
    const { container, findByText } = renderToday();

    // Hero count appears once the brief resolves.
    await findByText(/3건/);

    expect(statValue(container, "기록된 작업")).toBe("3건"); // entries
    expect(statValue(container, "변경된 파일")).toBe("6개"); // 2+3+1
    expect(statValue(container, "에러 사이클")).toBe("1회"); // one error
    expect(statValue(container, "참여 에이전트")).toBe("2개"); // claude-code, cursor
  });

  it("empty day shows the no-records hint + 빠른 터미널 카드 (PR-R2 C2 / icon round)", async () => {
    fixtures.byWorkday["20260531"] = [];
    const { findByText, getByText, onNavigate } = renderToday();
    expect(await findByText(/오늘 아직 기록이 없어요/)).toBeInTheDocument();
    // "여기서 에이전트 실행" 은 인라인 터미널을 열고(런타임 필요 — 여기선 미클릭),
    // "전체 터미널" 은 터미널 화면으로 핸드오프.
    expect(getByText("여기서 에이전트 실행")).toBeInTheDocument();
    fireEvent.click(getByText(/전체 터미널/));
    expect(onNavigate).toHaveBeenCalledWith("terminal");
  });
});

describe("PR-UI 2 — Today navigation", () => {
  it("'오늘 변경 검토' navigates to diff", () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a" })];
    const { getByText, onNavigate } = renderToday();
    // The hero primary button is rendered immediately (independent of the brief).
    fireEvent.click(getByText("오늘 변경 검토"));
    expect(onNavigate).toHaveBeenCalledWith("diff");
  });

  it("'전체 일지' + 코드 검색 box navigate", () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a" })];
    const { getByText, onNavigate } = renderToday();
    fireEvent.click(getByText("전체 일지"));
    expect(onNavigate).toHaveBeenCalledWith("journal");
    fireEvent.click(getByText("코드 검색…"));
    expect(onNavigate).toHaveBeenCalledWith("search");
  });

  it("clicking a highlight MiniEntry navigates to journal", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a", title: "하이라이트 작업" })];
    const { findByText, onNavigate } = renderToday();
    const row = await findByText("하이라이트 작업");
    fireEvent.click(row);
    expect(onNavigate).toHaveBeenCalledWith("journal");
  });
});

describe("PR-UI 2 — Today a11y", () => {
  it("has no axe violations with data", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", type: "feature" }),
      summary({ relative_path: "b", type: "error" }),
    ];
    const { container, findByText } = renderToday();
    await findByText(/2건/);
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
    // sanity: `within` import is exercised so lint doesn't flag it unused.
    expect(within(container).queryByText("오늘 현황")).toBeTruthy();
  });
});

describe("PR-R1 (A1) — Today 다음 할 일", () => {
  it("renders incomplete Planner subtasks (done excluded, in-progress pill)", async () => {
    // Non-empty day so the grid (incl. NextTasks) renders.
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a" })];
    nextFx.plans = [
      planSummary({ plan_id: "p1", title: "로그인 리팩터", item_count: 2, done_count: 1 }),
    ];
    nextFx.items = {
      p1: [
        planItem({ item_id: "i1", title: "토큰 갱신 처리", status: "in_progress", order_idx: 0 }),
        planItem({ item_id: "i2", title: "끝난 일", status: "done", order_idx: 1 }),
      ],
    };
    const { container } = renderToday();

    const title = await waitFor(() => {
      const el = container.querySelector(".next-title");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(title.textContent).toBe("토큰 갱신 처리");
    expect(container.textContent).toContain("로그인 리팩터"); // goal context
    expect(container.textContent).not.toContain("끝난 일"); // done excluded
    expect(container.querySelector(".sub-active-pill")).toBeTruthy(); // in_progress
    // a11y holds with the wired next-item buttons present.
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("falls back to the empty hint when no open subtasks", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a" })];
    nextFx.plans = []; // no plans → nothing to do
    const { container, findByText } = renderToday();
    await findByText(/1건/);
    expect(
      within(container).getByText("Planner에서 목표와 다음 할 일을 관리하세요."),
    ).toBeTruthy();
  });
});

describe("Today 2단 균형 — 짧은 열 아래 빈 배경", () => {
  // 오른쪽 열이 주간+에이전트+다음 할 일로 늘 길어 왼쪽 열 아래로 페이지
  // 배경이 드러났다. 에이전트 카드를 "오늘" 묶음(왼쪽)으로 옮기고, 남는
  // 높이는 각 열의 마지막 카드가 흡수한다(.grid-2-fill).
  it("에이전트 카드가 왼쪽 열에, 주간/다음 할 일이 오른쪽 열에 놓인다", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a" })];
    const { container, findByText } = renderToday();
    await findByText(/1건/);

    const grid = container.querySelector(".grid-2");
    expect(grid?.classList.contains("grid-2-fill")).toBe(true);

    const cols = Array.from(container.querySelectorAll(".g2col"));
    expect(cols).toHaveLength(2);
    const [left, right] = cols as HTMLElement[];

    expect(left.textContent).toContain("오늘의 하이라이트");
    expect(left.textContent).toContain("에이전트별 기여");
    expect(left.textContent).toContain("어제 마무리한 작업");
    expect(right.textContent).toContain("이번 주 작업량");
    expect(right.textContent).toContain("다음 할 일");
    expect(right.textContent).not.toContain("에이전트별 기여");
  });

  it("각 열의 마지막 카드가 남는 높이를 흡수한다 (직계 .card 로 끝난다)", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a" })];
    const { container, findByText } = renderToday();
    await findByText(/1건/);

    // CSS 규칙은 `.g2col > .card:last-child` 를 늘린다 — 열의 마지막 직계
    // 자식이 실제로 카드여야 규칙이 걸린다 (래퍼가 끼면 무효).
    for (const col of Array.from(container.querySelectorAll(".g2col"))) {
      expect(col.lastElementChild?.classList.contains("card")).toBe(true);
    }
  });
});
