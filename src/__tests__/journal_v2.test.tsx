import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";
// 타입 전용 — brief mock 을 생성된 DTO 에 `satisfies` 로 못 박는다 (`today_v2.test.tsx` 와 같은 관용구).
import type { WorkdayBrief } from "@/lib/bindings";
import { __setPlatformForTests, type Platform } from "@/lib/platform";

// ─── 작업 일지 (4.0) — 왼쪽 목록 + 오른쪽 상세 ───────────────────────────────
//
// JournalScreenV2 는 평소 최근 14일을 날짜 머리 아래 한 줄씩 보이고, 필터·검색을 걸면 전체 기간으로
// 넓어진다. 오른쪽 상세는 고른 일지의 검증 상자와 인라인 diff 를 놓는다. 이 파일은 화면 단위 —
// 목록·필터·검색·키보드·열기 경로·수동 일지. 상세 한 장의 모양(검증 상자·확인 토글·diff 이동)은
// `journal_verified.test.tsx` 에서 직접 그린다.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
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
    agent_version: null,
    verified_by_user: false,
    verified_stale: false,
    evidence: 2,
    created_at: "2026-05-31T10:00:00+09:00",
    updated_at: null,
    tags: [],
    files_count: 2,
    parse_ok: true,
    parse_warnings: [],
    ...over,
  };
}

const DEFAULT_DIFFS = [
  { path: "src/lib/workday.ts", patch: "@@ -1,2 +1,2 @@\n-const old = 1;\n+const neo = 2;\n" },
];

const fixtures: {
  byWorkday: Record<string, ReturnType<typeof summary>[]>;
  /** 전체 기간 질의(`workday === undefined`)의 결과 — `types` 필터를 실제로 적용해 돌려준다. */
  allPeriod: ReturnType<typeof summary>[];
  /** 상한을 걸기 전 전체 건수. `null` 이면 넘겨준 목록 길이 그대로. */
  allPeriodTotal: number | null;
  /** 검색 히트 (경로는 summaries 에서 푼다). */
  hits: Array<{ relative_path: string; workday: string }>;
  hitsTotal: number | null;
  entryDiffs: typeof DEFAULT_DIFFS;
  planLinks: Array<{ journal_ref: string; plan_id: string; plan_title: string; item_id: string }>;
} = {
  byWorkday: {},
  allPeriod: [],
  allPeriodTotal: null,
  hits: [],
  hitsTotal: null,
  entryDiffs: DEFAULT_DIFFS,
  planLinks: [],
};

/** 워처 이벤트를 테스트가 직접 쏘기 위한 최소 버스 (채널명 → 리스너). */
const eventBus: Record<string, Array<(e: { payload: unknown }) => void>> = {};
function emitOculpm(channel: string, payload: unknown) {
  for (const cb of eventBus[channel] ?? []) cb({ payload });
}

const manualMock: { calls: number; lastDraft: Record<string, unknown> | null } = { calls: 0, lastDraft: null };
const calls = vi.hoisted(() => ({
  search: [] as Array<{ query: string; filters: unknown; limit: unknown }>,
  page: [] as Array<{ filters: unknown; limit: number }>,
  workdayEntries: [] as string[][],
  verified: [] as Array<{ relativePath: string; verified: boolean }>,
}));
const toastMock = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), destructive: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));

