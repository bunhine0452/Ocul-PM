import { describe, it, expect, afterEach } from "vitest";

import {
  migrateActiveView,
  migrateV2ToV3,
  migrateSidePanelWidth,
  migrateSidePanelMode,
  pushRecentChange,
  mapFileOpToChangeOp,
  RECENT_CHANGES_CAP,
  SIDE_PANEL_MIN_WIDTH,
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MAX_WIDTH_DIFF,
  SIDE_PANEL_DEFAULT_WIDTH,
  type RecentChange,
} from "@/contexts/WorkspaceContext";
import {
  classifyDiffLines,
  groupIntoHunks,
  pairDiffLines,
  type DiffLine,
} from "@/features/diff/diffParse";
import { effectiveSidePanelMaxWidth } from "@/contexts/WorkspaceContext";
import { WorkspaceProvider, useWorkspace, storageKeyFor } from "@/contexts/WorkspaceContext";
import React from "react";
import { renderHook } from "@testing-library/react";

// ─── Lite-W6 frontend safety net ─────────────────────────────────────────
//
// The original PR0 placeholder block (SC1/SC2/SC3 it.todo tombstones) was for
// a shipped effort and has been removed; the real coverage those scenarios
// stood in for lives in the concrete blocks below.

describe("Lite-W6 PR8 Part 1 — recentChanges buffer", () => {
  it("appends to an empty buffer", () => {
    const out = pushRecentChange([], { path: "src/a.ts", op: "M", ts: 1, read: false });
    expect(out).toEqual([{ path: "src/a.ts", op: "M", ts: 1, read: false }]);
  });

  it("dedupes by path — latest op wins, ordering keeps the new entry last", () => {
    const seed: RecentChange[] = [
      { path: "src/a.ts", op: "A", ts: 1, read: false },
      { path: "src/b.ts", op: "M", ts: 2, read: false },
    ];
    const out = pushRecentChange(seed, { path: "src/a.ts", op: "M", ts: 3, read: false });
    expect(out).toEqual([
      { path: "src/b.ts", op: "M", ts: 2, read: false },
      { path: "src/a.ts", op: "M", ts: 3, read: false },
    ]);
  });

  it("FIFO-trims to RECENT_CHANGES_CAP", () => {
    const seed: RecentChange[] = Array.from({ length: RECENT_CHANGES_CAP }, (_, i) => ({
      path: `src/file-${i}.ts`,
      op: "M" as const,
      ts: i,
      read: false,
    }));
    const out = pushRecentChange(seed, {
      path: "src/new.ts",
      op: "A",
      ts: RECENT_CHANGES_CAP,
      read: false,
    });
    expect(out.length).toBe(RECENT_CHANGES_CAP);
    expect(out[0]?.path).toBe("src/file-1.ts"); // oldest dropped
    expect(out[out.length - 1]?.path).toBe("src/new.ts");
  });

  it("maps FileOp to ChangeOp", () => {
    expect(mapFileOpToChangeOp("create")).toBe("A");
    expect(mapFileOpToChangeOp("delete")).toBe("D");
    expect(mapFileOpToChangeOp("update")).toBe("M");
    expect(mapFileOpToChangeOp("rename")).toBe("M");
    expect(mapFileOpToChangeOp("correct")).toBe("M");
  });
});

