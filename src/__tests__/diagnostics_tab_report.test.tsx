// Settings → Diagnostics → feedback (#w5-report): "copy diagnostics" writes the
// prefetched report inside the click (WebKit refuses clipboard writes after an
// await), and on Windows/Linux the bug button opens the platform bug form.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls: { openUrl: string[]; report: number } = { openUrl: [], report: 0 };

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === "appInfo") return () => ok({ version: "3.6.0" });
          if (prop === "diagnosticsReport")
            return () => {
              calls.report += 1;
              return ok({
                app_version: "3.6.0",
                os: "linux",
                os_version: "Ubuntu 22.04.4 LTS · kernel 6.5.0",
                arch: "x86_64",
                webview: "WebKitGTK 2.44.3",
                session: "wayland · GNOME",
                timezone: "Etc/UTC",
                log_dir: "~/.local/share/com.kimhyunbin.ocul-pm/logs",
              });
            };
          if (prop === "openUrl")
            return (url: string) => {
              calls.openUrl.push(url);
              return ok(null);
            };
          return () => ok(null);
        },
      },
    ),
  };
});
vi.mock("@/features/settings/tabs/DoctorSection", () => ({ DoctorSection: () => null }));
vi.mock("@/features/settings/tabs/FiringInsights", () => ({ FiringInsights: () => null }));
vi.mock("@/features/settings/tabs/IndexUsageSection", () => ({ IndexUsageSection: () => null }));
vi.mock("@/features/settings/automation/AutomationTroubleshooting", () => ({
  AutomationTroubleshooting: () => null,
}));

import { DiagnosticsTab } from "@/features/settings/tabs/DiagnosticsTab";
import { t } from "@/i18n";

const writeText = vi.fn((_text: string) => Promise.resolve());

beforeEach(() => {
  calls.openUrl = [];
  calls.report = 0;
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DiagnosticsTab feedback (#w5-report)", () => {
  it("copies the prefetched diagnostics block", async () => {
    render(<DiagnosticsTab onError={() => {}} />);
    // The mount fetches once; the click then writes without another round trip.
    await waitFor(() => expect(calls.report).toBe(1));
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(screen.getByRole("button", { name: t("settings.feedback.copyDiag") }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(calls.report).toBe(1);
    const text = writeText.mock.calls[0]![0];
    expect(text.startsWith("Ocul-PM diagnostics\n")).toBe(true);
    expect(text).toContain("- WebView: WebKitGTK 2.44.3");
    expect(text).toContain("- Session: wayland · GNOME");
  });

  it("opens the platform bug form off macOS", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
    render(<DiagnosticsTab onError={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: t("settings.feedback.bug") }));
    await waitFor(() => expect(calls.openUrl).toHaveLength(1));
    const url = new URL(calls.openUrl[0]!);
    expect(url.searchParams.get("template")).toBe("platform-bug.yml");
    expect(url.searchParams.get("diagnostics")).toContain("Ubuntu 22.04.4 LTS");
  });

  it("keeps the blank bug issue on macOS", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    render(<DiagnosticsTab onError={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: t("settings.feedback.bug") }));
    await waitFor(() => expect(calls.openUrl).toHaveLength(1));
    const url = new URL(calls.openUrl[0]!);
    expect(url.searchParams.get("template")).toBeNull();
    expect(url.searchParams.get("labels")).toBe("bug");
  });
});
