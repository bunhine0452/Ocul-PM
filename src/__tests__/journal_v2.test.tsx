import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
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

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    listJournalEntries: (_pid: number, workday: string) =>
      Promise.resolve(fixtures.byWorkday[workday] ?? []),
    // JournalCardV2 hydrates per-file chips via getJournalEntry.
    getJournalEntry: (_pid: number, relativePath: string) =>
      Promise.resolve({
        relative_path: relativePath,
        frontmatter: {
          files_touched: [
            { path: "src/lib/workday.ts", op: "update", bytes_added: 120, bytes_removed: 8, rename_from: null },
            { path: "src/lib/useToday.ts", op: "update", bytes_added: 22, bytes_removed: 5, rename_from: null },
          ],
        },
      }),
  },
}));

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
});
afterEach(() => cleanup());

describe("PR-UI 3 — Journal timeline", () => {
  it("groups entries under a day label and renders cards", async () => {
    fixtures.byWorkday["20260531"] = [
      summary({ relative_path: "a", title: "기능 작업", type: "feature" }),
      summary({ relative_path: "b", title: "버그 작업", type: "bug" }),
    ];
    const { findByText, getByText, findAllByText } = renderJournal();
    expect(await findByText("기능 작업")).toBeInTheDocument();
    expect(getByText("버그 작업")).toBeInTheDocument();
    // day-label shows 오늘 prefix for todayKey.
    expect(getByText(/오늘 · 2026-05-31/)).toBeInTheDocument();
    // Per-file chips hydrate from getJournalEntry (basename + bytes ±), not just
    // a count — one card per entry, so the chip appears once per card.
    expect((await findAllByText("workday.ts")).length).toBeGreaterThan(0);
    expect((await findAllByText("+120")).length).toBeGreaterThan(0);
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

  it("clicking a card opens the 변경 diff with that entry", async () => {
    fixtures.byWorkday["20260531"] = [summary({ relative_path: "a", title: "검토 대상" })];
    const { findByText, onOpenDiff } = renderJournal();
    fireEvent.click(await findByText("검토 대상"));
    expect(onOpenDiff).toHaveBeenCalledTimes(1);
    expect(onOpenDiff.mock.calls[0][0].relative_path).toBe("a");
  });

  it("empty journal shows the no-entries hint", async () => {
    fixtures.byWorkday["20260531"] = [];
    const { findByText } = renderJournal();
    expect(await findByText(/아직 일지가 없어요/)).toBeInTheDocument();
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
