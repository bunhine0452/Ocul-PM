import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "listProjects") return () => ok([]);
        if (prop === "goalList") return () => ok([]);
        if (prop === "subtaskList") return () => ok([]);
        if (prop === "settingsGetAll") return () => ok([] as Array<[string, string]>);
        if (prop === "dbHealth")
          return () => ok({ db_path: "", schema_version: 0, page_count: 0, integrity_ok: true });
        if (prop === "appInfo") return () => ok({ name: "ocul-pm", version: "0.0.0" });
        if (prop === "secretHas") return () => ok(false);
        return () => ok(null);
      },
    }),
    events: new Proxy({}, {
      get: () => ({ listen: () => Promise.resolve(() => {}) }),
    }),
  };
});

vi.mock("@/api/oculpm", () => ({
  oculpmApi: new Proxy({}, {
    get: () => async () => ({ entries: [], sessions: [] }),
  }),
  OculpmApiError: class extends Error {},
}));

import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { TodayScreen } from "@/features/today/TodayScreen";
import { PlannerPanel } from "@/features/planner/PlannerPanel";
import { SettingsPanel } from "@/features/settings/SettingsPanel";

const AXE_OPTIONS = {
  rules: {
    // jsdom does not implement computed-style cascading reliably; axe-core's
    // color-contrast check needs a real layout engine. Re-enable in CI/Playwright.
    "color-contrast": { enabled: false },
    // The 3 screens render as inner panes inside <Workspace> in production —
    // their root is not a landmark on its own.
    region: { enabled: false },
  },
} as const;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </SettingsProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("a11y — Lite-W6 3-IA screens (PR10 Part 2)", () => {
  it("TodayScreen has no axe violations", async () => {
    const { container } = render(
      <Wrap>
        <TodayScreen activeProjectId={null} />
      </Wrap>,
    );
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("PlannerPanel has no axe violations", async () => {
    const { container } = render(
      <Wrap>
        <PlannerPanel activeProjectId={null} />
      </Wrap>,
    );
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("SettingsPanel has no axe violations", async () => {
    const { container } = render(
      <Wrap>
        <SettingsPanel />
      </Wrap>,
    );
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});