vi.mock("@/api/oculpm", () => {
  class MockOculpmApiError extends Error {}
  const all = () => [...Object.values(fixtures.byWorkday).flat(), ...fixtures.allPeriod];
  return {
    OculpmApiError: MockOculpmApiError,
    oculpmApi: {
      listJournalEntries: (_pid: number, workday?: string) =>
        Promise.resolve(workday ? (fixtures.byWorkday[workday] ?? []) : fixtures.allPeriod),
      listJournalEntriesPage: (
        _pid: number,
        _workday: string | undefined,
        filters: { types?: string[] } | undefined,
        limit: number,
      ) => {
        calls.page.push({ filters, limit });
        const types = filters?.types ?? [];
        const rows = fixtures.allPeriod.filter((e) => types.length === 0 || types.includes(e.type as string));
        return Promise.resolve({
          entries: rows.slice(0, limit),
          total: types.length ? rows.length : (fixtures.allPeriodTotal ?? fixtures.allPeriod.length),
        });
      },
      searchJournal: (_pid: number, query: string, filters: unknown, limit: unknown) => {
        calls.search.push({ query, filters, limit });
        return Promise.resolve({
          hits: fixtures.hits.map((h) => ({
            ...h,
            entry_type: "feature",
            status: "done",
            title: "",
            snippet: "",
            matched_field: "title",
            why: "",
            score: 1,
          })),
          total: fixtures.hitsTotal ?? fixtures.hits.length,
        });
      },
      workdayEntries: (_pid: number, workdays: string[]) => {
        calls.workdayEntries.push(workdays);
        return Promise.resolve(all().filter((e) => workdays.includes(e.workday as string)));
      },
      getJournalEntry: (_pid: number, relativePath: string) =>
        Promise.resolve({
          relative_path: relativePath,
          title: "제목",
          body_markdown: "[x] 제목\n\n## 동작 흐름\n무언가를 변경했다\n\n## 검증\n- `pnpm test` → 3 passed\n",
          evidence: 2,
          frontmatter: { files_touched: [], related: [], agent: { id: "claude-code", version: "Opus 5.5" } },
        }),
      getFileChanges: () => Promise.resolve([]),
      createManualEntry: (_pid: number, draft: Record<string, unknown>) => {
        manualMock.calls += 1;
        manualMock.lastDraft = draft;
        return Promise.resolve({ relative_path: "20260531/x/2000_manual.md", title: draft.title });
      },
      getEntryDiffs: () => Promise.resolve(fixtures.entryDiffs),
      suggestRelated: () => Promise.resolve([]),
      setJournalVerified: (_pid: number, relativePath: string, verified: boolean) => {
        calls.verified.push({ relativePath, verified });
        return Promise.resolve(null);
      },
      openEntryInEditor: () => Promise.resolve(null),
      backfillFromGit: () => Promise.resolve({ created: 0, scanned: 0 }),
    },
  };
});
vi.mock("@/api/plan", () => ({ planApi: { journalLinks: () => Promise.resolve(fixtures.planLinks) } }));

// 전체 본문은 <Markdown> 이 SettingsProvider 를 요구한다 — 여기선 글자만 본다.
vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));

// 윈도우 로드(평소 14일)는 단일 workday brief 커맨드. 나머지 bindings 표면(타입·이벤트 등)은 원본 유지.
vi.mock("@/lib/bindings", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/bindings")>();
  return {
    ...orig,
    commands: {
      ...orig.commands,
      oculpmWorkdayBrief: (_pid: number, workdays: string[]) =>
        Promise.resolve({
          status: "ok" as const,
          data: {
            days: workdays.map((wd) => ({ workday: wd, entries: fixtures.byWorkday[wd] ?? [] })) as unknown as WorkdayBrief["days"],
            lines_added: 0,
            lines_removed: 0,
            files_touched: 0,
            open_plan_items: [] as WorkdayBrief["open_plan_items"],
            total_entries: 0,
          } satisfies WorkdayBrief,
        }),
    },
    events: new Proxy(
      {},
      {
        get: (_target, name: string) => ({
          listen: (cb: (e: { payload: unknown }) => void) => {
            (eventBus[name] ??= []).push(cb);
            return Promise.resolve(() => {
              eventBus[name] = (eventBus[name] ?? []).filter((f) => f !== cb);
            });
          },
        }),
      },
    ),
  };
});

import { JournalScreenV2 } from "@/features/oculpm/JournalScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";

function renderJournal(props: Partial<React.ComponentProps<typeof JournalScreenV2>> = {}) {
  const onOpenDiff = vi.fn();
  const onFocusConsumed = vi.fn();
  const utils = render(
    <WorkspaceProvider projectId={1}>
      <JournalScreenV2
        projectId={1}
        todayKey="20260531"
        oculpmReady
        onOpenDiff={onOpenDiff}
        focusPath={null}
        onFocusConsumed={onFocusConsumed}
        {...props}
      />
    </WorkspaceProvider>,
  );
  return { ...utils, onOpenDiff, onFocusConsumed };
}