describe("Lite-W6 PR8 Part 2 — sidePanelWidth clamp", () => {
  it("preserves in-range integer widths", () => {
    expect(migrateSidePanelWidth(220)).toBe(220);
    expect(migrateSidePanelWidth(400)).toBe(400);
  });

  it("clamps below MIN to MIN", () => {
    expect(migrateSidePanelWidth(SIDE_PANEL_MIN_WIDTH - 50)).toBe(SIDE_PANEL_MIN_WIDTH);
    expect(migrateSidePanelWidth(0)).toBe(SIDE_PANEL_MIN_WIDTH);
    expect(migrateSidePanelWidth(-100)).toBe(SIDE_PANEL_MIN_WIDTH);
  });

  it("clamps above the absolute MAX (diff mode cap) to that cap; per-mode trimming happens at render time", () => {
    // Lite-W6 PR6.5: migration now caps at SIDE_PANEL_MAX_WIDTH_DIFF (1100) so
    // values written while diff mode was active survive a trip through files
    // mode without being silently truncated. SidePanel applies the files-mode
    // 500 px cap at render time via effectiveSidePanelMaxWidth.
    expect(migrateSidePanelWidth(SIDE_PANEL_MAX_WIDTH + 50)).toBe(SIDE_PANEL_MAX_WIDTH + 50);
    expect(migrateSidePanelWidth(SIDE_PANEL_MAX_WIDTH_DIFF + 50)).toBe(SIDE_PANEL_MAX_WIDTH_DIFF);
    expect(migrateSidePanelWidth(99999)).toBe(SIDE_PANEL_MAX_WIDTH_DIFF);
  });

  it("falls back to DEFAULT for non-finite / non-number", () => {
    expect(migrateSidePanelWidth(undefined)).toBe(SIDE_PANEL_DEFAULT_WIDTH);
    expect(migrateSidePanelWidth(null)).toBe(SIDE_PANEL_DEFAULT_WIDTH);
    expect(migrateSidePanelWidth(NaN)).toBe(SIDE_PANEL_DEFAULT_WIDTH);
    expect(migrateSidePanelWidth("260")).toBe(SIDE_PANEL_DEFAULT_WIDTH);
  });

  it("rounds non-integer widths to whole pixels", () => {
    expect(migrateSidePanelWidth(257.4)).toBe(257);
    expect(migrateSidePanelWidth(257.6)).toBe(258);
  });
});

// (PR8 Part 3 FileExplorer 키보드 헬퍼 + PR9 aiOverlayOpen 마이그레이션 커버리지는
//  감사 2026-07-16 에서 제거 — 대상 모듈(fileTreeNav / AI 오버레이)이 은퇴했다.)

describe("Lite-W6 PR6.3 — sidePanelMode migration", () => {
  it("preserves known members", () => {
    expect(migrateSidePanelMode("files")).toBe("files");
    expect(migrateSidePanelMode("diff")).toBe("diff");
  });

  it("falls back to 'files' for unknown / missing / wrong-type values", () => {
    expect(migrateSidePanelMode(undefined)).toBe("files");
    expect(migrateSidePanelMode(null)).toBe("files");
    expect(migrateSidePanelMode("xyz")).toBe("files");
    expect(migrateSidePanelMode(42)).toBe("files");
  });
});

describe("Lite-W6 PR6.3 — classifyDiffLines", () => {
  it("classifies a typical git unified diff", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index abcd..efgh 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      " context line",
      "-old line",
      "+new line",
    ].join("\n");
    const out = classifyDiffLines(patch);
    expect(out.map((l) => l.kind)).toEqual([
      "header",
      "header",
      "header",
      "header",
      "hunk",
      "context",
      "deletion",
      "addition",
    ]);
  });

  it("classifies an empty patch as a single empty context line", () => {
    expect(classifyDiffLines("")).toEqual([{ kind: "context", text: "" }]);
  });

  it("treats lines starting with neither + nor - nor @ as context", () => {
    expect(classifyDiffLines(" unchanged\n no-prefix")).toEqual([
      { kind: "context", text: " unchanged" },
      { kind: "context", text: " no-prefix" },
    ]);
  });
});

