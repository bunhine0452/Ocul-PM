import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

import { __resetLangForTests, getLang, getLangSetting } from "@/i18n";
import { SettingsProvider } from "@/contexts/SettingsContext";

// SettingsContext → i18n 모듈 스토어 배선
// (docs/20260811_three-features/03-i18n.md §4.3).
//
// 이게 실제 전달 경로다: SQLite `settings.language` → SettingsContext →
// `setLangSetting()` → 모듈 스토어 → `t()` / `useT()`. 이 링크가 끊기면 설정을
// 바꿔도 아무 일이 안 일어나는데, 사전·훅 단위 테스트는 전부 통과한다.

const settingsEntries = vi.hoisted(() => ({ current: [] as Array<[string, string]> }));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "settingsGetAll") return () => ok(settingsEntries.current);
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

// 웹뷰 줌(uiScale 효과)은 Tauri 런타임이 필요 — jsdom 에서는 no-op.
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: () => Promise.resolve() }),
}));

beforeEach(() => {
  settingsEntries.current = [];
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  cleanup();
  __resetLangForTests();
});

describe("SettingsContext → i18n 스토어", () => {
  it("저장된 language 를 로드해 스토어에 반영한다", async () => {
    settingsEntries.current = [["language", "ko"]];
    render(
      <SettingsProvider>
        <div />
      </SettingsProvider>,
    );
    await waitFor(() => expect(getLangSetting()).toBe("ko"));
    expect(getLang()).toBe("ko");
  });

  it("<html lang> 을 해석된 언어로 맞춘다 (스크린리더 · :lang() CSS)", async () => {
    settingsEntries.current = [["language", "ko"]];
    render(
      <SettingsProvider>
        <div />
      </SettingsProvider>,
    );
    await waitFor(() => expect(document.documentElement.lang).toBe("ko"));
  });

  it("설정이 비어 있으면 DEFAULTS 의 system 이 적용된다", async () => {
    settingsEntries.current = [];
    render(
      <SettingsProvider>
        <div />
      </SettingsProvider>,
    );
    await waitFor(() => expect(getLangSetting()).toBe("system"));
    // setup 이 고정한 로케일(ko-KR) → ko 로 해석.
    expect(getLang()).toBe("ko");
    expect(document.documentElement.lang).toBe("ko");
  });

  it("DB 에 깨진 값이 있어도 앱이 죽지 않고 system 으로 접힌다", async () => {
    settingsEntries.current = [["language", "fr"]];
    render(
      <SettingsProvider>
        <div />
      </SettingsProvider>,
    );
    await waitFor(() => expect(getLangSetting()).toBe("system"));
    expect(getLang()).toBe("ko");
  });
});