const rowTitles = (c: HTMLElement) => Array.from(c.querySelectorAll(".jl-item .jl-ti")).map((e) => e.textContent);
const detailTitle = (c: HTMLElement) => c.querySelector(".jd-title")?.textContent;

beforeEach(() => {
  localStorage.clear();
  fixtures.byWorkday = {};
  fixtures.allPeriod = [];
  fixtures.allPeriodTotal = null;
  fixtures.hits = [];
  fixtures.hitsTotal = null;
  fixtures.entryDiffs = DEFAULT_DIFFS;
  fixtures.planLinks = [];
  for (const k of Object.keys(eventBus)) delete eventBus[k];
  manualMock.calls = 0;
  manualMock.lastDraft = null;
  calls.search = [];
  calls.page = [];
  calls.workdayEntries = [];
  calls.verified = [];
  toastMock.info.mockClear();
  toastMock.warning.mockClear();
  toastMock.destructive.mockClear();
});
afterEach(() => cleanup());

describe("작업 일지 — 목록", () => {
  it("날짜 머리 아래 한 줄씩 — 시각 · 에이전트 · 파일 수, 첫 줄이 상세에 열린다", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "20260531/F/1000_a.md", title: "기능 작업", created_at: "2026-05-31T10:00:00+09:00" }),
      summary({ relative_path: "20260531/B/0900_b.md", title: "버그 작업", type: "bug", created_at: "2026-05-31T09:00:00+09:00" }),
    ];
    const { findByText, container, getByText } = renderJournal();
    expect(await findByText("기능 작업")).toBeInTheDocument();
    expect(getByText("오늘 · 5월 31일")).toBeInTheDocument();
    expect(rowTitles(container)).toEqual(["기능 작업", "버그 작업"]);
    // 메타 줄: 시각 · 에이전트 · 파일 수.
    expect(container.querySelector(".jl-item .jl-meta")?.textContent).toBe("10:00 · Claude Code · 파일 2");
    // 가장 위 줄이 자동으로 골라져 상세가 선다.
    await waitFor(() => expect(detailTitle(container)).toBe("기능 작업"));
    expect(container.querySelector('.jl-item[aria-current="true"] .jl-ti')?.textContent).toBe("기능 작업");
  });

  it("「N건 · 전체 M건 중」 은 거를 때만 목록 머리에 — 안 거를 때는 탭 옆 수가 같은 말을 한다", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", title: "하나" }),
      summary({ relative_path: "b", title: "둘" }),
    ];
    fixtures.allPeriod = [summary({ relative_path: "a" }), summary({ relative_path: "b" }), summary({ relative_path: "z" })];
    const { findByText, queryByText } = renderJournal();
    expect(await findByText("하나")).toBeInTheDocument();
    expect(queryByText("2건 · 전체 3건 중")).toBeNull();
  });

  it("종류 필터 — 버그·에러는 전체 기간에서 bug 와 error 를 함께 묻는다", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", title: "기능 작업", type: "feature" }),
      summary({ relative_path: "b", title: "버그 작업", type: "bug" }),
    ];
    fixtures.allPeriod = [
      summary({ relative_path: "a", title: "기능 작업", type: "feature" }),
      summary({ relative_path: "b", title: "버그 작업", type: "bug" }),
      summary({ relative_path: "c", title: "에러 작업", type: "error" }),
    ];
    const { findByText, getByRole, container } = renderJournal();
    await findByText("기능 작업");
    fireEvent.click(getByRole("tab", { name: "버그·에러" }));
    await waitFor(() => expect(rowTitles(container)).toEqual(["버그 작업", "에러 작업"]));
    expect(calls.page[calls.page.length - 1]?.filters).toMatchObject({ types: ["bug", "error"] });
    // 고른 줄이 목록에서 사라졌으니 새 목록의 첫 줄이 상세에 열린다.
    await waitFor(() => expect(detailTitle(container)).toBe("버그 작업"));
  });

  it("「증거 없음」 필터 — 증거를 요구하는 유형에서 명령 증거도 사람 확인도 없는 일지만", async () => {
    const entries = [
      summary({ relative_path: "a", title: "증거 있음", type: "bug", evidence: 2 }),
      summary({ relative_path: "b", title: "증거 없음 기능", type: "feature", evidence: 0 }),
      summary({ relative_path: "c", title: "칸만 있는 결함", type: "bug", evidence: 1 }),
      summary({ relative_path: "d", title: "확인한 리팩토링", type: "refactor", evidence: 0, verified_by_user: true }),
      summary({ relative_path: "e", title: "잡일은 요구 없음", type: "chore", evidence: 0 }),
    ];
    fixtures.byWorkday["20260531"] = entries;
    fixtures.allPeriod = entries;
    const { findByText, getByRole, container } = renderJournal();
    await findByText("증거 있음");
    fireEvent.click(getByRole("tab", { name: "검증 없음" }));
    await waitFor(() => expect(rowTitles(container)).toEqual(["증거 없음 기능", "칸만 있는 결함"]));
    // 목록의 경고 칩도 같은 정의다.
    expect(container.querySelectorAll(".jl-item .chip.warn")).toHaveLength(2);
  });

  it("행의 증거 표시 — 없으면 경고 칩, 명령 증거는 체크", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", title: "증거 없음 기능", type: "feature", evidence: 0 }),
      summary({ relative_path: "b", title: "증거 있는 결함", type: "bug", evidence: 2 }),
    ];
    const { findByText, container } = renderJournal();
    await findByText("증거 없음 기능");
    const rows = container.querySelectorAll(".jl-item");
    expect(rows[0].querySelector(".chip.warn")?.textContent).toBe("검증 없음");
    expect(rows[1].querySelector(".chip.warn")).toBeNull();
    expect(rows[1].querySelector('[role="img"][aria-label="검증 있음"]')).not.toBeNull();
  });

  it("빈 일지는 첫날 안내와 지난 커밋에서 가져오기를 보인다", async () => {
    const { findByText, getByText } = renderJournal();
    expect(await findByText(/아직 일지가 한 건도 없어요/)).toBeInTheDocument();
    expect(getByText("git 히스토리에서 가져오기")).toBeInTheDocument();
  });

  it("최근 창이 비어도 '이전 기록 더 보기' 로 전체 기간에 닿는다", async () => {
    fixtures.byWorkday["20260531"] = [];
    fixtures.allPeriod = [summary({ relative_path: "old", workday: "20260101", title: "예전 일지" })];
    const { findByText, getByText } = renderJournal();
    await findByText(/아직 일지가 한 건도 없어요/);
    fireEvent.click(getByText(/이전 기록 더 보기/));
    expect(await findByText("예전 일지")).toBeInTheDocument();
  });

  it("전체 기간 목록은 상한에 걸리고, 몇 건 중 몇 건인지 말하고, 더 보기로 자란다", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "recent", title: "최근" })];
    fixtures.allPeriod = Array.from({ length: 250 }, (_, i) =>
      summary({ relative_path: `old-${i}`, workday: "20260401", title: `예전 일지 ${i}` }),
    );
    fixtures.allPeriodTotal = 250;
    const { findByText, getByText, queryByText } = renderJournal();
    await findByText("최근");
    fireEvent.click(getByText(/이전 기록 더 보기/));
    expect(await findByText("전체 250건 중 200건 표시")).toBeInTheDocument();
    fireEvent.click(getByText("50건 더 불러오기"));
    await waitFor(() => expect(queryByText(/전체 250건 중 \d+건 표시/)).toBeNull());
  });

  it("한 번에 150줄만 그리고 나머지는 「더 보기」 뒤에 둔다 — 하루 60건 사용자에게도 마운트 수가 건수에 비례하지 않게", async () => {
    fixtures.byWorkday["20260531"] = Array.from({ length: 160 }, (_, i) =>
      summary({ relative_path: `e-${i}`, title: `항목 ${i}`, created_at: `2026-05-31T10:${String(59 - (i % 60)).padStart(2, "0")}:00+09:00` }),
    );
    const { findByText, container, getByText } = renderJournal();
    await findByText("항목 0");
    expect(container.querySelectorAll(".jl-item")).toHaveLength(150);
    fireEvent.click(getByText("10건 더 보기"));
    await waitFor(() => expect(container.querySelectorAll(".jl-item")).toHaveLength(160));
  });
});

