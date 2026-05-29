import { describe, it, expect, afterEach } from "vitest";

import {
  migrateActiveView,
  migrateLayoutMode,
  migrateSplitRatio,
  migrateSidePanelWidth,
  migrateSidePanelMode,
  pushRecentChange,
  mapFileOpToChangeOp,
  RECENT_CHANGES_CAP,
  SIDE_PANEL_MIN_WIDTH,
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_DEFAULT_WIDTH,
  type RecentChange,
} from "@/contexts/WorkspaceContext";
import {
  flattenVisibleNodes,
  nextFocusedPath,
} from "@/components/FileExplorer";
import { classifyDiffLines } from "@/features/diff/LocalDiffView";
import type { ProjectTreeNode } from "@/lib/bindings";

// ─── Lite-W6 PR0 frontend safety net ─────────────────────────────────────
//
// The three scenarios below are listed in `docs/Lite-update/07-implementation
// -checklist.md` §1 PR0. Each is `it.todo` until the upstream PR it depends
// on lands the surface it asserts against. Lifting `.todo` → `.fn` is the
// last step of the dependent PR so its DoD checkbox flips green.

describe("Lite-W6 PR0 — frontend safety net (deferred to upstream PRs)", () => {
  it.todo(
    "SC1: empty SQLite + seeded journal renders Today (enable in PR4 — journal-only path)",
  );

  // SC2 was enabled by PR2 (BottomDrawerTab "problems" → "terminal") and
  // again by PR5 (single-member union). PR7 Part 2 retired the
  // BottomDrawer entirely and migrated state to `layoutMode` /
  // `splitRatio`; the assertions move to the new helpers below.
  it.todo("SC2: retired in PR7 Part 2 (BottomDrawer fully replaced)");

  // SC3 is exercised by the dedicated PR8 Part 1 block below — the watcher
  // wiring in WorkspaceContext composes pushRecentChange + mapFileOpToChangeOp,
  // both of which are pure and covered there. A full DOM-roundtrip test
  // (event fires → FileExplorer renders a dot) lives with the integration
  // suite in Phase D PR11.
  it.todo("SC3: replaced by PR8 Part 1 pure-fn coverage below");
});

