import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

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

import { UpdateBanner, isNewerVersion } from "@/components/UpdateBanner";
import { releaseHighlights } from "@/lib/updater";

afterEach(() => {
  fx.update = null;
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
