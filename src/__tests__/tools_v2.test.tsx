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

import { SearchScreenV2 } from "@/features/search/SearchScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { __setPlatformForTests, type Platform } from "@/lib/platform";

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

// 계획 화면의 동작 테스트는 4.0 재설계와 함께 planner_v4.test.tsx 로 옮겼다.

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

// {#ui-shortcut-shift-exact} — 검색의 ⌘N 은 질의 지우기. 비-mac 의 Ctrl+Shift+N(새 창)은
// 지우지 않는다. mac 은 예전 식 그대로(⌘⇧N 도 지운다 — 실제로는 메뉴가 먼저 받는다).
describe("Search ⌘N — exact modifiers off the mac", () => {
  const rows: Array<[Platform, object, boolean]> = [
    ["mac", { metaKey: true }, true],
    ["mac", { metaKey: true, shiftKey: true }, true],
    ["windows", { ctrlKey: true }, true],
    ["windows", { ctrlKey: true, shiftKey: true }, false],
    ["windows", { ctrlKey: true, altKey: true }, false],
    ["linux", { ctrlKey: true }, true],
    ["linux", { ctrlKey: true, shiftKey: true }, false],
  ];
  it.each(rows)("%s %o → clears the query: %s", (os, mods, clears) => {
    __setPlatformForTests(os);
    const { getByLabelText } = render(wrap(<SearchScreenV2 projectId={1} projectRoot="/tmp/proj" />));
    const input = getByLabelText("코드 검색") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "롤오버" } });
    fireEvent.keyDown(document.body, { key: "n", code: "KeyN", ...mods });
    expect(input.value).toBe(clears ? "" : "롤오버");
  });
});