describe("작업 일지 — 검색 (이 화면이 일지 검색의 집이다)", () => {
  it("검색어는 디바운스 뒤 일지 검색(제목·파일·태그·본문)으로 가고, 히트를 요약 행으로 풀어 보인다", async () => {
    const a = summary({ relative_path: "20260531/F/1000_a.md", title: "워처 경합" });
    const b = summary({ relative_path: "20260401/B/0900_b.md", workday: "20260401", title: "다른 일", created_at: "2026-04-01T09:00:00+09:00" });
    fixtures.byWorkday["20260531"] = [a];
    fixtures.allPeriod = [a, b, summary({ relative_path: "z" })];
    fixtures.hits = [{ relative_path: a.relative_path, workday: "20260531" }];
    const { findByText, getByLabelText, container } = renderJournal();
    await findByText("워처 경합");
    fireEvent.change(getByLabelText("일지 검색"), { target: { value: "watcher" } });
    await waitFor(() => expect(calls.search).toHaveLength(1), { timeout: 2000 });
    expect(calls.search[0]).toMatchObject({ query: "watcher", limit: 200 });
    // 히트의 날짜들을 한 번에 요약으로 푼다.
    expect(calls.workdayEntries[calls.workdayEntries.length - 1]).toEqual(["20260531"]);
    await waitFor(() => expect(rowTitles(container)).toEqual(["워처 경합"]));
    expect(await findByText("1건 · 전체 3건 중")).toBeInTheDocument();
  });

  it("검색 결과도 같은 종류 필터를 탄다 — 파일 이름으로 찾은 일지가 목록에 선다", async () => {
    const hit = summary({ relative_path: "20260401/B/0900_b.md", workday: "20260401", title: "본문에만 있는 일지", type: "bug", slug: "zzz" });
    fixtures.allPeriod = [hit];
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "recent", title: "최근" })];
    fixtures.hits = [{ relative_path: hit.relative_path, workday: "20260401" }];
    const { findByText, getByLabelText, getByRole, container } = renderJournal();
    await findByText("최근");
    fireEvent.click(getByRole("tab", { name: "버그·에러" }));
    fireEvent.change(getByLabelText("일지 검색"), { target: { value: "watcher.rs" } });
    await waitFor(() => expect(calls.search.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(calls.search[calls.search.length - 1]?.filters).toEqual({ types: ["bug", "error"] });
    await waitFor(() => expect(rowTitles(container)).toEqual(["본문에만 있는 일지"]));
  });

  it("검색어를 지우면 평소 목록으로 돌아온다", async () => {
    const a = summary({ relative_path: "a", title: "하나" });
    fixtures.byWorkday["20260531"] = [a, summary({ relative_path: "b", title: "둘" })];
    fixtures.hits = [{ relative_path: "a", workday: "20260531" }];
    const { findByText, getByLabelText, getByRole, container } = renderJournal();
    await findByText("둘");
    fireEvent.change(getByLabelText("일지 검색"), { target: { value: "하나" } });
    await waitFor(() => expect(rowTitles(container)).toEqual(["하나"]), { timeout: 2000 });
    fireEvent.click(getByRole("button", { name: "검색어 지우기" }));
    await waitFor(() => expect(rowTitles(container)).toEqual(["하나", "둘"]));
  });

  it("검색 결과가 없으면 없다고 말한다", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a", title: "하나" })];
    const { findByText, getByLabelText } = renderJournal();
    await findByText("하나");
    fireEvent.change(getByLabelText("일지 검색"), { target: { value: "없는말" } });
    expect(await findByText(/조건에 맞는 일지가 없어요/, {}, { timeout: 2000 })).toBeInTheDocument();
  });
});

