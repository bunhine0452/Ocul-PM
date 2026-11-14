/**
 * 설정은 상태표 (11-15 #settings-status, ST-01) — 맨 위 「고칠 것」 한 줄, 칸 넷(에이전트 · 이 프로젝트 ·
 * 모양 · 앱), 줄의 동작 단추는 테두리 단추, 창이 앞으로 오면 에이전트를 다시 묻는다, 앱 아이콘은
 * 방향키로 훑기만 하고 Enter 로 고른다, 줄어든 양을 모르는 정리는 숫자를 꾸미지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  settingsSet: vi.fn(async (_k: string, _v: string) => ({ status: "ok", data: null })),
  pluginCalls: 0,
  pluginFails: false,
  plugin: {} as Record<string, unknown>,
  health: { db_bytes: 1000, wal_bytes: 24, free_bytes: 200 } as Record<string, number | null>,
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "settingsGetAll") return () => ok([]);
          if (prop === "settingsSet") return fx.settingsSet;
          if (prop === "claudePluginStatus")
            return () => {
              fx.pluginCalls += 1;
              return fx.pluginFails ? Promise.resolve({ status: "error" as const, error: "boom" }) : ok(fx.plugin);
            };
          if (prop === "oculpmAgentsCheckMasterUpgrade" || prop === "oculpmAgentsCheckMasterAhead") return () => ok(null);
          if (prop === "claudeThemeWrite") return () => ok({ state: "unchanged", path: "/Users/me/.claude/themes/ocul.json" });
          if (prop === "dbHealth") return () => ok(fx.health);
          if (prop === "dbCompact") return () => ok({ db_bytes: null, wal_bytes: null, free_bytes: null });
          if (prop === "appInfo") return () => ok({ version: "4.0.0", db_path: "", app_data_dir: "", secrets_store: "" });
          if (prop === "installKind") return () => Promise.reject(new Error("no ipc"));
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    codexPluginStatus: async () => ({ codex_installed: false, enabled: false, marketplace: null, marketplace_configured: false, cached_version: null }),
    reindexCache: async () => ({}),
    mcpStatus: async () => ({ registered: false, binary_found: true, binary_path: "", mcp_json_path: "", foreign_servers: 0 }),
  },
}));

import { SettingsPage } from "@/features/settings/SettingsPage";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { __resetLangForTests, setLangSetting, t } from "@/i18n";
import { getToasts } from "@/lib/toast";

function renderPage() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <SettingsPage />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

const section = (title: string) => screen.getByRole("region", { name: title });

beforeEach(() => {
  setLangSetting("ko");
  fx.pluginCalls = 0;
  fx.pluginFails = false;
  fx.plugin = { installed: true, path: "/p", installed_version: "4.3.0", scope: "user", bundled_version: "4.4.0", behind: true };
  fx.health = { db_bytes: 1000, wal_bytes: 24, free_bytes: 200 };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetLangForTests();
});

describe("the status line on top", () => {
  it("counts one fix for a plugin that is behind and names it with mono versions", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector(".prefs-fixes")).not.toBeNull());
    const line = container.querySelector(".prefs-fixes")!;
    expect(line.querySelector(".chip .mono")?.textContent).toBe("1");
    expect(line.querySelector(".prefs-fix")?.textContent).toBe(t("prefs.agents.claude") + " 4.3.0 → 4.4.0");
    expect(line.querySelector(".prefs-fix .mono")?.textContent).toBe("4.3.0 → 4.4.0");
  });

  it("is absent when there is nothing to fix", async () => {
    fx.plugin = { installed: true, path: "/p", installed_version: "4.4.0", scope: "user", bundled_version: "4.4.0", behind: false };
    const { container } = renderPage();
    await waitFor(() => expect(fx.pluginCalls).toBeGreaterThan(0));
    await waitFor(() => expect(within(section(t("prefs.agents.title"))).getByText(t("prefs.agents.connected"))).toBeTruthy());
    expect(container.querySelector(".prefs-fixes")).toBeNull();
  });
});

describe("the four sections", () => {
  it("stand as agents, this project, appearance, app", () => {
    renderPage();
    expect(screen.getAllByRole("region").map((r) => r.querySelector("h2")?.textContent)).toEqual([
      t("prefs.agents.title"),
      t("prefs.project.title"),
      t("prefs.display.title"),
      t("prefs.data.title"),
    ]);
  });

  it("row action buttons are bordered, never ghost", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll(".prefs-row .btn").length).toBeGreaterThan(3));
    for (const b of container.querySelectorAll(".prefs-row .btn")) expect(b.className).not.toMatch(/\bghost\b/);
  });

  it("choices are radio groups", () => {
    renderPage();
    const display = section(t("prefs.display.title"));
    expect(within(display).getByRole("radiogroup", { name: t("prefs.display.brightness") })).toBeTruthy();
    expect(within(display).queryByRole("tablist")).toBeNull();
  });
});

describe("agents", () => {
  it("asks again when the window comes back to the front, and on 'check again'", async () => {
    renderPage();
    await waitFor(() => expect(fx.pluginCalls).toBe(1));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(fx.pluginCalls).toBe(2));
    fireEvent.click(within(section(t("prefs.agents.title"))).getByRole("button", { name: t("prefs.recheck") }));
    await waitFor(() => expect(fx.pluginCalls).toBe(3));
  });

  // 한 번의 실패(null)로 알던 답을 덮으면 맨 위 「고칠 것」 의 뒤처짐까지 내려갔다 — Codex · MCP 와 같은 규칙.
  it("keeps what it knew when asking again fails once", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector(".prefs-fixes")).not.toBeNull());
    fx.pluginFails = true;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(fx.pluginCalls).toBe(2));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(container.querySelector(".prefs-fixes")).not.toBeNull();
    expect(within(section(t("prefs.agents.title"))).queryByText(t("prefs.unknown"))).toBeNull();
  });

  it("shows a missing plugin as a warn chip", async () => {
    fx.plugin = { installed: false, path: null, installed_version: null, scope: null, bundled_version: "4.4.0", behind: false };
    renderPage();
    const chip = await within(section(t("prefs.agents.title"))).findByText(t("prefs.agents.notInstalled"));
    expect(chip.className).toMatch(/\bchip\b.*\bwarn\b/);
  });
});

describe("app icon", () => {
  it("arrow keys only preview — Enter picks once", async () => {
    renderPage();
    const group = within(section(t("prefs.display.title"))).getByRole("radiogroup", { name: t("prefs.display.appIcon") });
    for (let i = 0; i < 3; i++) fireEvent.keyDown(group, { key: "ArrowRight" });
    const iconWrites = () => fx.settingsSet.mock.calls.filter(([k]) => k === "app_icon");
    expect(iconWrites()).toHaveLength(0);
    fireEvent.keyDown(group, { key: "Enter" });
    await waitFor(() => expect(iconWrites()).toHaveLength(1));
    expect(iconWrites()[0][1]).toBe("mono");
  });
});

describe("cache cleanup", () => {
  it("does not print a dash when how much was freed is unknown", async () => {
    fx.health = { db_bytes: null, wal_bytes: null, free_bytes: null };
    renderPage();
    fireEvent.click(within(section(t("prefs.data.title"))).getByRole("button", { name: t("prefs.data.compact") }));
    await waitFor(() => expect(getToasts().some((x) => x.message === t("prefs.data.compactedPlain"))).toBe(true));
    expect(getToasts().some((x) => x.message.includes("—"))).toBe(false);
  });
});
