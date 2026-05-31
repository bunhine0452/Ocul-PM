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
  goals: [] as unknown[],
  subtasks: {} as Record<number, unknown[]>,
  chunks: [] as unknown[],
  conversations: [] as unknown[],
};

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "goalList":
              return () => ok(fx.goals);
            case "subtaskList":
              return (goalId: number) => ok(fx.subtasks[goalId] ?? []);
            case "subtaskToggle":
              return (id: number) => ok({ id, goal_id: 1, title: "t", done: true, sort_order: 0 });
            case "searchChunks":
              return () => ok(fx.chunks);
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
      <WorkspaceProvider>{node}</WorkspaceProvider>
    </SettingsProvider>
  );
}

function goal(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    project_id: 1,
    title: "롤오버 안정화",
    description: null,
    status: "open",
    priority: 0,
    due_date: null,
    progress: 0.5,
    created_at: 0,
    updated_at: 0,
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
  fx.goals = [];
  fx.subtasks = {};
  fx.chunks = [];
  fx.conversations = [];
});
afterEach(() => cleanup());

describe("PR-UI 5 — Planner", () => {
  it("renders goals + subtasks from the backend", async () => {
    fx.goals = [goal({ id: 1, title: "롤오버 안정화" })];
    fx.subtasks = { 1: [{ id: 11, goal_id: 1, title: "타임존 계산", done: false, sort_order: 0 }] };
    const { findByText } = render(wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />));
    expect(await findByText("롤오버 안정화")).toBeInTheDocument();
    expect(await findByText("타임존 계산")).toBeInTheDocument();
  });

  it("empty goals shows the first-goal hint", async () => {
    fx.goals = [];
    const { findByText } = render(wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />));
    expect(await findByText("첫 목표를 만들어보세요.")).toBeInTheDocument();
  });

  it("has no axe violations with data", async () => {
    fx.goals = [goal()];
    fx.subtasks = { 1: [{ id: 11, goal_id: 1, title: "서브", done: false, sort_order: 0 }] };
    const { container, findByText } = render(
      wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} />),
    );
    await findByText("롤오버 안정화");
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});

describe("PR-UI 5 — Search", () => {
  it("runs semantic search on submit + renders results", async () => {
    fx.chunks = [chunk({ file_path: "src/lib/workday.ts" })];
    const { getByLabelText, findByText } = render(wrap(<SearchScreenV2 projectId={1} />));
    const input = getByLabelText("코드 검색");
    fireEvent.change(input, { target: { value: "롤오버" } });
    fireEvent.submit(input.closest("form")!);
    expect(await findByText("src/lib/workday.ts")).toBeInTheDocument();
  });

  it("symbol / text scope-chips are disabled (only semantic ships)", () => {
    const { getByText } = render(wrap(<SearchScreenV2 projectId={1} />));
    expect(getByText("심볼").closest("button")).toBeDisabled();
    expect(getByText("정확히 일치").closest("button")).toBeDisabled();
    expect(getByText("의미 검색").closest("button")).not.toBeDisabled();
  });

  it("empty query shows the hint; no results shows the retry hint", async () => {
    fx.chunks = [];
    const { getByText, getByLabelText, findByText } = render(wrap(<SearchScreenV2 projectId={1} />));
    expect(getByText(/검색어를 입력하면/)).toBeInTheDocument();
    const input = getByLabelText("코드 검색");
    fireEvent.change(input, { target: { value: "없는키워드" } });
    fireEvent.submit(input.closest("form")!);
    expect(await findByText(/결과가 없어요/)).toBeInTheDocument();
  });

  it("has no axe violations with results", async () => {
    fx.chunks = [chunk()];
    const { container, getByLabelText, findByText } = render(wrap(<SearchScreenV2 projectId={1} />));
    const input = getByLabelText("코드 검색");
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.submit(input.closest("form")!);
    await findByText("src/lib/workday.ts");
    await waitFor(async () =>
      expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]),
    );
  });
});
