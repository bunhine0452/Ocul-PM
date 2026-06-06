import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

// ─── Release update notifier (1.0) ────────────────────────────────────────
// Compares the running version (app_info) to the newest published GitHub
// release (github_releases) and shows a dismissible banner when newer.

const fx = {
  version: "1.0.0",
  releases: [] as Array<Record<string, unknown>>,
};

vi.mock("@/lib/bindings", () => ({
  commands: {
    appInfo: () => Promise.resolve({ status: "ok", data: { version: fx.version } }),
    githubReleases: () => Promise.resolve({ status: "ok", data: fx.releases }),
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

import { UpdateBanner, isNewerVersion } from "@/components/UpdateBanner";

function release(over: Partial<Record<string, unknown>> = {}) {
  return {
    tag_name: "v1.1.0",
    name: "v1.1.0",
    body: null,
    html_url: "https://github.com/bunhine0452/Ocul-PM/releases/tag/v1.1.0",
    published_at: null,
    draft: false,
    prerelease: false,
    author_login: null,
    ...over,
  };
}

beforeEach(() => {
  fx.version = "1.0.0";
  fx.releases = [];
});
afterEach(() => cleanup());

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
  it("shows a banner when a newer release exists", async () => {
    fx.version = "1.0.0";
    fx.releases = [release({ tag_name: "v1.2.0", html_url: "https://x/y" })];
    const { findByText } = render(<UpdateBanner />);
    expect(await findByText(/v1\.2\.0/)).toBeInTheDocument();
    expect(await findByText("다운로드")).toBeInTheDocument();
  });

  it("stays hidden when up to date", async () => {
    fx.version = "1.0.0";
    fx.releases = [release({ tag_name: "v1.0.0" })];
    const { container } = render(<UpdateBanner />);
    await waitFor(() => {
      // give the effect a tick; banner must not appear.
      expect(container.querySelector(".update-banner")).toBeNull();
    });
  });

  it("ignores draft / prerelease releases", async () => {
    fx.version = "1.0.0";
    fx.releases = [
      release({ tag_name: "v2.0.0", draft: true }),
      release({ tag_name: "v2.0.0-rc1", prerelease: true }),
    ];
    const { container } = render(<UpdateBanner />);
    await waitFor(() => {
      expect(container.querySelector(".update-banner")).toBeNull();
    });
  });
});
