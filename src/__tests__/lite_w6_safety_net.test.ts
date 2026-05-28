import { describe, it, expect, afterEach, beforeEach } from "vitest";

import {
  migrateActiveView,
  migrateBottomDrawerTab,
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

  // SC2 enabled by PR2.
  describe("SC2: workspace migration drops BottomDrawerTab 'problems' → 'terminal'", () => {
    const STORAGE_KEY = "aipm:workspace:v1";

    beforeEach(() => {
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    it("rewrites persisted 'problems' to 'terminal' on read path", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ schemaVersion: 2, bottomDrawerTab: "problems" }),
      );
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(migrateBottomDrawerTab(raw.bottomDrawerTab)).toBe("terminal");
    });

    it("preserves the only valid value ('terminal')", () => {
      // PR5 collapsed the union to a single member.
      expect(migrateBottomDrawerTab("terminal")).toBe("terminal");
    });

    it("defaults all other values to 'terminal'", () => {
      // PR5 retired "git" along with GitPanel.
      expect(migrateBottomDrawerTab("git")).toBe("terminal");
      expect(migrateBottomDrawerTab(undefined)).toBe("terminal");
      expect(migrateBottomDrawerTab(null)).toBe("terminal");
      expect(migrateBottomDrawerTab("changelog")).toBe("terminal");
    });
  });

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
