import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";

// ─── Self-update banner (benchmarked from uvws) ───────────────────────────
// The updater plugin's check() returns an Update (or null). We mock it and
// assert the banner appears with the version + in-place install button.

const fx = {
  update: null as null | { version: string; downloadAndInstall: () => Promise<void> },
  /** 플러그인 check 가 거절할 문장 (IPC 는 오류를 문자열로 싣는다). */
  checkError: null as string | null,
  /** `install_kind` 커맨드의 응답 — null 이면 커맨드가 실패한 것으로 친다. */
  install: null as null | { os: string; arch: string; bundle_type: string | null; updater_targets: string[] },
};

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(() => (fx.checkError != null ? Promise.reject(fx.checkError) : Promise.resolve(fx.update))),
}));
const openUrl = vi.fn((_url: string) => Promise.resolve({ status: "ok" as const, data: null }));
vi.mock("@/lib/bindings", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/bindings")>();
  return {
    ...orig,
    commands: {
      ...orig.commands,
      installKind: () => (fx.install ? Promise.resolve(fx.install) : Promise.reject(new Error("no ipc"))),
      appInfo: () =>
        Promise.resolve({
          status: "ok" as const,
          data: { version: "3.5.0", db_path: "", app_data_dir: "", secrets_store: "" },
        }),
      openUrl: (url: string) => openUrl(url),
      oculpmLog: () => Promise.resolve(null),
    },
  };
});
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(() => Promise.resolve()) }));
// 업데이트 재시작은 창·탭 스냅숏을 먼저 남긴다 — 새 버전이 그것을 보고
// 열어 두었던 프로젝트 창들을 되살린다.
vi.mock("@/api/window", () => ({ windowApi: { saveSession: vi.fn(() => Promise.resolve(null)) } }));

import { check as pluginCheck } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { windowApi } from "@/api/window";
import { UpdateBanner, isNewerVersion } from "@/components/UpdateBanner";
import { UpdateTab } from "@/features/settings/tabs/UpdateTab";
import { releaseHighlights, useUpdater } from "@/lib/updater";
import { RELEASES_PAGE } from "@/lib/updaterRoute";

afterEach(() => {
  fx.update = null;
  fx.checkError = null;
  fx.install = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  // 호출 기록만 지운다 (구현은 남긴다) — 재시작 테스트가 서로의 호출 수를
  // 물려받지 않게.
  vi.clearAllMocks();
  cleanup();
});