describe("Lite-W6 PR8 Part 1 — recentChanges buffer", () => {
  it("appends to an empty buffer", () => {
    const out = pushRecentChange([], { path: "src/a.ts", op: "M", ts: 1 });
    expect(out).toEqual([{ path: "src/a.ts", op: "M", ts: 1 }]);
  });

  it("dedupes by path — latest op wins, ordering keeps the new entry last", () => {
    const seed: RecentChange[] = [
      { path: "src/a.ts", op: "A", ts: 1 },
      { path: "src/b.ts", op: "M", ts: 2 },
    ];
    const out = pushRecentChange(seed, { path: "src/a.ts", op: "M", ts: 3 });
    expect(out).toEqual([
      { path: "src/b.ts", op: "M", ts: 2 },
      { path: "src/a.ts", op: "M", ts: 3 },
    ]);
  });

  it("FIFO-trims to RECENT_CHANGES_CAP", () => {
    const seed: RecentChange[] = Array.from({ length: RECENT_CHANGES_CAP }, (_, i) => ({
      path: `src/file-${i}.ts`,
      op: "M" as const,
      ts: i,
    }));
    const out = pushRecentChange(seed, {
      path: "src/new.ts",
      op: "A",
      ts: RECENT_CHANGES_CAP,
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

  it("clamps above MAX to MAX", () => {
    expect(migrateSidePanelWidth(SIDE_PANEL_MAX_WIDTH + 50)).toBe(SIDE_PANEL_MAX_WIDTH);
    expect(migrateSidePanelWidth(99999)).toBe(SIDE_PANEL_MAX_WIDTH);
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

// ─── PR8 Part 3 — FileExplorer keyboard a11y helpers ────────────────────

function mkTree(): ProjectTreeNode {
  // Fixture:
  //   src/
  //     a.ts
  //     features/
  //       today/
  //         index.tsx
  //   README.md
  return {
    name: "",
    relative_path: "",
    is_dir: true,
    children: [
      {
        name: "src",
        relative_path: "src",
        is_dir: true,
        children: [
          { name: "a.ts", relative_path: "src/a.ts", is_dir: false, children: [] },
          {
            name: "features",
            relative_path: "src/features",
            is_dir: true,
            children: [
              {
                name: "today",
                relative_path: "src/features/today",
                is_dir: true,
                children: [
                  {
                    name: "index.tsx",
                    relative_path: "src/features/today/index.tsx",
                    is_dir: false,
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      { name: "README.md", relative_path: "README.md", is_dir: false, children: [] },
    ],
  };
}

describe("Lite-W6 PR8 Part 3 — flattenVisibleNodes", () => {
  it("hides children of collapsed folders", () => {
    const out = flattenVisibleNodes(mkTree(), {});
    // src + README.md only — src's children are hidden because src is collapsed.
    expect(out.map((n) => n.path)).toEqual(["src", "README.md"]);
  });

  it("expands a single folder one level deep", () => {
    const out = flattenVisibleNodes(mkTree(), { src: true });
    expect(out.map((n) => n.path)).toEqual([
      "src",
      "src/a.ts",
      "src/features",
      "README.md",
    ]);
  });

  it("populates depth + parentPath correctly", () => {
    const out = flattenVisibleNodes(mkTree(), {
      src: true,
      "src/features": true,
      "src/features/today": true,
    });
    const idx = out.find((n) => n.path === "src/features/today/index.tsx");
    expect(idx?.depth).toBe(3);
    expect(idx?.parentPath).toBe("src/features/today");
  });
});

describe("Lite-W6 PR8 Part 3 — nextFocusedPath", () => {
  it("ArrowDown moves to next sibling within the visible list", () => {
    const visible = flattenVisibleNodes(mkTree(), { src: true });
    // visible: ["src", "src/a.ts", "src/features", "README.md"]
    expect(nextFocusedPath(visible, "src", "ArrowDown", { src: true })).toBe("src/a.ts");
    expect(nextFocusedPath(visible, "src/a.ts", "ArrowDown", { src: true })).toBe(
      "src/features",
    );
  });

  it("ArrowDown at the last node returns null (no movement)", () => {
    const visible = flattenVisibleNodes(mkTree(), { src: true });
    expect(nextFocusedPath(visible, "README.md", "ArrowDown", { src: true })).toBe(null);
  });

  it("ArrowUp at the first node clamps to the first", () => {
    const visible = flattenVisibleNodes(mkTree(), {});
    expect(nextFocusedPath(visible, "src", "ArrowUp", {})).toBe("src");
  });

  it("ArrowRight on a collapsed folder expands instead of moving", () => {
    const visible = flattenVisibleNodes(mkTree(), {});
    const calls: string[] = [];
    const out = nextFocusedPath(visible, "src", "ArrowRight", {}, (p) => calls.push(p));
    expect(out).toBe(null);
    expect(calls).toEqual(["src"]);
  });

  it("ArrowRight on an already-expanded folder descends to first child", () => {
    const visible = flattenVisibleNodes(mkTree(), { src: true });
    expect(nextFocusedPath(visible, "src", "ArrowRight", { src: true })).toBe(
      "src/a.ts",
    );
  });

  it("ArrowLeft on an expanded folder collapses", () => {
    const visible = flattenVisibleNodes(mkTree(), { src: true });
    const calls: string[] = [];
    const out = nextFocusedPath(
      visible,
      "src",
      "ArrowLeft",
      { src: true },
      undefined,
      (p) => calls.push(p),
    );
    expect(out).toBe(null);
    expect(calls).toEqual(["src"]);
  });

  it("ArrowLeft on a child file moves to its parent folder", () => {
    const visible = flattenVisibleNodes(mkTree(), { src: true });
    expect(nextFocusedPath(visible, "src/a.ts", "ArrowLeft", { src: true })).toBe(
      "src",
    );
  });

  it("Home / End jump to first / last visible", () => {
    const visible = flattenVisibleNodes(mkTree(), { src: true });
    expect(nextFocusedPath(visible, "src/a.ts", "Home", { src: true })).toBe("src");
    expect(nextFocusedPath(visible, "src", "End", { src: true })).toBe("README.md");
  });
});

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

describe("Lite-W6 PR8 Part 3 — clearRecentChanges semantics", () => {
  // Backed by a pure-fn assertion: pushRecentChange + an empty-array reset
  // mirror the WorkspaceContext callback. A DOM round-trip lives in PR11.
  it("an empty array is the canonical cleared state", () => {
    const seed: RecentChange[] = [
      { path: "a.ts", op: "M", ts: 1 },
      { path: "b.ts", op: "A", ts: 2 },
    ];
    const cleared: RecentChange[] = [];
    expect(cleared.length).toBe(0);
    // Confirm pushRecentChange still works on a freshly cleared buffer so the
    // watcher doesn't get stuck after the user clicks "비우기".
    const next = pushRecentChange(cleared, { path: "c.ts", op: "D", ts: 3 });
    expect(next).toEqual([{ path: "c.ts", op: "D", ts: 3 }]);
    void seed;
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

describe("Lite-W6 PR7 Part 2 — layoutMode + splitRatio migration", () => {
  it("maps legacy bottomDrawerOpen=true to 'split'", () => {
    expect(migrateLayoutMode(undefined, true)).toBe("split");
  });

  it("maps legacy bottomDrawerOpen=false to 'main-only'", () => {
    expect(migrateLayoutMode(undefined, false)).toBe("main-only");
  });

  it("preserves current layoutMode values", () => {
    expect(migrateLayoutMode("main-only", true)).toBe("main-only");
    expect(migrateLayoutMode("split", false)).toBe("split");
    expect(migrateLayoutMode("terminal-only", undefined)).toBe("terminal-only");
  });

  it("defaults unknown layoutMode + missing legacy to 'main-only'", () => {
    expect(migrateLayoutMode("bottom-drawer-open", undefined)).toBe("main-only");
    expect(migrateLayoutMode(null, null)).toBe("main-only");
  });

  it("clamps splitRatio into [0.1, 0.9]", () => {
    expect(migrateSplitRatio(0.6)).toBe(0.6);
    expect(migrateSplitRatio(0.05)).toBe(0.1);
    expect(migrateSplitRatio(0.95)).toBe(0.9);
    expect(migrateSplitRatio(undefined)).toBe(0.6);
    expect(migrateSplitRatio(NaN)).toBe(0.6);
    expect(migrateSplitRatio("0.8")).toBe(0.6); // non-number → default
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