describe("작업 일지 — 키보드와 열기 경로", () => {
  const three = () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", title: "첫째", created_at: "2026-05-31T12:00:00+09:00" }),
      summary({ relative_path: "b", title: "둘째", created_at: "2026-05-31T11:00:00+09:00" }),
      summary({ relative_path: "c", title: "셋째", created_at: "2026-05-31T10:00:00+09:00" }),
    ];
  };

  it("j/k 로 목록을 오가면 상세가 따라온다 — 키는 화면 컨테이너가 듣는다", async () => {
    three();
    const { findByText, container } = renderJournal();
    await findByText("첫째");
    await waitFor(() => expect(detailTitle(container)).toBe("첫째"));
    const split = container.querySelector(".jl-split")!;
    fireEvent.keyDown(split, { key: "j" });
    await waitFor(() => expect(detailTitle(container)).toBe("둘째"));
    fireEvent.keyDown(split, { key: "j" });
    await waitFor(() => expect(detailTitle(container)).toBe("셋째"));
    // 끝에서 멈춘다 (순환 없음).
    fireEvent.keyDown(split, { key: "j" });
    expect(detailTitle(container)).toBe("셋째");
    fireEvent.keyDown(split, { key: "k" });
    await waitFor(() => expect(detailTitle(container)).toBe("둘째"));
    // 전역 keydown 이 아니다 — 창에서 보낸 j 는 아무 일도 하지 않는다.
    fireEvent.keyDown(window, { key: "j" });
    expect(detailTitle(container)).toBe("둘째");
  });

  it("Enter 는 상세로 포커스를 넘기고, / 는 검색칸에 포커스를 준다", async () => {
    three();
    const { findByText, container, getByLabelText } = renderJournal();
    await findByText("첫째");
    await waitFor(() => expect(detailTitle(container)).toBe("첫째"));
    const row = container.querySelectorAll<HTMLElement>(".jl-item")[1];
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(detailTitle(container)).toBe("둘째"));
    expect(document.activeElement).toBe(container.querySelector(".jd"));

    const split = container.querySelector(".jl-split")!;
    fireEvent.keyDown(split, { key: "/" });
    expect(document.activeElement).toBe(getByLabelText("일지 검색"));
    // 검색칸에 있는 동안 j/k 는 글자다.
    fireEvent.keyDown(getByLabelText("일지 검색"), { key: "j" });
    expect(detailTitle(container)).toBe("둘째");
  });

  it("계획의 📓 에서 건너오면 14일 창 밖의 일지도 열고, 「돌아가기」 가 출발 화면으로 보낸다", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "recent", title: "최근" })];
    fixtures.byWorkday["20250101"] = [
      summary({ relative_path: "20250101/Bugs/0900_bug_old.md", workday: "20250101", title: "아주 옛 일지", type: "bug" }),
    ];
    const onOpenEntryConsumed = vi.fn();
    const onReturnToOrigin = vi.fn();
    const { container, findByLabelText } = renderJournal({
      openEntryPath: ".oculpm/journal/20250101/Bugs/0900_bug_old.md",
      onOpenEntryConsumed,
      onReturnToOrigin,
    });
    await waitFor(() => expect(detailTitle(container)).toBe("아주 옛 일지"));
    await waitFor(() => expect(onOpenEntryConsumed).toHaveBeenCalled());
    fireEvent.click(await findByLabelText("목록으로"));
    expect(onReturnToOrigin).toHaveBeenCalled();
  });

  it("Today 에서 건너온 초점은 그 일지를 열고 소비를 알린다", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "20260531/F/1000_a.md", title: "첫째" }),
      summary({ relative_path: "20260531/F/0900_b.md", title: "둘째" }),
    ];
    const { container, onFocusConsumed } = renderJournal({ focusPath: "20260531/F/0900_b.md" });
    await waitFor(() => expect(detailTitle(container)).toBe("둘째"));
    await waitFor(() => expect(onFocusConsumed).toHaveBeenCalled());
  });

  it("열어 둔 일지가 디스크에서 바뀌면 상세의 diff 도 따라 바뀐다", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a", title: "검토 대상" })];
    const { findByText, container } = renderJournal();
    await findByText("검토 대상");
    await waitFor(() => expect(container.textContent).toContain("const neo = 2;"));
    fixtures.entryDiffs = [
      { path: "src/lib/workday.ts", patch: "@@ -1 +1 @@\n-const old = 1;\n+const fresh = 3;\n" },
    ];
    emitOculpm("oculpmJournalUpdated", { project_id: 1, relative_path: "a" });
    await waitFor(() => expect(container.textContent).toContain("const fresh = 3;"), { timeout: 3000 });
  });

  it("상세는 연결된 계획 항목을 메타 줄에 말한다", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "20260531/F/1000_a.md", title: "연결된 일지" })];
    fixtures.planLinks = [
      { journal_ref: ".oculpm/journal/20260531/F/1000_a.md", plan_id: "p", plan_title: "4.0 덜어내기", item_id: "drop-app-llm" },
    ];
    const { container } = renderJournal();
    await waitFor(() => expect(container.querySelector(".jd-meta")?.textContent).toContain("계획 「4.0 덜어내기」 #drop-app-llm"));
  });
});

