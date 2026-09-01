import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";

// ─── Self-update banner (benchmarked from uvws) ───────────────────────────
// The updater plugin's check() returns an Update (or null). We mock it and
// assert the banner appears with the version + in-place install button.

const fx = {
  update: null as null | { version: string; downloadAndInstall: () => Promise<void> },
};

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: () => Promise.resolve(fx.update),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(() => Promise.resolve()) }));
// 업데이트 재시작은 창·탭 스냅숏을 먼저 남긴다 — 새 버전이 그것을 보고
// 열어 두었던 프로젝트 창들을 되살린다.
vi.mock("@/api/window", () => ({ windowApi: { saveSession: vi.fn(() => Promise.resolve(null)) } }));

import { relaunch } from "@tauri-apps/plugin-process";
import { windowApi } from "@/api/window";
import { UpdateBanner, isNewerVersion } from "@/components/UpdateBanner";
import { releaseHighlights, useUpdater } from "@/lib/updater";

afterEach(() => {
  fx.update = null;
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
    "- 작업일지 변경 diff가 과거 일지에도 표시됩니다",
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
    expect(out).toContain("과거 일지에도 표시됩니다");
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
