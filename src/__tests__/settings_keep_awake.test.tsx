/**
 * 설정 · 앱의 잠자기 막기 줄 (love-round L6, 11-23 사용자 결정) — 기본 꺼짐, 「켜기」 는 `keep_awake=on` 을 쓰고
 * 백엔드(`keep_awake.rs`)가 일하는 Claude 세션이 있는 동안만 막는다. 「on」 밖의 저장값은 꺼짐. Linux 는 단추 없이
 * 안내만(프로세스 안에서 막는 길이 없다 — 새 자식 프로세스 금지).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  settings: [] as Array<[string, string]>,
  settingsSet: vi.fn(async (_k: string, _v: string) => ({ status: "ok", data: null })),
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
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { SettingsProvider } from "@/contexts/SettingsContext";
import { KeepAwakeRow, keepAwakeSupported } from "@/features/settings/KeepAwakeRow";
import { __resetLangForTests, setLangSetting, t } from "@/i18n";
import { __setPlatformForTests } from "@/lib/platform";

function renderRow() {
  return render(
    <SettingsProvider>
      <KeepAwakeRow />
    </SettingsProvider>,
  );
}

beforeEach(() => {
  setLangSetting("ko");
  fx.settings = [];
  __setPlatformForTests("mac");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __setPlatformForTests(null);
  __resetLangForTests();
});

describe("keep awake row", () => {
  it("is off by default and turning it on writes keep_awake=on", async () => {
    renderRow();
    const btn = await screen.findByRole("button", { name: t("prefs.keepAwake.turnOn") });
    expect(screen.getByText(t("prefs.keepAwake.off"))).toBeTruthy();
    fireEvent.click(btn);
    await waitFor(() => expect(fx.settingsSet).toHaveBeenCalledWith("keep_awake", "on"));
  });

  it("reads a stored on and turning it off writes keep_awake=off", async () => {
    fx.settings = [["keep_awake", "on"]];
    renderRow();
    const btn = await screen.findByRole("button", { name: t("prefs.keepAwake.turnOff") });
    expect(screen.getByText(t("prefs.keepAwake.on"))).toBeTruthy();
    fireEvent.click(btn);
    await waitFor(() => expect(fx.settingsSet).toHaveBeenCalledWith("keep_awake", "off"));
  });

  it("treats any stored value but on as off — the backend uses the same rule", async () => {
    fx.settings = [["keep_awake", "true"]];
    renderRow();
    expect(await screen.findByRole("button", { name: t("prefs.keepAwake.turnOn") })).toBeTruthy();
  });

  it("offers no switch on Linux, only how to do it in the system settings", async () => {
    __setPlatformForTests("linux");
    renderRow();
    expect(await screen.findByText(t("prefs.keepAwake.unsupported"))).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is supported exactly where an in-process API exists", () => {
    expect(keepAwakeSupported("mac")).toBe(true);
    expect(keepAwakeSupported("windows")).toBe(true);
    expect(keepAwakeSupported("linux")).toBe(false);
  });
});
