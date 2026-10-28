/**
 * 설정 한 쪽 (4.0) — 칸 넷과 그 동작.
 *
 * 에이전트 연결 · 이 프로젝트 · 표시 · 데이터. 표시의 세 고르기는 SQLite 설정 키
 * (`language` · `theme` · `ui_scale`)에 쓰고, 이 프로젝트의 규칙 파일이 앱보다 낮으면
 * 「올리기」가 승격 명령을 부른다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  settingsSet: vi.fn(async (_k: string, _v: string) => ({ status: "ok", data: null })),
  plugin: { installed: false, path: null, installed_version: null, scope: null, bundled_version: "4.0.0", behind: false } as Record<
    string,
    unknown
  >,
  upgrade: null as null | { from_version: number; to_version: number },
  applyUpgrade: vi.fn(async (_id: number) => ({ status: "ok", data: {} })),
  compact: vi.fn(async () => ({ status: "ok", data: { db_bytes: 500, wal_bytes: 0, free_bytes: 0 } })),
  reindex: vi.fn(async (_id: number) => ({})),
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
          if (prop === "claudePluginStatus") return () => ok(fx.plugin);
          if (prop === "oculpmAgentsCheckMasterUpgrade") return () => ok(fx.upgrade);
          if (prop === "oculpmAgentsCheckMasterAhead") return () => ok(null);
          if (prop === "oculpmAgentsApplyMasterUpgrade") return fx.applyUpgrade;
          if (prop === "dbHealth") return () => ok({ db_bytes: 1000, wal_bytes: 24, free_bytes: 200 });
          if (prop === "dbCompact") return fx.compact;
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
    reindexCache: fx.reindex,
  },
}));

import { SettingsPage } from "@/features/settings/SettingsPage";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { WorkspaceProvider, useProjectRuntime } from "@/contexts/WorkspaceContext";
import { __resetLangForTests, setLangSetting, t } from "@/i18n";
import { CLAUDE_PLUGIN_INSTALL } from "@/lib/agentCommands";
import { useEffect } from "react";

/** 기록이 켜진 프로젝트로 띄운다 — 규칙 파일 판은 기록이 켜졌을 때만 묻는다. */
function Recording({ children }: { children: React.ReactNode }) {
  const { setOculpmStatus, setProjectMeta } = useProjectRuntime();
  useEffect(() => {
    setProjectMeta("ai-pm", "/Users/me/ai-pm");
    setOculpmStatus({ initialized: true } as Parameters<typeof setOculpmStatus>[0]);
  }, [setOculpmStatus, setProjectMeta]);
  return <>{children}</>;
}

function renderPage() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <Recording>
          <SettingsPage />
        </Recording>
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  setLangSetting("ko");
  fx.upgrade = null;
  fx.plugin = { installed: false, path: null, installed_version: null, scope: null, bundled_version: "4.0.0", behind: false };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetLangForTests();
});

const section = (title: string) => screen.getByRole("region", { name: title });

describe("설정 한 쪽 — 칸 넷", () => {
  it("에이전트 연결 · 이 프로젝트 · 표시 · 데이터, 그 순서로 선다", () => {
    renderPage();
    const titles = screen.getAllByRole("region").map((r) => r.querySelector("h2")?.textContent);
    expect(titles).toEqual([
      t("prefs.agents.title"),
      t("prefs.project.title"),
      t("prefs.display.title"),
      t("prefs.data.title"),
    ]);
  });
});

describe("에이전트 연결", () => {
  it("플러그인이 없으면 설치 명령(마켓플레이스 + 설치)을 준다", async () => {
    renderPage();
    const agents = section(t("prefs.agents.title"));
    expect(await within(agents).findByText(CLAUDE_PLUGIN_INSTALL[1])).toBeInTheDocument();
    expect(within(agents).getByText(CLAUDE_PLUGIN_INSTALL[0])).toBeInTheDocument();
    expect(within(agents).getByText(t("prefs.agents.othersBody"))).toBeInTheDocument();
  });

  it("깔린 판이 낮으면 판 차이와 업데이트 명령", async () => {
    fx.plugin = { installed: true, path: "/p", installed_version: "3.17.0", scope: "user", bundled_version: "4.0.0", behind: true };
    renderPage();
    const agents = section(t("prefs.agents.title"));
    expect(
      await within(agents).findByText(t("prefs.agents.behind", { installed: "3.17.0", bundled: "4.0.0" })),
    ).toBeInTheDocument();
    expect(within(agents).getByText("claude plugin update oculpm@oculpm")).toBeInTheDocument();
  });
});

describe("이 프로젝트", () => {
  it("규칙 파일이 앱보다 낮으면 「올리기」가 승격을 부른다", async () => {
    fx.upgrade = { from_version: 18, to_version: 20 };
    renderPage();
    const proj = section(t("prefs.project.title"));
    expect(await within(proj).findByText(t("prefs.project.behind", { from: 18, to: 20 }))).toBeInTheDocument();
    fx.upgrade = null;
    fireEvent.click(within(proj).getByRole("button", { name: t("prefs.project.upgrade") }));
    await waitFor(() => expect(fx.applyUpgrade).toHaveBeenCalledWith(1));
    expect(await within(proj).findByText(t("prefs.project.current"))).toBeInTheDocument();
  });

  it(".oculpm 의 자리를 ~ 로 보여 준다", async () => {
    renderPage();
    expect(await within(section(t("prefs.project.title"))).findByText("~/ai-pm/.oculpm")).toBeInTheDocument();
  });
});

describe("표시", () => {
  it("언어 · 밝기 · 글자 크기는 설정 키에 쓴다", async () => {
    renderPage();
    const display = section(t("prefs.display.title"));
    const lang = within(display).getByRole("tablist", { name: t("prefs.display.language") });
    const ko = within(lang).getByRole("tab", { name: "한국어" });
    expect(ko).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(lang).getByRole("tab", { name: "English" }));
    await waitFor(() => expect(fx.settingsSet).toHaveBeenCalledWith("language", "en"));

    const brightness = within(display).getByRole("tablist", { name: t("prefs.display.brightness") });
    fireEvent.click(within(brightness).getByRole("tab", { name: t("prefs.display.dark") }));
    await waitFor(() => expect(fx.settingsSet).toHaveBeenCalledWith("theme", "dark"));

    const size = within(display).getByRole("tablist", { name: t("prefs.display.textSize") });
    expect(within(size).getByRole("tab", { name: "100%" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(size).getByRole("tab", { name: "110%" }));
    await waitFor(() => expect(fx.settingsSet).toHaveBeenCalledWith("ui_scale", "1.1"));
  });
});

describe("데이터", () => {
  it("캐시 크기를 말하고, 정리 · 다시 만들기를 부른다", async () => {
    renderPage();
    const data = section(t("prefs.data.title"));
    // 본체 1000 + WAL 24 = 1.0 KB, 빈 자리 200 B.
    expect(await within(data).findByText(/1\.0 KB · .*200 B/)).toBeInTheDocument();
    fireEvent.click(within(data).getByRole("button", { name: t("prefs.data.compact") }));
    await waitFor(() => expect(fx.compact).toHaveBeenCalled());
    fireEvent.click(within(data).getByRole("button", { name: t("prefs.data.rebuild") }));
    await waitFor(() => expect(fx.reindex).toHaveBeenCalledWith(1));
    // 앱 판은 열 때 스스로 확인한다.
    expect(await within(data).findByText(/Ocul-PM 4\.0\.0/)).toBeInTheDocument();
    expect(await within(data).findByText(new RegExp(t("prefs.data.upToDate")))).toBeInTheDocument();
  });
});
