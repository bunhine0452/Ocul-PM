import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// 업데이트와 앱 안 터미널 (10-31) — 4.0 터미널이 「끊으면 안 되는 일」 에 들지 않아 업데이트가
// 묻지 않고 세션을 끊었다. 이제 무언가 돌면 깔아만 두고 기다리고, 재시작 뒤 claude 가 돌던 세션은
// 같은 폴더에서 `claude --continue` 로 잇는다.

const fx = vi.hoisted(() => ({
  busy: { busy: 0, claude: 0 },
  onChanged: null as null | (() => void),
  resume: [] as { project_id: number; lane: string | null }[],
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(() => Promise.resolve({ version: "4.2.1", downloadAndInstall: () => Promise.resolve() })),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(() => Promise.resolve()) }));
vi.mock("@/api/window", () => ({ windowApi: { saveSession: vi.fn(() => Promise.resolve(null)) } }));
vi.mock("@/api/installKind", () => ({ installKindApi: { get: () => Promise.resolve(null) } }));
vi.mock("@/lib/oculpmLog", () => ({ oculpmLog: { info: () => {}, warn: () => {} } }));
vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn() } }));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    busyAll: vi.fn(() => Promise.resolve(fx.busy)),
    onSessionsChanged: vi.fn((cb: () => void) => {
      fx.onChanged = cb;
      return Promise.resolve(() => {});
    }),
    takeResume: vi.fn(() => Promise.resolve(fx.resume)),
  },
}));
vi.mock("@/features/terminal/termStore", () => ({ openTerm: vi.fn(() => Promise.resolve(1)) }));

import { relaunch } from "@tauri-apps/plugin-process";
import { windowApi } from "@/api/window";
import { openTerm } from "@/features/terminal/termStore";
import { resumeAfterUpdate } from "@/features/terminal/resumeAfterUpdate";
import { setLangSetting } from "@/i18n";
import { NAV_BUS } from "@/lib/navRegistry";
import { toast } from "@/lib/toast";
import { useUpdater } from "@/lib/updater";

afterEach(() => {
  fx.busy = { busy: 0, claude: 0 };
  fx.onChanged = null;
  fx.resume = [];
  vi.clearAllMocks();
});

async function installed() {
  const hook = renderHook(() => useUpdater());
  await act(async () => {
    await hook.result.current.check();
  });
  await act(async () => {
    await hook.result.current.install();
  });
  return hook;
}

describe("업데이트 × 터미널", () => {
  it("터미널에서 claude 가 돌면 깔아만 두고 묻는다 — 끝나면 그때 재시작한다", async () => {
    setLangSetting("ko");
    fx.busy = { busy: 2, claude: 1 };
    const { result } = await installed();

    expect(relaunch).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({
      kind: "awaiting",
      reason: "터미널 세션 2개가 실행 중이에요(claude 대화는 재시작 뒤 이어서 열어요)",
    });

    // 세션이 끝났다는 사건 — 다시 세어 0 이면 창 구성을 적고 다시 띄운다.
    fx.busy = { busy: 0, claude: 0 };
    await act(async () => {
      fx.onChanged?.();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1));
    expect(windowApi.saveSession).toHaveBeenCalledTimes(1);
  });

  it("빈 셸만 있으면 묻지 않고 바로 재시작한다", async () => {
    await installed();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});

describe("재시작 뒤 claude 잇기", () => {
  it("이 창의 프로젝트 것만 `claude --continue` 로 열고 터미널 화면으로 간다", async () => {
    setLangSetting("ko");
    fx.resume = [
      { project_id: 3, lane: null },
      { project_id: 8, lane: null },
      { project_id: 3, lane: "/data/races/p3/a-2" },
    ];
    const views: string[] = [];
    const onView = (e: Event) => views.push((e as CustomEvent<string>).detail);
    window.addEventListener(NAV_BUS.setView, onView);

    expect(await resumeAfterUpdate(3)).toBe(2);
    window.removeEventListener(NAV_BUS.setView, onView);

    expect(vi.mocked(openTerm).mock.calls).toEqual([
      [3, null, null, true],
      [3, null, "/data/races/p3/a-2", true],
    ]);
    expect(views).toEqual(["terminal"]);
    expect(toast.info).toHaveBeenCalledWith("업데이트 전 claude 대화 2개를 이어서 열었어요");
  });

  it("이을 것이 없으면(평소) 아무것도 열지 않는다", async () => {
    expect(await resumeAfterUpdate(3)).toBe(0);
    expect(openTerm).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});
