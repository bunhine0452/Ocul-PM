import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { EntryFilters, JournalEntrySummary, WorkdayBrief } from "@/lib/bindings";

// ─── review-queue round — 「미검토」 필터 + ReviewQueueBar ────────────────────
//
// `journal_verified.test.tsx` 의 이웃(같은 {#reviewed-hash} 기능군)이지만
// `journal_v2.test.tsx` 는 이미 크기 래칫 턱밑(782줄)이라 여기 형제 파일로 둔다.
// 두 갈래만 본다: (1) 「미검토」 칩이 백엔드 필터 인자를 바꾸고 「확인됨」과
// 상호 배타인가, (2) `ReviewQueueBar` 의 「전부 확인」이 벌크 커맨드를 부르는가.

function summary(over: Partial<JournalEntrySummary> = {}): JournalEntrySummary {
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
    created_at: "2026-05-31T10:00:00+09:00",
    updated_at: null,
    tags: [],
    files_count: 0,
    parse_ok: true,
    parse_warnings: [],
    ...over,
  };
}

const toastMock = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), destructive: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));

// `vi.mock` 팩토리가 직접 참조하므로 hoisted.
const pageMock = vi.hoisted(() => ({
  calls: [] as Array<{ workday: string | undefined; filters: EntryFilters | null | undefined }>,
}));
const bulkMock = vi.hoisted(() => ({
  calls: [] as Array<{ projectId: number; paths: string[]; verified: boolean }>,
}));

vi.mock("@/api/oculpm", () => {
  class MockOculpmApiError extends Error {}
  return {
    OculpmApiError: MockOculpmApiError,
    oculpmApi: {
      listJournalEntries: () => Promise.resolve([]),
      listJournalEntriesPage: (
        _pid: number,
        workday: string | undefined,
        filters: EntryFilters | null | undefined,
      ) => {
        pageMock.calls.push({ workday, filters });
        return Promise.resolve({ entries: [], total: 0 });
      },
      getJournalEntry: () => Promise.resolve(null),
      getEntryDiffs: () => Promise.resolve([]),
      suggestRelated: () => Promise.resolve([]),
      setJournalVerifiedBulk: (projectId: number, paths: string[], verified: boolean) => {
        bulkMock.calls.push({ projectId, paths, verified });
        return Promise.resolve({ updated: paths.length, skipped: [] });
      },
    },
  };
});

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
            days: workdays.map((wd) => ({ workday: wd, entries: [] })) as unknown as WorkdayBrief["days"],
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
      { get: () => ({ listen: () => Promise.resolve(() => {}) }) },
    ),
  };
});

import { JournalScreenV2 } from "@/features/oculpm/JournalScreenV2";
import { ReviewQueueBar } from "@/features/oculpm/ReviewQueueBar";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";

function renderJournal() {
  return render(
    <WorkspaceProvider projectId={1}>
      <JournalScreenV2
        projectId={1}
        todayKey="20260531"
        oculpmReady
        onOpenDiff={() => {}}
        focusPath={null}
        onFocusConsumed={() => {}}
      />
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  pageMock.calls = [];
  bulkMock.calls = [];
  toastMock.info.mockClear();
  toastMock.destructive.mockClear();
});
afterEach(() => cleanup());

describe("「미검토」 칩 — 필터 인자 + 「확인됨」과 상호 배타", () => {
  it("켜면 unverified_only=true·verified_only=false 가 전체 기간 질의로 간다", async () => {
    const { getByText } = renderJournal();
    fireEvent.click(getByText("미검토"));
    await waitFor(() => expect(pageMock.calls.length).toBeGreaterThan(0));
    const last = pageMock.calls[pageMock.calls.length - 1];
    expect(last.filters?.unverified_only).toBe(true);
    expect(last.filters?.verified_only).toBe(false);
  });

  it("「확인됨」을 누르면 「미검토」가 꺼진다 (상호 배타)", async () => {
    const { getByText } = renderJournal();
    fireEvent.click(getByText("미검토"));
    await waitFor(() => expect(pageMock.calls.length).toBeGreaterThan(0));
    pageMock.calls = [];
    fireEvent.click(getByText("확인됨"));
    await waitFor(() => expect(pageMock.calls.length).toBeGreaterThan(0));
    const last = pageMock.calls[pageMock.calls.length - 1];
    expect(last.filters?.verified_only).toBe(true);
    expect(last.filters?.unverified_only).toBe(false);
  });
});

describe("ReviewQueueBar — 「보이는 것 전부 확인」", () => {
  it("확인 안 된 항목의 경로만 벌크로 보내고, 끝나면 onConfirmed 를 부른다", async () => {
    const entries = [
      summary({ relative_path: "a", title: "미확인 A" }),
      summary({ relative_path: "b", title: "미확인 B" }),
      // 필터가 이미 미검토만 남겼어야 정상이지만, 한 틱의 어긋남을 대비해
      // 이미 확인된 항목이 섞여 와도 벌크에 실리지 않아야 한다.
      summary({ relative_path: "c", title: "이미 확인됨", verified_by_user: true }),
    ];
    const onConfirmed = vi.fn();
    const { getByText } = render(
      <ReviewQueueBar projectId={1} total={5} entries={entries} onConfirmed={onConfirmed} />,
    );
    expect(getByText("미검토 5건 · 표시 중 2건")).toBeInTheDocument();
    fireEvent.click(getByText("보이는 것 전부 확인"));
    await waitFor(() =>
      expect(bulkMock.calls).toEqual([{ projectId: 1, paths: ["a", "b"], verified: true }]),
    );
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(toastMock.info).toHaveBeenCalledWith("2건 확인했어요");
  });
});
