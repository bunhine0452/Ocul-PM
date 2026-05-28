import { describe, it, expect, afterEach } from "vitest";

import {
  migrateActiveView,
  migrateLayoutMode,
  migrateSplitRatio,
} from "@/contexts/WorkspaceContext";

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

  it.todo(
    "SC3: Watcher event lights FileTree change-dot (enable in PR8 — FileTree redesign)",
  );
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
