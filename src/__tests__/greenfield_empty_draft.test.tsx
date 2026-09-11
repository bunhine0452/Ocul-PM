import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// 2026-09-11 육안 확인 {#eyes-wizard} — 마법사를 열었다가 아무것도 안 적고
// 2초만 지나면 "새 프로젝트" 라는 빈 초안이 저장됐다. 시작 탭 바닥에
// 「새 프로젝트 · 아이디어 단계에서 멈춤」 이 「새 프로젝트 시작하기」 위에 서서
// 같은 것이 둘로 보였다. 여기서 지키는 것: **내용이 없으면 초안은 없다.**

const saveBlueprint = vi.fn(async (..._args: unknown[]) => ({ status: "ok" as const, data: { id: 7 } }));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "saveBlueprint") return saveBlueprint;
          if (prop === "settingsGetAll") return () => ok([]);
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));

import { GreenfieldWizard } from "@/features/onboarding/GreenfieldWizard";

beforeEach(() => {
  vi.useFakeTimers();
  saveBlueprint.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("빈 마법사는 초안을 남기지 않는다", () => {
  it("열어 두기만 하면 자동 저장이 돌지 않고, 닫아도 저장하지 않는다", async () => {
    render(<GreenfieldWizard onClose={() => {}} onComplete={() => {}} />);
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(saveBlueprint).not.toHaveBeenCalled();
  });

  it("아이디어를 한 줄이라도 적으면 그때부터 초안이 된다", async () => {
    render(<GreenfieldWizard onClose={() => {}} onComplete={() => {}} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "장부 앱" } });
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    expect(saveBlueprint).toHaveBeenCalledTimes(1);
    expect(saveBlueprint.mock.calls[0][2]).toBe("장부 앱");
  });
});
