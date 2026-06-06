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
  },
}));

// PR-R1 (A1) — NextTasks pulls Planner subtasks via @/lib/bindings commands.
// Mirrors the `fixtures` pattern above so each test can stage its own goals.
const nextFx: { goals: unknown[]; subtasks: Record<number, unknown[]> } = {
  goals: [],
  subtasks: {},
};

vi.mock("@/lib/bindings", () => ({
  commands: {
    goalList: () => Promise.resolve({ status: "ok", data: nextFx.goals }),
    subtaskList: (goalId: number) =>
      Promise.resolve({ status: "ok", data: nextFx.subtasks[goalId] ?? [] }),
  },
  // WorkspaceProvider registers events.oculpm*.listen on mount; stub no-ops.
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));

function goal(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    project_id: 1,
    title: "로그인 리팩터",
    description: null,
    status: "in_progress",
    priority: 0,
    due_date: null,
    progress: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}
function subtask(over: Partial<Record<string, unknown>> = {}) {
  return { id: 11, goal_id: 1, title: "할 일", done: false, sort_order: 0, ...over };
}

import { TodayScreenV2 } from "@/features/today/TodayScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";

function renderToday(onNavigate = vi.fn()) {
  const utils = render(
    <WorkspaceProvider>
      <TodayScreenV2
        projectId={1}
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
  nextFx.goals = [];
  nextFx.subtasks = {};
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

  it("empty day shows the no-records hint + 터미널 CTA (PR-R2 C2)", async () => {
    fixtures.byWorkday["20260531"] = [];
    const { findByText, getByText, onNavigate } = renderToday();
    expect(await findByText(/오늘 아직 기록이 없어요/)).toBeInTheDocument();
    fireEvent.click(getByText("터미널에서 에이전트 실행"));
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
    expect(within(container).queryByText("Today")).toBeTruthy();
  });
});

describe("PR-R1 (A1) — Today 다음 할 일", () => {
  it("renders incomplete Planner subtasks (done excluded, in-progress pill)", async () => {
    // Non-empty day so the grid (incl. NextTasks) renders.
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a" })];
    nextFx.goals = [goal({ id: 1, title: "로그인 리팩터", status: "in_progress" })];
    nextFx.subtasks = {
      1: [
        subtask({ id: 11, title: "토큰 갱신 처리", done: false, sort_order: 0 }),
        subtask({ id: 12, title: "끝난 일", done: true, sort_order: 1 }),
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
    nextFx.goals = []; // no goals → nothing to do
    const { container, findByText } = renderToday();
    await findByText(/1건/);
    expect(
      within(container).getByText("Planner에서 목표와 다음 할 일을 관리하세요."),
    ).toBeTruthy();
  });
});