describe("작업 일지 — 수동 일지 (사람이 직접 남기는 기록)", () => {
  it("'새 일지' → 모달 작성 → createManualEntry 호출 + 모달 닫힘", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a", title: "기존 작업" })];
    const { findByText, getByText, getByLabelText, queryByText } = renderJournal();
    await findByText("기존 작업");
    fireEvent.click(getByText("새 일지"));
    expect(getByText("수동 일지 작성")).toBeInTheDocument();
    fireEvent.change(getByLabelText(/제목/), { target: { value: "수동으로 적은 일" } });
    fireEvent.change(getByLabelText(/slug/), { target: { value: "manual-note" } });
    fireEvent.click(getByText("작성"));
    await waitFor(() => expect(manualMock.calls).toBe(1));
    expect(manualMock.lastDraft?.title).toBe("수동으로 적은 일");
    expect(manualMock.lastDraft?.slug).toBe("manual-note");
    await waitFor(() => expect(queryByText("수동 일지 작성")).toBeNull());
  });

  it("잘못된 slug 는 인라인 에러 + 작성 비활성", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a", title: "기존 작업" })];
    const { findByText, getByText, getByLabelText } = renderJournal();
    await findByText("기존 작업");
    fireEvent.click(getByText("새 일지"));
    fireEvent.change(getByLabelText(/제목/), { target: { value: "제목 있음" } });
    fireEvent.change(getByLabelText(/slug/), { target: { value: "Bad Slug!" } });
    expect(await findByText(/소문자\/숫자\/하이픈만/)).toBeInTheDocument();
    const submit = getByText("작성");
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submit);
    expect(manualMock.calls).toBe(0);
  });
});