describe("isNewerVersion", () => {
  it("detects newer / older / equal (with optional v prefix)", () => {
    expect(isNewerVersion("v1.1.0", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("0.9.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("v1.0.0", "v1.0.0")).toBe(false);
  });
  it("non-numeric / unparseable tags never nag", () => {
    expect(isNewerVersion("nightly", "1.0.0")).toBe(false);
    expect(isNewerVersion("", "1.0.0")).toBe(false);
  });
});

describe("releaseHighlights", () => {
  const body = [
    "## Ocul-PM v1.1.1",
    "",
    "### ✨ What's new",
    "- 작업일지 변경 diff가 과거 일지에도 표시돼요",
    "",
    "### Downloads",
    "| Platform | File |",
    "|---|---|",
    "",
    "### ⚠️ macOS 첫 실행",
    "공증 전 빌드라…",
  ].join("\n");

  it("extracts only the What's new section (drops Downloads / notarization)", () => {
    const out = releaseHighlights(body);
    expect(out).toContain("과거 일지에도 표시돼요");
    expect(out).not.toContain("Downloads");
    expect(out).not.toContain("macOS 첫 실행");
    expect(out).not.toContain("## Ocul-PM"); // title line dropped too
  });

  it("empty / null notes yield an empty string", () => {
    expect(releaseHighlights(null)).toBe("");
    expect(releaseHighlights("")).toBe("");
  });

  it("falls back to the body (sans title) when no What's-new heading", () => {
    const out = releaseHighlights("## Ocul-PM v9\n\n- 그냥 변경점");
    expect(out).toContain("그냥 변경점");
    expect(out).not.toContain("## Ocul-PM");
  });
});

describe("UpdateBanner", () => {
  it("shows a banner when the updater reports a newer build", async () => {
    fx.update = { version: "1.2.0", downloadAndInstall: vi.fn(() => Promise.resolve()) };
    const { findByText } = render(<UpdateBanner />);
    expect(await findByText(/v1\.2\.0/)).toBeInTheDocument();
    expect(await findByText("지금 업데이트")).toBeInTheDocument();
  });

  it("asks again on a timer and on wake, but not on every focus (E1)", async () => {
    vi.useFakeTimers();
    try {
      fx.update = null;
      let calls = 0;
      const mod = await import("@tauri-apps/plugin-updater");
      const spy = vi.spyOn(mod, "check").mockImplementation(() => {
        calls += 1;
        return Promise.resolve(null as never);
      });
      render(<UpdateBanner />);
      await act(async () => {});
      expect(calls).toBe(1);
      // 방금 물어봤다 — 초점이 돌아와도 다시 묻지 않는다.
      window.dispatchEvent(new Event("focus"));
      await act(async () => {});
      expect(calls).toBe(1);
      // 하루가 지나면 스스로 묻는다.
      await act(async () => {
        vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
      });
      expect(calls).toBe(2);
      spy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays hidden when there is no update", async () => {
    fx.update = null;
    const { container } = render(<UpdateBanner />);
    await waitFor(() => {
      expect(container.querySelector(".update-banner")).toBeNull();
    });
  });
});

describe("업데이트 재시작", () => {
  it("다시 띄우기 전에 창·탭을 저장한다 (복원의 유일한 근거)", async () => {
    const { result } = renderHook(() => useUpdater());

    await act(async () => {
      await result.current.restartNow();
    });

    expect(windowApi.saveSession).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(windowApi.saveSession).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(relaunch).mock.invocationCallOrder[0],
    );
  });

  it("저장이 실패해도 재시작을 막지 않는다 — 새 버전이 먼저다", async () => {
    vi.mocked(windowApi.saveSession).mockRejectedValueOnce(new Error("db down"));
    const { result } = renderHook(() => useUpdater());

    await act(async () => {
      await result.current.restartNow();
    });

    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});

// ─── 설치 형식 × 업데이터 (크로스플랫폼 L-UPD #upd-target-missing) ───────────
const DEB = { os: "linux", arch: "x86_64", bundle_type: "deb", updater_targets: ["linux-x86_64-deb", "linux-x86_64"] };
const APPIMAGE = {
  os: "linux",
  arch: "x86_64",
  bundle_type: "appimage",
  updater_targets: ["linux-x86_64-appimage", "linux-x86_64"],
};
/** tauri-plugin-updater 2.10.1 의 실제 문장. */
const TARGETS_NOT_FOUND =
  'None of the fallback platforms `["linux-x86_64-appimage", "linux-x86_64"]` were found in the response `platforms` object';

/** 설정 탭은 GitHub 릴리스 목록도 읽는다 — 테스트에서는 밖으로 나가지 않게 막는다. */
function stubReleasesFetch() {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })));
}

describe("설치 형식 × 업데이터", () => {
  it("deb 설치본은 업데이터에 묻지 않는다 — 패키지 관리자 안내", async () => {
    fx.install = DEB;
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.check();
    });
    expect(pluginCheck).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({ kind: "packageManaged", format: "deb" });
  });

  it("대상 없음은 오류가 아니라 noBuild 다", async () => {
    fx.install = APPIMAGE;
    fx.checkError = TARGETS_NOT_FOUND;
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.status).toEqual({ kind: "noBuild", targets: APPIMAGE.updater_targets });
  });

  it("설치 형식을 몰라도(커맨드 실패) 예전처럼 확인한다", async () => {
    fx.install = null;
    fx.update = { version: "9.0.0", downloadAndInstall: vi.fn(() => Promise.resolve()) };
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.check();
    });
    expect(pluginCheck).toHaveBeenCalledTimes(1);
    expect(result.current.status.kind).toBe("available");
  });

  it("시작 배너는 deb 와 대상 없음에서 조용하다", async () => {
    fx.install = DEB;
    const deb = render(<UpdateBanner />);
    await act(async () => {});
    expect(deb.container.querySelector(".update-banner")).toBeNull();
    deb.unmount();

    fx.install = APPIMAGE;
    fx.checkError = TARGETS_NOT_FOUND;
    const missing = render(<UpdateBanner />);
    await act(async () => {});
    expect(missing.container.querySelector(".update-banner")).toBeNull();
  });

  it("설정 — deb 는 확인 버튼 대신 릴리스 페이지를 연다", async () => {
    stubReleasesFetch();
    fx.install = DEB;
    const view = render(<UpdateTab />);
    expect(await view.findByText(/패키지 관리자로 업데이트해요/)).toBeInTheDocument();
    expect(view.queryByText("업데이트 확인")).toBeNull();
    await act(async () => {
      view.getByRole("button", { name: "릴리스 페이지" }).click();
    });
    expect(openUrl).toHaveBeenCalledWith(RELEASES_PAGE);
  });

  it("설정 — 대상 없음은 오류 문장도 「최신」 도 아닌 중립 문장", async () => {
    stubReleasesFetch();
    fx.install = APPIMAGE;
    fx.checkError = TARGETS_NOT_FOUND;
    const view = render(<UpdateTab />);
    expect(await view.findByText(/이 OS 용 빌드가 아직 없어요/)).toBeInTheDocument();
    expect(view.queryByText(/최신 버전을 사용 중이에요/)).toBeNull();
    expect(view.queryByText(/업데이트를 확인하지 못했어요/)).toBeNull();
    // 다음 릴리스에서 다시 볼 수 있게 확인 버튼은 남는다.
    expect(view.getByText("업데이트 확인")).toBeInTheDocument();
  });
});
