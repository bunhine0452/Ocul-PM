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