// ⌘N = 수동 일지. 비-mac 의 Ctrl+Shift+N 은 새 창이라 열지 않는다(mac 은 예전 그대로).
describe("journal ⌘N — exact modifiers off the mac", () => {
  const rows: Array<[Platform, object, boolean]> = [
    ["mac", { metaKey: true }, true], ["mac", { metaKey: true, shiftKey: true }, true],
    ["windows", { ctrlKey: true }, true], ["windows", { ctrlKey: true, shiftKey: true }, false],
    ["linux", { ctrlKey: true }, true], ["linux", { ctrlKey: true, shiftKey: true }, false],
  ];
  it.each(rows)("%s %o → opens the manual entry: %s", async (os, mods, opens) => {
    __setPlatformForTests(os);
    const { findByText, queryByText } = renderJournal();
    await findByText("새 일지");
    fireEvent.keyDown(document.body, { key: "n", code: "KeyN", ...mods });
    expect(queryByText("수동 일지 작성") !== null).toBe(opens);
  });
});

describe("작업 일지 — a11y", () => {
  it("목록과 상세가 함께 선 화면에 axe 위반이 없다", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", title: "기능 작업", type: "feature", evidence: 0 }),
      summary({ relative_path: "b", title: "에러 작업", type: "error", status: "in_progress" }),
    ];
    const { container, findByText } = renderJournal();
    await findByText("기능 작업");
    await waitFor(() => expect(container.textContent).toContain("const neo = 2;"));
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("수동 일지 모달이 열린 상태에서도 위반이 없다", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a", title: "기존 작업" })];
    const { container, findByText, getByText } = renderJournal();
    await findByText("기존 작업");
    fireEvent.click(getByText("새 일지"));
    expect(getByText("수동 일지 작성")).toBeInTheDocument();
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});
