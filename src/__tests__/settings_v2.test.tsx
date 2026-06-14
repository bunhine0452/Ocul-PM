import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-UI 6 — Settings 재구성 ─────────────────────────────────────────────
//
// Every control wires to an EXISTING backend (Decision F lineage). We cover the
// section structure, the theme scope-chip sync (SettingsContext), the keyring
// status chip + key modal, and a11y. The data-folder reveal + reindex Channel
// need a real Tauri runtime, so we don't exercise those click paths here.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

const fx = {
  secrets: {} as Record<string, boolean>,
  watcherState: "running" as "running" | "stopped" | "error",
};

const config = () => ({
  schema_version: 1,
  workday: { timezone: "Asia/Seoul", day_starts_at: "00:00" },
  session: {
    inactivity_timeout_minutes: 30,
    auto_close_on_workday_boundary: true,
    auto_close_on_app_quit: true,
    crash_recovery_grace_minutes: 5,
    session_resume_grace_minutes: 15,
  },
  git: { journal_committed: true, forbid_journal_for_paths: [], auto_redact_patterns: ["sk-[a-z]+"] },
  watcher: { ignore: [], respect_gitignore: true, debounce_ms: 400, batch_max: 64 },
  agents: { active: [], auto_detect_on_open: true, auto_sync_adapters: true },
});

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "settingsGetAll":
              return () => ok([] as Array<[string, string]>);
            case "secretHas":
              return (name: string) => ok(fx.secrets[name] ?? false);
            case "oculpmGetConfig":
              return () => ok(config());
            case "oculpmWatcherStatus":
              return () =>
                ok({
                  state: fx.watcherState,
                  events_seen_total: 0,
                  events_ignored_total: 0,
                  last_event_at: null,
                  debounce_ms: 400,
                });
            case "appInfo":
              return () =>
                ok({
                  db_path: "/data/db.sqlite",
                  app_data_dir: "/data",
                  secrets_store: "keychain",
                  version: "0.1.0",
                });
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: () => Promise.resolve(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: () => Promise.resolve(),
}));

import { SettingsScreenV2 } from "@/features/settings/SettingsScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";

function wrap(node: React.ReactNode) {
  return (
    <SettingsProvider>
      <WorkspaceProvider>{node}</WorkspaceProvider>
    </SettingsProvider>
  );
}

beforeEach(() => {
  // No localStorage seeding here — Settings reads SQLite (mocked) + the
  // WorkspaceContext reset fn, not the persisted envelope, so the lint:storage
  // allowlist stays untouched.
  fx.secrets = {};
  fx.watcherState = "running";
});
afterEach(() => cleanup());

describe("PR-UI 6 — Settings", () => {
  it("renders all five sections", () => {
    const { getByText } = render(wrap(<SettingsScreenV2 projectId={1} projectRoot="/proj" />));
    expect(getByText("일반")).toBeInTheDocument();
    expect(getByText("기록 & 보안")).toBeInTheDocument();
    expect(getByText("API 키 · 키체인 저장")).toBeInTheDocument();
    expect(getByText("고급")).toBeInTheDocument();
    expect(getByText("정보")).toBeInTheDocument();
  });

  it("theme scope-chip lights up in sync with the theme setting", async () => {
    const { getByText } = render(wrap(<SettingsScreenV2 projectId={1} projectRoot="/proj" />));
    const dark = getByText("다크").closest("button")!;
    expect(dark).not.toHaveClass("on");
    fireEvent.click(dark);
    await waitFor(() => expect(getByText("다크").closest("button")).toHaveClass("on"));
  });

  it("keyring chip reflects secretHas; '추가' opens the write-only key modal", async () => {
    const { findAllByText, getByRole, queryByRole } = render(
      wrap(<SettingsScreenV2 projectId={1} projectRoot="/proj" />),
    );
    // No stored keys → every provider row shows 미설정 + an 추가 button
    // (anthropic / openai / gemini / nim / openrouter — OpenRouter added 2026-06-15).
    const add = await findAllByText("추가");
    expect(add).toHaveLength(5);
    expect(queryByRole("dialog")).toBeNull();
    fireEvent.click(add[0]);
    const dialog = getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.querySelector("input")).toBeTruthy();
  });

  it("shows '키체인에 저장됨' when the secret is present", async () => {
    fx.secrets["anthropic_api_key"] = true;
    const { findByText } = render(wrap(<SettingsScreenV2 projectId={1} projectRoot="/proj" />));
    expect(await findByText("키체인에 저장됨")).toBeInTheDocument();
  });

  it("redaction status chip reflects the config pattern count", async () => {
    const { findByText } = render(wrap(<SettingsScreenV2 projectId={1} projectRoot="/proj" />));
    expect(await findByText(/패턴 1개 활성/)).toBeInTheDocument();
  });

  it("has no axe violations with data loaded", async () => {
    fx.secrets["anthropic_api_key"] = true;
    const { container, findByText } = render(
      wrap(<SettingsScreenV2 projectId={1} projectRoot="/proj" />),
    );
    await findByText("키체인에 저장됨");
    await waitFor(async () =>
      expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]),
    );
  });
});
