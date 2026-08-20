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

const DEFAULT_FILES = [
  { path: "src/lib/workday.ts", op: "update", bytes_added: 120, bytes_removed: 8, rename_from: null },
  { path: "src/lib/useToday.ts", op: "update", bytes_added: 22, bytes_removed: 5, rename_from: null },
];
const DEFAULT_DIFFS = [
  { path: "src/lib/workday.ts", patch: "@@ -1,2 +1,2 @@\n-const old = 1;\n+const neo = 2;\n" },
];

const fixtures: {
  byWorkday: Record<string, ReturnType<typeof summary>[]>;
  /** EntryDetailView 의 변경 파일 목록 (frontmatter.files_touched). */
  filesTouched: typeof DEFAULT_FILES;
  /** 기록된 per-file 패치 — 이 목록에 있는 경로만 열 수 있다. */
  entryDiffs: typeof DEFAULT_DIFFS;
} = {
  byWorkday: {},
  filesTouched: DEFAULT_FILES,
  entryDiffs: DEFAULT_DIFFS,
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
        frontmatter: { files_touched: fixtures.filesTouched },
      }),
    // ManualEntryModalV2 pre-fills candidates from today's file changes.
    getFileChanges: () => Promise.resolve([]),
    createManualEntry: (_pid: number, draft: Record<string, unknown>) => {
      manualMock.calls += 1;
      manualMock.lastDraft = draft;
      return Promise.resolve({ relative_path: "20260531/x/2000_manual.md", title: draft.title });
    },
    // EntryDetailView loads the recorded per-file patches.
    getEntryDiffs: (_pid: number, _relativePath: string) => Promise.resolve(fixtures.entryDiffs),
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

beforeEach(() => {
  // WorkspaceProvider persists its envelope (incl. journalFilter) to the
  // per-project `aipm:workspace:v2:p<id>` localStorage key, so clear it between
  // tests or a chip
  // click in one test leaks into the next. (Allowlisted in
  // scripts/check-no-localstorage.mjs — test-only, same as a11y_screens.)
  localStorage.clear();
  fixtures.byWorkday = {};
  fixtures.filesTouched = DEFAULT_FILES;
  fixtures.entryDiffs = DEFAULT_DIFFS;
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

// ─── 변경 파일 내비게이션 (2026-08-20) ────────────────────────────────────
//
// 파일이 많아지면 오른쪽 pane 상단이 줄바꿈되는 '칩 벽'이 되어 diff 를 밀어
//내고 왼쪽 목록과 같은 내용을 두 번 보여줬다. 칩은 사라지고, 왼쪽 목록이
// 유일한 내비게이션(필터 · j/k), 오른쪽은 한 줄짜리 파일 바가 된다.
describe("작업 일지 디테일 — 변경 파일 내비게이션", () => {
  const manyFiles = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      path: `ioreum/app/api/g${String(i).padStart(2, "0")}/route.ts`,
      op: "update",
      bytes_added: 1,
      bytes_removed: 0,
      rename_from: null,
    }));

  async function openDetail() {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a", title: "검토 대상" })];
    const utils = renderJournal();
    fireEvent.click(await utils.findByText("검토 대상"));
    await waitFor(() => expect(utils.container.querySelector(".entry-filelist")).not.toBeNull());
    return utils;
  }

  const rowsOf = (c: HTMLElement) => c.querySelectorAll(".entry-filelist .dfile");
  const dirOf = (c: HTMLElement) => c.querySelector(".efb-dir")?.textContent;

  it("파일이 많아도 칩 벽 대신 한 줄 파일 바 — 경로 · 위치 · 앞뒤 이동", async () => {
    fixtures.filesTouched = manyFiles(16);
    fixtures.entryDiffs = manyFiles(16).map((f, i) => ({
      path: f.path,
      patch: `@@ -1 +1 @@\n-const v = 0;\n+const v = ${i};\n`,
    }));
    const { container, getByLabelText } = await openDetail();

    // 줄바꿈되던 칩 무더기는 더 이상 렌더되지 않는다.
    expect(container.querySelector(".entry-detail-tabs")).toBeNull();
    expect(container.querySelector(".entry-file-bar")).not.toBeNull();
    expect(container.querySelector(".efb-count")?.textContent).toBe("1/16");
    expect(dirOf(container)).toBe("ioreum/app/api/g00/");
    expect(container.querySelector(".efb-base")?.textContent).toBe("route.ts");

    // 첫 파일에서는 '이전' 이 잠기고, '다음' 은 그 다음 파일을 연다.
    expect(getByLabelText("이전 파일")).toBeDisabled();
    fireEvent.click(getByLabelText("다음 파일"));
    await waitFor(() => expect(dirOf(container)).toBe("ioreum/app/api/g01/"));
    expect(container.querySelector(".efb-count")?.textContent).toBe("2/16");
  });

  it("j/k 로 기록된 파일 사이를 오간다 (변경 diff 화면과 같은 키)", async () => {
    fixtures.filesTouched = manyFiles(3);
    fixtures.entryDiffs = manyFiles(3).map((f, i) => ({
      path: f.path,
      patch: `@@ -1 +1 @@\n-const v = 0;\n+const v = ${i};\n`,
    }));
    const { container } = await openDetail();

    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(dirOf(container)).toBe("ioreum/app/api/g01/"));
    fireEvent.keyDown(window, { key: "k" });
    await waitFor(() => expect(dirOf(container)).toBe("ioreum/app/api/g00/"));
  });

  it("목록이 길면 필터로 좁힌다", async () => {
    fixtures.filesTouched = manyFiles(16);
    fixtures.entryDiffs = manyFiles(16).map((f) => ({ path: f.path, patch: "@@ -1 +1 @@\n-a\n+b\n" }));
    const { container, getByLabelText, getByText } = await openDetail();
    expect(rowsOf(container)).toHaveLength(16);

    fireEvent.change(getByLabelText("파일 찾기"), { target: { value: "g03" } });
    expect(rowsOf(container)).toHaveLength(1);

    fireEvent.change(getByLabelText("파일 찾기"), { target: { value: "없는경로" } });
    expect(rowsOf(container)).toHaveLength(0);
    expect(getByText("일치하는 파일이 없어요.")).toBeInTheDocument();
  });

  it("짧은 목록엔 필터를 띄우지 않는다", async () => {
    const { queryByLabelText } = await openDetail(); // 기본 fixture = 2 files
    expect(queryByLabelText("파일 찾기")).toBeNull();
  });

  it("패치가 없는 파일은 사유 배지 + 선택 불가", async () => {
    const { container } = await openDetail(); // workday.ts 만 기록됨
    const rows = rowsOf(container);
    expect(rows).toHaveLength(2);
    // 경로순 정렬 — useToday.ts(기록없음) 가 먼저, workday.ts 가 뒤.
    expect(rows[0].querySelector(".dfile-note")?.textContent).toBe("기록없음");
    expect(rows[0]).toBeDisabled();
    expect(rows[1].querySelector(".dfile-note")).toBeNull();
    expect(rows[1]).not.toBeDisabled();
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
