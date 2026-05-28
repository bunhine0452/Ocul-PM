import { describe, it, expect, afterEach } from "vitest";

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

  it.todo(
    "SC2: workspace migration drops BottomDrawerTab 'problems' → 'terminal' (enable in PR2 — fallback writer)",
  );

  it.todo(
    "SC3: Watcher event lights FileTree change-dot (enable in PR8 — FileTree redesign)",
  );
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
