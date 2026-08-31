import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SettingsProvider } from "@/contexts/SettingsContext";
import { CoreModelSeededCard } from "@/features/today/CoreModelSeededCard";
import { coreModelTarget, DEFAULTS, entriesToSettings, KEYS } from "@/lib/settings";

// 배경 작업 모델 슬롯 (Osaurus 벤치마크 라운드 Phase 0, Decision 2).
//
// 이 파일이 지키는 계약 둘:
//  1. `coreModelTarget` 은 백엔드 `core_model::resolve` 와 **같은 판정**이다 —
//     미설정이면 대화 모델로 조용히 대체하지 않는다. 대체하면 "몰랐는데
//     과금됐다" 를 막으려던 게이트가 무의미해진다.
//  2. 1회 시드는 조용히 일어나지 않는다 — 표식이 있으면 카드가 뜨고, 닫으면
//     표식이 비워져 다시 뜨지 않는다.

const settingsEntries = vi.hoisted(() => ({ current: [] as Array<[string, string]> }));
const setCalls = vi.hoisted(() => ({ current: [] as Array<[string, string]> }));

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

beforeEach(() => {
  settingsEntries.current = [];
  setCalls.current = [];
});

afterEach(cleanup);

describe("coreModelTarget", () => {
  it("미설정이면 null — 대화 모델로 조용히 대체하지 않는다", () => {
    const settings = entriesToSettings([
      [KEYS.defaultProvider, "anthropic"],
      [KEYS.modelAnthropic, "claude-sonnet-4-6"],
    ]);
    expect(settings.defaultProvider).toBe("anthropic");
    expect(coreModelTarget(settings)).toBeNull();
  });

  it("둘 다 채워져야 대상이 된다", () => {
    const half = entriesToSettings([[KEYS.coreProvider, "openai"]]);
    expect(coreModelTarget(half)).toBeNull();

    const full = entriesToSettings([
      [KEYS.coreProvider, "openai"],
      [KEYS.coreModel, "gpt-4o-mini"],
    ]);
    expect(coreModelTarget(full)).toEqual({ provider: "openai", model: "gpt-4o-mini" });
  });

  it("모르는 공급자는 대상이 아니다", () => {
    const bogus = entriesToSettings([
      [KEYS.coreProvider, "bogus"],
      [KEYS.coreModel, "whatever"],
    ]);
    expect(coreModelTarget(bogus)).toBeNull();
  });

  it("기본값은 미설정 — 신규 사용자에게는 게이트다", () => {
    expect(DEFAULTS.coreProvider).toBe("");
    expect(DEFAULTS.coreModel).toBe("");
    expect(coreModelTarget(DEFAULTS)).toBeNull();
  });
});

describe("1회 시드 안내 카드", () => {
  it("표식이 없으면 뜨지 않는다", async () => {
    render(
      <SettingsProvider>
        <CoreModelSeededCard />
      </SettingsProvider>,
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("표식이 있으면 시드된 값과 함께 한 번 뜨고, 닫으면 표식을 비운다", async () => {
    settingsEntries.current = [[KEYS.coreModelSeeded, "anthropic:claude-sonnet-4-6"]];
    render(
      <SettingsProvider>
        <CoreModelSeededCard />
      </SettingsProvider>,
    );

    const card = await screen.findByRole("status");
    expect(card.textContent).toContain("anthropic:claude-sonnet-4-6");

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() =>
      expect(setCalls.current).toContainEqual([KEYS.coreModelSeeded, ""]),
    );
  });
});
