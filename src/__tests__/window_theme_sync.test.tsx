// Windows — the native window learns the app's light/dark theme (2026-11-10). The window has no OS
// title bar, and the OS draws its 1px top edge and system menu in the *window's* theme: a dark app
// on a light OS had a light line across the top. "system" must go as null (follow the OS), because on
// Windows Tauri also pins the webview's prefers-color-scheme to the window theme.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  entries: [] as Array<[string, string]>,
  setTheme: vi.fn(async (_theme: "light" | "dark" | null) => {}),
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      { get: (_t, prop) => (prop === "settingsGetAll" ? () => ok(h.entries) : () => ok(null)) },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: () => Promise.resolve() }),
}));
vi.mock("@/api/window", () => ({ windowApi: { setTheme: h.setTheme } }));

import { SettingsProvider } from "@/contexts/SettingsContext";
import { windowThemeFor } from "@/features/theme/apply";
import { __setPlatformForTests } from "@/lib/platform";

afterEach(() => {
  cleanup();
  __setPlatformForTests(null);
  h.entries = [];
  h.setTheme.mockClear();
});

describe("windowThemeFor", () => {
  it("light · dark pass through; system and removed presets follow the OS (null)", () => {
    expect(windowThemeFor("light")).toBe("light");
    expect(windowThemeFor("dark")).toBe("dark");
    for (const v of ["system", "nord", "custom:abc", ""]) expect(windowThemeFor(v), v).toBeNull();
  });
});

describe("SettingsContext → native window theme", () => {
  it("Windows sends the saved theme to the window", async () => {
    __setPlatformForTests("windows");
    h.entries = [["theme", "dark"]];
    render(
      <SettingsProvider>
        <div />
      </SettingsProvider>,
    );
    await waitFor(() => expect(h.setTheme).toHaveBeenCalledWith("dark"));
  });

  it("Windows with the system theme lets the window follow the OS", async () => {
    __setPlatformForTests("windows");
    h.entries = [["theme", "system"]];
    render(
      <SettingsProvider>
        <div />
      </SettingsProvider>,
    );
    await waitFor(() => expect(h.setTheme).toHaveBeenCalledWith(null));
    expect(h.setTheme).not.toHaveBeenCalledWith("light");
  });

  it("macOS and Linux leave the native window alone", async () => {
    for (const os of ["mac", "linux"] as const) {
      __setPlatformForTests(os);
      h.entries = [["theme", "dark"]];
      const { unmount } = render(
        <SettingsProvider>
          <div />
        </SettingsProvider>,
      );
      await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
      unmount();
    }
    expect(h.setTheme).not.toHaveBeenCalled();
  });
});
