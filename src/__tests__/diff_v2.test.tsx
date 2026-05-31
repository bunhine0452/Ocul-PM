import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-UI 4 — 변경 diff 전용 화면 ─────────────────────────────────────────
//
// DiffScreenV2 wraps the EXISTING diff pipeline: recentChanges (file list) +
// commands.computeDiff (body) + LocalDiffView's pure parsers (imported
// unchanged). These tests mock computeDiff and seed recentChanges via the
// persisted WorkspaceContext envelope, then assert: file list renders, diff
// body parses, unified/split toggle persists, "검토 완료" pushes diffReadPaths,
// snapshots_unavailable hint, and axe is clean.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

// computeDiff resolves async + the providers hydrate on mount; the first few
// body renders in a cold jsdom worker can exceed the 1000ms findByText default
// (later identical renders are ~30ms). Use a generous timeout for body waits.
const BODY_WAIT = { timeout: 3000 } as const;

const GIT_PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " context line",
  "-old line",
  "+new line",
].join("\n");

// Mutable per-test: which DiffResult computeDiff returns for a path.
const diffByPath: Record<string, unknown> = {};

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "computeDiff")
            return (_pid: number, path: string) =>
              ok(
                diffByPath[path] ?? {
                  path,
                  source: { source: "git", patch: GIT_PATCH },
                },
              );
          if (prop === "openInEditor") return () => ok(null);
          if (prop === "settingsGetAll") return () => ok([] as Array<[string, string]>);
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { DiffScreenV2 } from "@/features/diff/DiffScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";

const STORAGE_KEY = "aipm:workspace:v1";

/** Seed the persisted WorkspaceContext envelope so recentChanges is populated
 *  on first mount (the provider hydrates from this key). */
function seedRecentChanges(
  changes: Array<{ path: string; op: "A" | "M" | "D" }>,
  extra: Record<string, unknown> = {},
) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      recentChanges: changes.map((c) => ({ ...c, ts: 1, read: false })),
      ...extra,
    }),
  );
}

function renderDiff() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider>
        <DiffScreenV2 projectId={1} projectRoot="/tmp/proj" branch="feat/x" />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  for (const k of Object.keys(diffByPath)) delete diffByPath[k];
});
afterEach(() => cleanup());

describe("PR-UI 4 — Diff screen", () => {
  it("renders the changed-file list", async () => {
    seedRecentChanges([
      { path: "src/a.ts", op: "M" },
      { path: "src/b.ts", op: "A" },
    ]);
    const { container, findByText } = renderDiff();
    // src/a.ts only appears in the file list; src/b.ts is auto-selected so it
    // also shows in the diff bar (.fname). Scope to the file list to assert
    // both rows are present unambiguously.
    await findByText("src/a.ts");
    const names = Array.from(
      container.querySelectorAll(".diff-files .dfile-name"),
    ).map((el) => el.textContent);
    expect(names).toContain("src/a.ts");
    expect(names).toContain("src/b.ts");
  });

  it("parses + renders the git diff body for the selected file", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { findByText } = renderDiff();
    // The +/- lines from GIT_PATCH render as .dl rows.
    expect(await findByText("+new line", undefined, BODY_WAIT)).toBeInTheDocument();
    expect(await findByText("-old line", undefined, BODY_WAIT)).toBeInTheDocument();
  });

  it("empty recentChanges shows the no-change hint", async () => {
    seedRecentChanges([]);
    const { findByText } = renderDiff();
    expect(await findByText(/이 브랜치엔 아직 변경이 없어요/)).toBeInTheDocument();
  });

  it("통합/분할 toggle switches the body layout", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { findByText, getByText, container } = renderDiff();
    await findByText("+new line", undefined, BODY_WAIT);
    // Unified by default: rows have 2-col grid (no .split).
    expect(container.querySelector(".dl.split")).toBeNull();
    fireEvent.click(getByText("분할"));
    await waitFor(() => expect(container.querySelector(".dl.split")).not.toBeNull());
  });

  it("'검토 완료' marks the file reviewed (checkmark + disabled)", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { findByText, getByText } = renderDiff();
    await findByText("+new line", undefined, BODY_WAIT);
    const btn = getByText("검토 완료").closest("button")!;
    fireEvent.click(btn);
    await waitFor(() => expect(getByText("검토함")).toBeInTheDocument());
  });

  it("snapshots_unavailable shows the baseline hint", async () => {
    seedRecentChanges([{ path: "src/c.ts", op: "A" }]);
    diffByPath["src/c.ts"] = {
      path: "src/c.ts",
      source: { source: "snapshots_unavailable" },
    };
    const { findByText } = renderDiff();
    expect(await findByText(/아직 baseline 이 없어요/)).toBeInTheDocument();
  });

  it("pre-selects the diffActivePath handoff from the journal card", async () => {
    seedRecentChanges(
      [
        { path: "src/a.ts", op: "M" },
        { path: "src/b.ts", op: "A" },
      ],
      { diffActivePath: "src/b.ts" },
    );
    const { findByText, container } = renderDiff();
    await findByText("+new line", undefined, BODY_WAIT);
    // The active file row is src/b.ts (handoff wins over most-recent default).
    const active = container.querySelector(".dfile.active .dfile-name");
    expect(active?.textContent).toBe("src/b.ts");
  });
});

describe("PR-UI 4 — Diff a11y", () => {
  it("has no axe violations with a diff loaded", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { container, findByText } = renderDiff();
    await findByText("+new line", undefined, BODY_WAIT);
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});
