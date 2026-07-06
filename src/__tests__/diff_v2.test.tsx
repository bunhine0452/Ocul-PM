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
          if (prop === "readProjectFile") return () => ok("새 파일 첫 줄\n새 파일 둘째 줄");
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { DiffScreenV2, collapsePlanRefs } from "@/features/diff/DiffScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { recentChangesStore } from "@/lib/recentChangesStore";
import { SettingsProvider } from "@/contexts/SettingsContext";

describe("collapsePlanRefs", () => {
  it("collapses many items of one plan into a single chip (keeps items)", () => {
    const refs = [
      { plan_id: "p1", plan_title: "이오름 리디자인", item_title: "마이페이지" },
      { plan_id: "p1", plan_title: "이오름 리디자인", item_title: "쿠폰" },
      { plan_id: "p1", plan_title: "이오름 리디자인", item_title: "PDF" },
    ];
    const out = collapsePlanRefs(refs);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("이오름 리디자인");
    expect(out[0].items).toEqual(["마이페이지", "쿠폰", "PDF"]);
  });

  it("keeps distinct plans separate, in insertion order", () => {
    const refs = [
      { plan_id: "p1", plan_title: "A", item_title: "a1" },
      { plan_id: "p2", plan_title: "B", item_title: "b1" },
      { plan_id: "p1", plan_title: "A", item_title: "a2" },
    ];
    const out = collapsePlanRefs(refs);
    expect(out.map((p) => p.planId)).toEqual(["p1", "p2"]);
    expect(out[0].items).toEqual(["a1", "a2"]);
  });
});

const STORAGE_KEY = "aipm:workspace:v1";

/** Seed the watcher change buffer (v2 U3 — 세션 휘발 store) + optional
 *  persisted WorkspaceContext fields (diffActivePath 등). */
function seedRecentChanges(
  changes: Array<{ path: string; op: "A" | "M" | "D" }>,
  extra: Record<string, unknown> = {},
) {
  changes.forEach((c, i) => recentChangesStore.push({ ...c, ts: i + 1, read: false }));
  if (Object.keys(extra).length > 0) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(extra));
  }
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

// The diff body now syntax-highlights each line, so a line's text is split
// across marker + highlight.js token spans (e.g. `new` is a TS keyword). Assert
// against the container's textContent instead of a single text node.
async function waitForBody(container: HTMLElement) {
  await waitFor(() => expect(container.textContent).toContain("new line"), BODY_WAIT);
}

beforeEach(() => {
  localStorage.clear();
  recentChangesStore.clear(); // v2 U3 — 모듈 스코프 스토어는 테스트 간 공유된다
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
    const { container } = renderDiff();
    // The +/- lines from GIT_PATCH render as .dl rows (syntax-highlighted, so
    // text is split across spans → assert via container.textContent).
    await waitFor(() => {
      expect(container.textContent).toContain("new line");
      expect(container.textContent).toContain("old line");
    }, BODY_WAIT);
    expect(container.querySelector(".dl.add")).not.toBeNull();
    expect(container.querySelector(".dl.del")).not.toBeNull();
  });

  it("empty recentChanges shows the no-change hint", async () => {
    seedRecentChanges([]);
    const { findByText } = renderDiff();
    expect(await findByText(/이 브랜치엔 아직 변경이 없어요/)).toBeInTheDocument();
  });

  it("통합/분할 toggle switches the body layout", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { getByText, container } = renderDiff();
    await waitForBody(container);
    // Unified by default: rows have 2-col grid (no .split).
    expect(container.querySelector(".dl.split")).toBeNull();
    fireEvent.click(getByText("분할"));
    await waitFor(() => expect(container.querySelector(".dl.split")).not.toBeNull());
  });

  it("'검토 완료' marks the file reviewed (checkmark + disabled)", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { getByText, container } = renderDiff();
    await waitForBody(container);
    const btn = getByText("검토 완료").closest("button")!;
    fireEvent.click(btn);
    await waitFor(() => expect(getByText("검토함")).toBeInTheDocument());
  });

  it("no baseline → renders the whole file as additions (immediate diff)", async () => {
    seedRecentChanges([{ path: "src/c.ts", op: "A" }]);
    diffByPath["src/c.ts"] = {
      path: "src/c.ts",
      source: { source: "snapshots_unavailable" },
    };
    const { findByText } = renderDiff();
    // readProjectFile content shows as additions + the new-file footer, instead
    // of the old "no baseline" dead-end prompt (dogfood fix).
    expect(await findByText(/아직 baseline 이 없는 새 파일/)).toBeInTheDocument();
    expect(await findByText(/새 파일 첫 줄/)).toBeInTheDocument();
  });

  it("v2 U8 — j/k 가 파일 선택을 이동한다 (입력 필드 밖에서만)", async () => {
    seedRecentChanges([
      { path: "src/a.ts", op: "M" },
      { path: "src/b.ts", op: "M" },
    ]);
    const { container } = renderDiff();
    await waitForBody(container);
    // 기본 선택 = 최신 변경(src/b.ts) — 리스트 표시는 최신순이라 첫 행.
    const activeName = () =>
      container.querySelector(".dfile.active .dfile-name")?.textContent;
    expect(activeName()).toBe("src/b.ts");
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(activeName()).toBe("src/a.ts"));
    fireEvent.keyDown(window, { key: "k" });
    await waitFor(() => expect(activeName()).toBe("src/b.ts"));
    // 리스트 경계에서 멈춘다 (순환 없음).
    fireEvent.keyDown(window, { key: "k" });
    expect(activeName()).toBe("src/b.ts");
    // 검색 인풋 포커스 중엔 j/k 무시.
    const input = container.querySelector(".diff-search input") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "j" });
    expect(activeName()).toBe("src/b.ts");
  });

  it("pre-selects the diffActivePath handoff from the journal card", async () => {
    seedRecentChanges(
      [
        { path: "src/a.ts", op: "M" },
        { path: "src/b.ts", op: "A" },
      ],
      { diffActivePath: "src/b.ts" },
    );
    const { container } = renderDiff();
    await waitForBody(container);
    // The active file row is src/b.ts (handoff wins over most-recent default).
    const active = container.querySelector(".dfile.active .dfile-name");
    expect(active?.textContent).toBe("src/b.ts");
  });
});

describe("PR-UI 4 — Diff a11y", () => {
  it("has no axe violations with a diff loaded", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { container } = renderDiff();
    await waitForBody(container);
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});
