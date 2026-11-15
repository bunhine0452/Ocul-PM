/**
 * 설정이 아는 만큼만 말하고, 모르면 쓰지 않는다 (11-15 최종 검수).
 *
 *  - 설정을 읽지 못하면 화면은 기본값으로 서는데(`loaded`), Claude Code 테마의 기본값은 「켜짐」 이라 300ms 뒤
 *    `~/.claude/themes/ocul.json` 을 다시 썼다 — 끈 사람의 프로젝트 밖 파일. 이제 읽어 낸 뒤에만(`ready`) 쓴다.
 *  - 테마 파일을 못 쓰면 칩 「쓰지 못했어요」 만 섰다 — 어느 경로에서 왜인지(권한 · 그 이름의 폴더)는 없었다.
 *  - 채운 단추는 화면에 하나(영수증 규칙 3) — 「기록 켜기」 · 「{v} 설치」 가 같이 채워졌다.
 *  - 낱말: 칸 「모양」 의 첫 줄도 「모양」, 「자동 VS Code | VS Code」, 마침표 없는 설명과 본문 서체 /theme.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  settings: { status: "ok", data: [] } as { status: "ok"; data: Array<[string, string]> } | { status: "error"; error: string },
  write: (async () => ({ status: "ok", data: { state: "written", path: "/Users/me/.claude/themes/ocul.json" } })) as (
    theme: unknown,
  ) => Promise<unknown>,
  writes: 0,
  updater: {
    status: { kind: "uptodate" } as { kind: string; version?: string },
    check: async () => null,
    install: async () => {},
    restartNow: async () => {},
  },
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "settingsGetAll") return () => Promise.resolve(fx.settings);
          if (prop === "claudeThemeWrite")
            return (theme: unknown) => {
              fx.writes += 1;
              return fx.write(theme);
            };
          if (prop === "claudePluginStatus")
            return () => ok({ installed: true, path: "/p", installed_version: "4.4.0", scope: "user", bundled_version: "4.4.0", behind: false });
          if (prop === "detectEditor") return () => Promise.resolve("vscode");
          if (prop === "dbHealth") return () => ok({ db_bytes: 1000, wal_bytes: 24, free_bytes: 200 });
          if (prop === "appInfo") return () => ok({ version: "4.10.0", db_path: "", app_data_dir: "" });
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});
vi.mock("@/lib/updater", () => ({ useUpdater: () => fx.updater }));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    codexPluginStatus: async () => ({ codex_installed: false, enabled: false, marketplace: null, marketplace_configured: false, cached_version: null }),
    reindexCache: async () => ({}),
    mcpStatus: async () => ({ registered: false, binary_found: true, binary_path: "", mcp_json_path: "", foreign_servers: 0 }),
  },
}));

import { SettingsProvider } from "@/contexts/SettingsContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { claudeThemeStatus } from "@/features/theme/claudeTheme";
import { __resetLangForTests, setLangSetting, t } from "@/i18n";
import { en } from "@/i18n/en";
import { ko } from "@/i18n/ko";

function renderPage() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <SettingsPage />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const section = (title: string) => screen.getByRole("region", { name: title });
const themeRow = () =>
  within(section(t("prefs.agents.title"))).getByText(t("prefs.claudeTheme.label")).closest(".prefs-row") as HTMLElement;

beforeEach(() => {
  setLangSetting("ko");
  fx.settings = { status: "ok", data: [] };
  fx.write = async () => ({ status: "ok", data: { state: "written", path: "/Users/me/.claude/themes/ocul.json" } });
  fx.writes = 0;
  fx.updater.status = { kind: "uptodate" };
  claudeThemeStatus.set({ kind: "idle" });
});
afterEach(() => {
  cleanup();
  __resetLangForTests();
});

describe("unknown settings never write the Claude Code theme file", () => {
  it("settings_get_all fails → no claude_theme_write, from the app-level sync or the row; the row says it does not know", async () => {
    fx.settings = { status: "error", error: "database is locked" };
    renderPage();
    await sleep(400); // 앱 쪽 맞추기는 300ms 뒤다 — 그보다 오래 기다린다.
    expect(fx.writes).toBe(0);
    expect(within(themeRow()).getByText(t("prefs.unknown"))).toBeTruthy();
    expect(themeRow().querySelector(".chip")).toBeNull();
    // 「끄기」 도 없다 — 기본값(켜짐)으로 그 단추를 세우면 모르는 상태를 「켜져 있다」 고 말한다.
    expect(within(themeRow()).queryByRole("button")).toBeNull();
  });

  it("a successful read with the default (on) still writes — the guard is about not knowing, not about writing", async () => {
    renderPage();
    await waitFor(() => expect(fx.writes).toBeGreaterThan(0));
    expect(await within(themeRow()).findByText(t("prefs.claudeTheme.ready"))).toBeTruthy();
  });
});

describe("a failed theme write says where and why", () => {
  it("the backend's path and reason stand as one mono line, and the same line goes on top after the words", async () => {
    fx.write = async () => ({
      status: "ok",
      data: { state: "failed", path: "/Users/me/.claude/themes/ocul.json", error: "Permission denied (os error 13)" },
    });
    const { container } = renderPage();
    const chip = await within(section(t("prefs.agents.title"))).findByText(t("prefs.claudeTheme.failed"), { selector: ".chip" });
    expect(chip.className).toMatch(/\bwarn\b/);
    const line = "~/.claude/themes/ocul.json: Permission denied (os error 13)";
    expect(within(themeRow()).getByText(line).className).toMatch(/\bmono\b/);
    await waitFor(() => expect(container.querySelector(".prefs-fixes .prefs-fix .mono")?.textContent).toBe(line));
    // 맨 위 줄도 사람의 말이 먼저다 — mono 줄만이면 한국어 화면에 OS 의 영어 문구 한 줄만 섰다.
    const fix = container.querySelector(".prefs-fixes .prefs-fix")!;
    expect(fix.textContent).toBe(`${t("prefs.claudeTheme.label")} ${t("prefs.claudeTheme.failed")} ${line}`);
    expect(within(fix as HTMLElement).getByText(t("prefs.claudeTheme.failed")).className).not.toMatch(/\bmono\b/);
  });

  it("an error with no path still shows its reason", async () => {
    fx.write = async () => ({ status: "error", error: "Could not find the home directory" });
    renderPage();
    expect(await within(section(t("prefs.agents.title"))).findByText("Could not find the home directory")).toBeTruthy();
  });
});

describe("one filled button at most", () => {
  it("recording off and a new version available — 「turn on」 and 「install」 are both bordered buttons", async () => {
    fx.updater.status = { kind: "available", version: "4.11.0" };
    const { container } = renderPage();
    await screen.findByRole("button", { name: t("prefs.data.install", { version: "4.11.0" }) });
    expect(screen.getByRole("button", { name: t("prefs.project.turnOn") })).toBeTruthy();
    expect(container.querySelectorAll(".btn.primary")).toHaveLength(0);
  });
});

describe("words on the settings page", () => {
  it("the appearance card's first row is not named like the card", () => {
    for (const dict of [ko, en]) expect(dict["prefs.display.brightness"]).not.toBe(dict["prefs.display.title"]);
    renderPage();
    const display = section(t("prefs.display.title"));
    expect(display.querySelector(".prefs-name")?.textContent).not.toBe(t("prefs.display.title"));
  });

  it("「auto」 shows only its own word — the detected editor lives in its title and name", async () => {
    renderPage();
    const auto = await screen.findByRole("radio", { name: t("prefs.display.editorAutoFound", { name: "VS Code" }) });
    expect(auto.textContent).toBe(t("prefs.display.editorAuto"));
    expect(auto.querySelector("[title]")?.getAttribute("title")).toBe(t("prefs.display.editorAutoFound", { name: "VS Code" }));
  });

  it("the theme note ends every sentence with a period and sets /theme in mono", () => {
    for (const dict of [ko, en]) expect(dict["prefs.claudeTheme.meta"]).toMatch(/\.$/);
    renderPage();
    const code = themeRow().querySelector(".prefs-meta code")!;
    expect(code.textContent).toBe("/theme");
    expect(code.className).toBe("mono");
    expect(themeRow().querySelector(".prefs-meta")?.textContent).not.toContain("`");
  });
});
