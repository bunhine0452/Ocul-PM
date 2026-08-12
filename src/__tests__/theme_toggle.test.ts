import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";

// ─── PR-UI 0 — theme applies the `data-theme` attribute (decision A) ───────
//
// The Final UI Update token system (src/styles/tokens.css) keys dark mode off
// `[data-theme="dark"]`. Decision A (2026-05-31) keeps SettingsContext as the
// single source of truth for theme — no parallel ThemeContext /
// localStorage["oculpm-theme"] store. SettingsContext now writes BOTH the
// legacy `.dark` class (old shadcn UI) and the new `data-theme` attribute so
// the ui_v2 transition needs no second store. These tests lock that behaviour.

// SettingsContext hydrates via commands.settingsGetAll; stub the bindings so
// the provider resolves to DEFAULTS (theme: "system") without a Tauri runtime.
vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "settingsGetAll")
            return () => ok([] as Array<[string, string]>);
          return () => ok(null);
        },
      },
    ),
    // SettingsProvider 는 설정 변경 브로드캐스트를 구독한다 (창을 가로질러
    // 테마·언어를 맞추는 경로) — 아무 이벤트나 no-op 구독으로 답한다.
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { SettingsProvider, useSettings } from "@/contexts/SettingsContext";

function setMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  setMatchMedia(false);
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
});

function mountSettings() {
  return renderHook(() => useSettings(), { wrapper: SettingsProvider });
}

describe("PR-UI 0 — data-theme attribute toggle", () => {
  it("default 'system' + light OS preference → data-theme='light', no .dark", async () => {
    const { result } = mountSettings();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("light"),
    );  });

  it("setting theme='dark' sets data-theme + .dark, and round-trips to light", async () => {
    const { result } = mountSettings();
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.set("theme", "dark");
    });
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark"),
    );
    await act(async () => {
      await result.current.set("theme", "light");
    });
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("light"),
    );  });

  it("theme='system' follows the OS dark preference", async () => {
    setMatchMedia(true);
    const { result } = mountSettings();
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.set("theme", "system");
    });
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark"),
    );  });
});
