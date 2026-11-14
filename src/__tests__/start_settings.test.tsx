// 시작 창의 설정 (11-15) — 앱 전역의 것만: 언어 · 밝기 · 앱 판과 업데이트. 이 프로젝트의 캐시를 다시 만드는
// 단추는 프로젝트가 없는 창에서 눌러도 아무 일이 없어(막다른 단추) 싣지 않는다. 언어 줄이 다른 칸으로 옮겨 가도
// 시작 창에서 사라지지 않는지도 이 시험이 문다 — 프로젝트를 들이기 전에 언어를 바꿀 길은 여기뿐이다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/bindings", () => {
  const ok = (data: unknown) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "settingsGetAll") return () => ok([]);
          if (prop === "appInfo") return () => ok({ version: "4.10.0", db_path: "", app_data_dir: "", secrets_store: "" });
          if (prop === "installKind") return () => Promise.reject(new Error("no ipc"));
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@/api/oculpm", () => {
  const known: Record<string, () => Promise<unknown>> = {
    codexPluginStatus: async () => ({ codex_installed: false, enabled: false, marketplace: null, marketplace_configured: false, cached_version: null }),
    mcpStatus: async () => ({ registered: false, binary_found: true, binary_path: "/bin/oculpm-mcp", mcp_json_path: "", foreign_servers: 0 }),
  };
  return {
    OculpmApiError: class extends Error {},
    oculpmApi: new Proxy(known, { get: (target, prop: string) => target[prop] ?? (async () => null) }),
  };
});

import StartSettings from "@/features/start/StartSettings";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";

afterEach(() => cleanup());

describe("start window settings", () => {
  it("carries the language and the app version, not the per-project cache rebuild", async () => {
    render(
      <SettingsProvider>
        <StartSettings />
      </SettingsProvider>,
    );
    expect(await screen.findByLabelText(t("prefs.display.language"))).toBeInTheDocument();
    expect(screen.getByText(t("prefs.data.app"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("prefs.data.rebuild") })).toBeNull();
  });
});
