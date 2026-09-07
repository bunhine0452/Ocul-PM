import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// 플러그인 안내 카드의 닫기 (v3-release {#plugin-card-dismiss}).
//
// 카드의 표시 조건은 이미 좁다 — 일지 0건 + Claude Code 설치됨 + 플러그인 못
// 찾음. 그래도 **안 깔기로 고른 사람**에게는 셋이 다 참인 채로 남아서, 닫을
// 길이 없으면 카드가 사용자를 이긴다. 닫기는 SQLite 설정에 적힌다 —
// localStorage 는 이 저장소에서 금지고, 세션 한정 닫기는 다음 실행에 또 뜬다.

const settingsEntries = vi.hoisted(() => ({ current: [] as Array<[string, string]> }));
const setCalls = vi.hoisted(() => ({ current: [] as Array<[string, string]> }));
const probe = vi.hoisted(() => ({
  cli: { available: true } as { available: boolean } | null,
  plugin: { installed: false, path: null } as { installed: boolean; path: string | null } | null,
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "settingsGetAll") return () => ok(settingsEntries.current);
          if (prop === "settingsSet")
            return (key: string, value: string) => {
              setCalls.current.push([key, value]);
              return ok(null);
            };
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: () => Promise.resolve() }),
}));

vi.mock("@/api/claudeSurface", () => ({
  claudeInstallApi: {
    pluginStatus: () => Promise.resolve(probe.plugin),
    cli: () => Promise.resolve(probe.cli),
  },
}));

import { SettingsProvider } from "@/contexts/SettingsContext";
import { PluginSetupCard } from "@/features/today/PluginSetupCard";
import { DEFAULTS, KEYS } from "@/lib/settings";
import { t } from "@/i18n";

beforeEach(() => {
  settingsEntries.current = [];
  setCalls.current = [];
  probe.cli = { available: true };
  probe.plugin = { installed: false, path: null };
});
afterEach(cleanup);

const mount = () =>
  render(
    <SettingsProvider>
      <PluginSetupCard show onNavigate={vi.fn()} />
    </SettingsProvider>,
  );

describe("플러그인 안내 카드 닫기", () => {
  it("기본은 안 닫힌 상태 — 새 사용자에게는 안내가 먼저다", () => {
    expect(DEFAULTS.pluginCardDismissed).toBe(false);
  });

  it("닫으면 설정에 적는다 (다음 실행에도 남는 닫기)", async () => {
    mount();
    await screen.findByText(t("today.plugin.title"));
    fireEvent.click(screen.getByRole("button", { name: t("common.dismiss") }));
    await waitFor(() =>
      expect(setCalls.current).toContainEqual([KEYS.pluginCardDismissed, "true"]),
    );
  });

  it("설정에 닫힘이 적혀 있으면 판정이 참이어도 안 뜬다", async () => {
    settingsEntries.current = [[KEYS.pluginCardDismissed, "true"]];
    const { container } = mount();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    // 그리지 않을 카드의 탐침도 돌리지 않는다.
    expect(screen.queryByText(t("today.plugin.title"))).toBeNull();
  });
});
