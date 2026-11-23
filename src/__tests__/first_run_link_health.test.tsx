// 첫 10분의 정직함 — 시작 창의 「Claude Code 를 아직 못 봤어요」 와 설정의 「일지가 안 와요」 진단 (love-round, 11-23).
// 볼 수 없는 것을 「없음」 이라 하지 않는다: 못 봤으면 「아직 못 봤어요」, 이 창이 Claude 를 못 봤으면 침묵을 말하지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const health = vi.hoisted(() => ({
  value: { claude_seen: true, hook_last_at: null as string | null } as unknown,
  calls: [] as Array<number | null>,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("@/lib/bindings", () => ({
  commands: new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "agentLinkHealth"
          ? (projectId: number | null) => {
              health.calls.push(projectId);
              return Promise.resolve({ status: "ok", data: health.value });
            }
          : () => Promise.resolve({ status: "ok", data: null }),
    },
  ),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/contexts/WorkspaceContext", () => ({
  useOptionalWorkspace: () => ({ state: { currentProjectId: 5 } }),
}));

import type { TermInfo } from "@/api/terminal";
import { noteWatcherFailure } from "@/features/oculpm/watcherCause";
import { HOOK_GRACE_MS, JournalHealthRows, hookSilent } from "@/features/settings/JournalHealth";
import { ClaudeUnseen } from "@/features/start/ClaudeUnseen";
import { __resetClaudeWorkedForTests, noteWorked } from "@/features/terminal/claudeWorked";
import { t } from "@/i18n";
import { __setPlatformForTests } from "@/lib/platform";

const working = (projectId: number, app?: string) =>
  ({
    id: 1,
    project_id: projectId,
    label: "zsh",
    alive: true,
    busy: true,
    exit_code: null,
    started_at: "2026-11-23T00:00:00Z",
    status: { state: "working", kind: null, msg: null, since: "2026-11-23T00:00:00Z", ...(app ? { app } : {}) },
  }) as unknown as TermInfo;

beforeEach(() => {
  health.calls.length = 0;
  __resetClaudeWorkedForTests();
  noteWatcherFailure(5, null);
});
afterEach(() => {
  cleanup();
  __setPlatformForTests(null);
});

describe("start window: Claude Code not seen", () => {
  it("says it hasn't seen Claude Code yet (not 「missing」) and hands the official install line", async () => {
    __setPlatformForTests("mac");
    health.value = { claude_seen: false, hook_last_at: null };
    const { container } = render(<ClaudeUnseen />);
    await screen.findByText(t("start.claudeUnseen"));
    expect(health.calls).toEqual([null]);
    expect(container.querySelector("code")?.textContent).toBe("curl -fsSL https://claude.ai/install.sh | bash");
  });

  it("Windows gets the PowerShell line", async () => {
    __setPlatformForTests("windows");
    health.value = { claude_seen: false, hook_last_at: null };
    const { container } = render(<ClaudeUnseen />);
    await screen.findByText(t("start.claudeUnseen"));
    expect(container.querySelector("code")?.textContent).toBe("irm https://claude.ai/install.ps1 | iex");
  });

  it("draws nothing once Claude Code has been seen", async () => {
    health.value = { claude_seen: true, hook_last_at: null };
    const { container } = render(<ClaudeUnseen />);
    await waitFor(() => expect(health.calls).toHaveLength(1));
    expect(container.textContent).toBe("");
  });
});

describe("hookSilent", () => {
  const worked = Date.parse("2026-11-23T10:00:00Z");
  it.each([
    ["Claude never worked here", null, null, false],
    ["health not read yet", worked, undefined, false],
    ["no hook signal ever", worked, null, true],
    ["signal long before Claude worked", worked, new Date(worked - HOOK_GRACE_MS - 1000).toISOString(), true],
    ["signal just before (prompt submit)", worked, new Date(worked - 5000).toISOString(), false],
    ["signal after", worked, new Date(worked + 60_000).toISOString(), false],
  ] as const)("%s", (_name, at, last, expected) => {
    expect(hookSilent(at, last)).toBe(expected);
  });
});

describe("settings: journals not arriving", () => {
  it("says only that nothing was seen while this window hasn't seen Claude work", () => {
    render(<JournalHealthRows tick={0} />);
    expect(screen.getByText(t("prefs.agents.diagNone"))).toBeInTheDocument();
    expect(health.calls).toEqual([]);
  });

  it("raises 「no plugin signal」 when Claude worked in this project's terminal and the hook inbox never moved", async () => {
    health.value = { claude_seen: true, hook_last_at: null };
    noteWorked(working(5, "claude"));
    render(<JournalHealthRows tick={0} />);
    await screen.findByText(t("prefs.agents.diagHooksBody"));
    expect(health.calls).toEqual([5]);
  });

  it("a Codex session working is not Claude, and another project's Claude does not count", () => {
    health.value = { claude_seen: true, hook_last_at: null };
    noteWorked(working(5, "codex"));
    noteWorked(working(9, "claude"));
    render(<JournalHealthRows tick={0} />);
    expect(screen.getByText(t("prefs.agents.diagNone"))).toBeInTheDocument();
  });

  it("stays quiet when the hook inbox moved around the time Claude worked", async () => {
    health.value = { claude_seen: true, hook_last_at: new Date().toISOString() };
    noteWorked(working(5, "claude"));
    render(<JournalHealthRows tick={0} />);
    await waitFor(() => expect(health.calls).toEqual([5]));
    expect(screen.getByText(t("prefs.agents.diagNone"))).toBeInTheDocument();
  });

  it("names the real cause when live updates are off", () => {
    noteWatcherFailure(5, { cause: "missing", detail: null, at: 1 });
    render(<JournalHealthRows tick={0} />);
    expect(screen.getByText(t("prefs.agents.diagWatcher"))).toBeInTheDocument();
    expect(screen.getByText(t("watcher.cause.missing"), { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(t("prefs.agents.diagNone"))).toBeNull();
  });
});