describe("Lite-W6 PR6.5 — DiffBody hunk grouping + side-by-side pairing", () => {
  it("groupIntoHunks splits on @@ markers and keeps a preamble for the file header", () => {
    const patch = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,2 @@",
      " line one",
      "-old",
      "+new",
      "@@ -10,1 +10,1 @@",
      " untouched",
    ].join("\n");
    const hunks = groupIntoHunks(classifyDiffLines(patch));
    expect(hunks.length).toBe(3);
    expect(hunks[0].header).toBeNull(); // file-header preamble
    expect(hunks[1].header?.text).toMatch(/^@@ -1,2/);
    expect(hunks[2].header?.text).toMatch(/^@@ -10,1/);
  });

  it("pairDiffLines zips contiguous deletion/addition blocks", () => {
    const lines: DiffLine[] = [
      { kind: "context", text: " ctx" },
      { kind: "deletion", text: "-a" },
      { kind: "deletion", text: "-b" },
      { kind: "addition", text: "+A" },
      { kind: "context", text: " mid" },
    ];
    const rows = pairDiffLines(lines);
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      [" ctx", " ctx"],
      ["-a", "+A"],
      ["-b", null],
      [" mid", " mid"],
    ]);
  });

  it("pairDiffLines emits unpaired additions on the right column only", () => {
    const lines: DiffLine[] = [
      { kind: "addition", text: "+only-add" },
      { kind: "context", text: " ctx" },
    ];
    expect(pairDiffLines(lines)).toEqual([
      { left: null, right: { kind: "addition", text: "+only-add" } },
      { left: { kind: "context", text: " ctx" }, right: { kind: "context", text: " ctx" } },
    ]);
  });

  it("effectiveSidePanelMaxWidth flips diff to 1100, keeps files at 500", () => {
    expect(effectiveSidePanelMaxWidth("files")).toBe(500);
    expect(effectiveSidePanelMaxWidth("diff")).toBe(1100);
  });
});

describe("Lite-W6 PR7 Part 1 — ActiveView migration", () => {
  it("rewrites persisted 'overview' to 'today' (3-IA collapse)", () => {
    expect(migrateActiveView("overview")).toBe("today");
  });

  it("rewrites the long-dead 'changelog' to 'today'", () => {
    expect(migrateActiveView("changelog")).toBe("today");
  });

  it("preserves current union members", () => {
    expect(migrateActiveView("today")).toBe("today");
    expect(migrateActiveView("plan")).toBe("plan");
    expect(migrateActiveView("code")).toBe("code");
  });

  it("defaults unknown / missing values to 'today'", () => {
    expect(migrateActiveView(undefined)).toBe("today");
    expect(migrateActiveView(null)).toBe("today");
    expect(migrateActiveView("settings")).toBe("today");
  });
});

describe("PR-UI 7 — schema v2 → v3 (Code Workbench keys dropped)", () => {
  it("loadFromStorage drops the five legacy keys + bumps schema to 4", () => {
    localStorage.clear();
    localStorage.setItem(
      storageKeyFor(1),
      JSON.stringify({
        schemaVersion: 2,
        activeView: "code",
        codeSubTab: "graph",
        layoutMode: "split",
        splitRatio: 0.7,
        sidePanelOpen: true,
        bottomDrawerTab: "terminal",
        defaultTabUserOverride: true,
      }),
    );
    const { result } = renderHook(() => useWorkspace(), {
      wrapper: ({ children }) =>
        React.createElement(WorkspaceProvider, { projectId: 1, children }),
    });
    const s = result.current.state as unknown as Record<string, unknown>;
    expect(s.schemaVersion).toBe(4);
    expect(s.codeSubTab).toBeUndefined();
    expect(s.layoutMode).toBeUndefined();
    expect(s.splitRatio).toBeUndefined();
    expect(s.sidePanelOpen).toBeUndefined();
    expect(s.bottomDrawerTab).toBeUndefined();
    // activeView is retained (legacy field, kept for compat) — "code" is valid.
    expect(s.activeView).toBe("code");
  });

  it("migrateV2ToV3 only stamps the version (idempotent on v3)", () => {
    const base = { schemaVersion: 2, activeView: "today" } as unknown as Parameters<
      typeof migrateV2ToV3
    >[0];
    expect(migrateV2ToV3(base).schemaVersion).toBe(3);
    const v3 = { ...base, schemaVersion: 3 };
    expect(migrateV2ToV3(v3)).toBe(v3); // returns same ref, no churn
  });
});

// ─── infra smoke ─────────────────────────────────────────────────────────
//
// If this fails, the vitest setup (jsdom env, jest-dom matchers via
// `src/__tests__/setup.ts`) is broken — no point running anything else.

describe("vitest infra smoke", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("jsdom + jest-dom matchers are wired", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    document.body.appendChild(el);
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("hello");
  });
});
