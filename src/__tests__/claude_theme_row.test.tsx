/**
 * 설정 · 에이전트의 Claude Code 테마 줄 (11-15 #claude-theme) — 맞춰 둠은 회색 ✓ 와 실제 경로(mono, ~ 로 접어),
 * Claude Code 가 없으면 중립 한 줄, 쓰기 실패만 경고 칩과 맨 위 「고칠 것」. 끄면 더 쓰지 않는다(파일은 둔다).
 * `/theme` 은 글자로만 — 터미널에 치는 단추가 없다. 앱 테마는 창마다 300ms 뒤에 한 번 맞춘다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  settings: [] as Array<[string, string]>,
  settingsSet: vi.fn(async (_k: string, _v: string) => ({ status: "ok", data: null })),
  write: vi.fn(async (_theme: unknown): Promise<unknown> => ({ status: "ok", data: null })),
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "settingsGetAll") return () => ok(fx.settings);
          if (prop === "settingsSet") return fx.settingsSet;
          if (prop === "claudeThemeWrite") return fx.write;
          if (prop === "claudePluginStatus")
            return () => ok({ installed: true, path: "/p", installed_version: "4.4.0", scope: "user", bundled_version: "4.4.0", behind: false });
          if (prop === "dbHealth") return () => ok({ db_bytes: 1000, wal_bytes: 24, free_bytes: 200 });
          if (prop === "appInfo") return () => ok({ version: "4.0.0", db_path: "", app_data_dir: "" });
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
import { claudeThemeStatus } from "@/features/theme/claudeTheme";
import { __resetLangForTests, setLangSetting, t } from "@/i18n";

const ok = (data: unknown) => ({ status: "ok", data });
const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

function renderPage() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <SettingsPage />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

const agents = () => screen.getByRole("region", { name: t("prefs.agents.title") });
const row = () => within(agents()).getByText(t("prefs.claudeTheme.label")).closest(".prefs-row") as HTMLElement;

beforeEach(() => {
  setLangSetting("ko");
  fx.settings = [];
  fx.write.mockImplementation(async () => ok({ state: "written", path: "/Users/me/.claude/themes/ocul.json" }));
  claudeThemeStatus.set({ kind: "idle" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetLangForTests();
});

describe("the Claude Code theme row", () => {
  it("shows a written file as a grey tick and the real path folded to ~, in mono", async () => {
    renderPage();
    const ready = await within(agents()).findByText(t("prefs.claudeTheme.ready"));
    expect(ready.className).toMatch(/\bchip\b.*\bok\b/);
    expect(within(row()).getByText("~/.claude/themes/ocul.json").className).toMatch(/\bmono\b/);
    expect(document.querySelector(".prefs-fixes")).toBeNull();
    // /theme 은 글자로만 안내한다 — 줄의 단추는 끄기 하나다(앱이 터미널에 치는 줄을 늘리지 않는다).
    expect(within(row()).getAllByRole("button").map((b) => b.textContent)).toEqual([t("prefs.claudeTheme.turnOff")]);
  });

  it("says plainly when there is no Claude Code, with where it looked, and asks nothing", async () => {
    fx.write.mockImplementation(async () => ok({ state: "no_claude", dir: "/Users/me/.claude" }));
    renderPage();
    const note = await within(agents()).findByText(t("prefs.claudeTheme.noClaude"));
    expect(note.className).toBe("prefs-dim");
    expect(within(row()).getByText("~/.claude")).toBeTruthy();
    expect(row().querySelector(".chip")).toBeNull();
    expect(document.querySelector(".prefs-fixes")).toBeNull();
  });

  it("turns only a failed write into a warn chip and a line on top", async () => {
    fx.write.mockImplementation(async () => ({ status: "error", error: "EACCES" }));
    const { container } = renderPage();
    const chip = await within(agents()).findByText(t("prefs.claudeTheme.failed"), { selector: ".chip" });
    expect(chip.className).toMatch(/\bwarn\b/);
    await waitFor(() => expect(container.querySelector(".prefs-fixes")?.textContent).toContain(t("prefs.claudeTheme.label")));
  });

  it("turning it off saves the setting and stops writing", async () => {
    renderPage();
    await within(agents()).findByText(t("prefs.claudeTheme.ready"));
    await sleep(350); // 앱 쪽 300ms 맞추기가 끝나기를 기다린다
    const before = fx.write.mock.calls.length;
    fireEvent.click(within(row()).getByRole("button", { name: t("prefs.claudeTheme.turnOff") }));
    await waitFor(() => expect(fx.settingsSet).toHaveBeenCalledWith("claude_theme", "off"));
    expect(await within(row()).findByText(t("prefs.claudeTheme.off"))).toBeTruthy();
    expect(within(row()).getByRole("button", { name: t("prefs.claudeTheme.turnOn") })).toBeTruthy();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await sleep(350);
    expect(fx.write.mock.calls.length).toBe(before);
  });

  it("never writes when it was turned off before — not even before the settings load", async () => {
    fx.settings = [["claude_theme", "off"]];
    renderPage();
    expect(await within(agents()).findByText(t("prefs.claudeTheme.off"))).toBeTruthy();
    await sleep(350);
    expect(fx.write).not.toHaveBeenCalled();
  });
});

describe("the app-level sync", () => {
  it("writes once, 300ms after the theme settles, on the window's family", async () => {
    render(
      <SettingsProvider>
        <span>window</span>
      </SettingsProvider>,
    );
    await sleep(60);
    expect(fx.write).not.toHaveBeenCalled();
    await waitFor(() => expect(fx.write).toHaveBeenCalledTimes(1));
    const theme = fx.write.mock.calls[0][0] as { name: string; base: string; overrides: Record<string, string> };
    expect(theme.name).toBe("Ocul");
    expect(theme.base).toBe(document.documentElement.getAttribute("data-theme"));
    expect(Object.keys(theme.overrides).length).toBeGreaterThan(0);
    await sleep(350);
    expect(fx.write).toHaveBeenCalledTimes(1);
  });
});
