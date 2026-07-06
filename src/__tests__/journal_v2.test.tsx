import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-UI 3 — 작업 일지 timeline ─────────────────────────────────────────
//
// JournalScreenV2 groups entries by workday and renders the mockup timeline.
// Frontend aggregation over listJournalEntries (Decision F). These tests cover:
// scope-chip filtering, in-page search, focus ring handoff, open-diff nav, and
// axe cleanliness.

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
    verified_by_user: false,
    created_at: "2026-05-31T10:00:00+09:00",
    updated_at: null,
    tags: [],
    files_count: 2,
    ...over,
  };
}

const fixtures: { byWorkday: Record<string, ReturnType<typeof summary>[]> } = {
  byWorkday: {},
};

// PR-R1 (A4) — records the manual-entry create call so the test can assert it.
const manualMock: { calls: number; lastDraft: Record<string, unknown> | null } = {
  calls: 0,
  lastDraft: null,
};

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    listJournalEntries: (_pid: number, workday: string) =>
      Promise.resolve(fixtures.byWorkday[workday] ?? []),
    // EntryDetailView's narrative pane loads body_markdown + files_touched.
    getJournalEntry: (_pid: number, relativePath: string) =>
      Promise.resolve({
        relative_path: relativePath,
        body_markdown: "## 동작 흐름\n- 무언가를 변경했다\n",
        frontmatter: {
          files_touched: [
            { path: "src/lib/workday.ts", op: "update", bytes_added: 120, bytes_removed: 8, rename_from: null },
            { path: "src/lib/useToday.ts", op: "update", bytes_added: 22, bytes_removed: 5, rename_from: null },
          ],
        },
      }),
    // ManualEntryModalV2 pre-fills candidates from today's file changes.
    getFileChanges: () => Promise.resolve([]),
    createManualEntry: (_pid: number, draft: Record<string, unknown>) => {
      manualMock.calls += 1;
      manualMock.lastDraft = draft;
      return Promise.resolve({ relative_path: "20260531/x/2000_manual.md", title: draft.title });
    },
    // EntryDetailView loads the recorded per-file patches.
    getEntryDiffs: (_pid: number, _relativePath: string) =>
      Promise.resolve([
        {
          path: "src/lib/workday.ts",
          patch: "@@ -1,2 +1,2 @@\n-const old = 1;\n+const neo = 2;\n",
        },
      ]),
  },
}));

// EntryDetailView's narrative pane renders <Markdown>, which depends on
// useTheme→useSettings (SettingsProvider). This suite only wraps in
// WorkspaceProvider, so stub Markdown to plain text — the modal assertions
// target the recorded diff + header, not the rendered markdown.
vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));

// v2 U12 — 타임라인 윈도우 로드는 이제 단일 workday brief 커맨드. 나머지
// bindings 표면(타입·이벤트 등)은 원본 유지 (partial mock).
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
            days: workdays.map((wd) => ({
              workday: wd,
              entries: fixtures.byWorkday[wd] ?? [],
            })),
            bytes_added: 0,
            bytes_removed: 0,
            open_plan_items: [],
            total_entries: 0,
          },
        }),
    },
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { JournalScreenV2 } from "@/features/oculpm/JournalScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";

function renderJournal(
  props: Partial<React.ComponentProps<typeof JournalScreenV2>> = {},
) {
  const onOpenDiff = vi.fn();
  const onFocusConsumed = vi.fn();
  const utils = render(
    <WorkspaceProvider>
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

beforeEach(() => {
  // WorkspaceProvider persists its envelope (incl. journalFilter) to the
  // `aipm:workspace:v1` localStorage key, so clear it between tests or a chip
  // click in one test leaks into the next. (Allowlisted in
  // scripts/check-no-localstorage.mjs — test-only, same as a11y_screens.)
  localStorage.clear();
  fixtures.byWorkday = {};
  manualMock.calls = 0;
  manualMock.lastDraft = null;
});
afterEach(() => cleanup());

describe("PR-UI 3 — Journal timeline", () => {
  it("groups entries under a day label and renders cards", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", title: "기능 작업", type: "feature" }),
      summary({ relative_path: "b", title: "버그 작업", type: "bug" }),
    ];
    const { findByText, getByText } = renderJournal();
    expect(await findByText("기능 작업")).toBeInTheDocument();
    expect(getByText("버그 작업")).toBeInTheDocument();
    // day-label shows 오늘 prefix for todayKey.
    expect(getByText(/오늘 · 2026-05-31/)).toBeInTheDocument();
  });

  it("scope-chip filters by trigger type (버그 → only bug entries)", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", title: "기능 작업", type: "feature" }),
      summary({ relative_path: "b", title: "버그 작업", type: "bug" }),
    ];
    const { findByText, getByText, queryByText } = renderJournal();
    await findByText("기능 작업");
    fireEvent.click(getByText("버그")); // scope chip
    expect(getByText("버그 작업")).toBeInTheDocument();
    expect(queryByText("기능 작업")).toBeNull();
  });

  it("in-page search filters by title substring", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", title: "롤오버 구현" }),
      summary({ relative_path: "b", title: "타임라인 수정" }),
    ];
    const { findByText, getByLabelText, getByText, queryByText } = renderJournal();
    await findByText("롤오버 구현");
    fireEvent.change(getByLabelText("일지 검색"), { target: { value: "타임라인" } });
    expect(getByText("타임라인 수정")).toBeInTheDocument();
    expect(queryByText("롤오버 구현")).toBeNull();
  });

  it("clicking a card opens the full-screen 변경 기록 detail view (not the live screen)", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a", title: "검토 대상" })];
    const { container, findByText, findByLabelText, onOpenDiff } = renderJournal();
    fireEvent.click(await findByText("검토 대상"));
    // Detail view renders a back affordance + the recorded patch — not a dialog.
    expect(await findByLabelText("목록으로")).toBeInTheDocument();
    // The patch is syntax-highlighted (text split across spans) → check textContent.
    await waitFor(() => expect(container.textContent).toContain("const neo = 2;"));
    // Card click opens the detail view; it must not fire the live-diff handler.
    expect(onOpenDiff).not.toHaveBeenCalled();
  });

  it("empty journal shows the no-entries hint", async () => {
    fixtures.byWorkday["20260531"] = [];
    const { findByText } = renderJournal();
    expect(await findByText(/아직 일지가 없어요/)).toBeInTheDocument();
  });
});

describe("PR-R1 (A4) — Journal 수동 일지", () => {
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
    // modal closes after a successful create.
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
    expect((getByText("작성") as HTMLButtonElement).disabled).toBe(true);
    expect(manualMock.calls).toBe(0);
  });

  it("모달이 열린 상태에서 axe 위반 0", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a", title: "기존 작업" })];
    const { container, findByText, getByText } = renderJournal();
    await findByText("기존 작업");
    fireEvent.click(getByText("새 일지"));
    expect(getByText("수동 일지 작성")).toBeInTheDocument();
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});

describe("PR-UI 3 — Journal a11y", () => {
  it("has no axe violations with data", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", title: "기능 작업", type: "feature" }),
      summary({ relative_path: "b", title: "에러 작업", type: "error", status: "in_progress" }),
    ];
    const { container, findByText, getByText } = renderJournal();
    await findByText("기능 작업");
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
    expect(getByText("작업 일지")).toBeInTheDocument();
  });
});
