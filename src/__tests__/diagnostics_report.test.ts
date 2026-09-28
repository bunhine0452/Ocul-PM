import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticsReport } from "@/lib/bindings";
import {
  PLATFORM_BUG_TEMPLATE,
  formatDiagnostics,
  platformBugIssueUrl,
} from "@/features/settings/tabs/diagnosticsReport";

const windows: DiagnosticsReport = {
  app_version: "3.6.0",
  os: "windows",
  os_version: "Windows 11 23H2 (build 22631.4460)",
  arch: "x86_64",
  webview: "WebView2 131.0.2903.70",
  session: null,
  timezone: "Europe/Berlin",
  log_dir: "~\\AppData\\Roaming\\com.kimhyunbin.ocul-pm\\logs",
};

describe("formatDiagnostics (#w5-report)", () => {
  it("writes language-neutral key lines; install stays unknown until the install-kind command lands", () => {
    const text = formatDiagnostics(windows, null);
    expect(text.split("\n")).toEqual([
      "Ocul-PM diagnostics",
      "- App: 3.6.0",
      "- OS: Windows 11 23H2 (build 22631.4460)",
      "- Arch: x86_64",
      "- WebView: WebView2 131.0.2903.70",
      "- Install: unknown",
      "- Timezone: Europe/Berlin",
      "- Logs: ~\\AppData\\Roaming\\com.kimhyunbin.ocul-pm\\logs",
    ]);
    expect(formatDiagnostics(windows, "nsis")).toContain("- Install: nsis");
  });

  it("adds the Linux session line and falls back when a field is unreadable", () => {
    const text = formatDiagnostics(
      { ...windows, os: "linux", os_version: null, webview: null, session: "wayland · GNOME", log_dir: null },
      null,
    );
    expect(text).toContain("- OS: Linux");
    expect(text).toContain("- WebView: unknown");
    expect(text).toContain("- Session: wayland · GNOME");
    expect(text).toContain("- Logs: (file logging off)");
  });

  it("names the system WKWebView on macOS", () => {
    const text = formatDiagnostics(
      { ...windows, os: "macos", os_version: "macOS 15.2 (24C101)", webview: null },
      null,
    );
    expect(text).toContain("- WebView: WKWebView (bundled with macOS)");
    expect(text).not.toContain("Session");
  });
});

describe("platformBugIssueUrl", () => {
  it("opens the platform bug form with version and diagnostics prefilled", () => {
    const diag = formatDiagnostics(windows, null);
    const url = new URL(platformBugIssueUrl("bunhine0452/Ocul-PM", "[Bug] ", "3.6.0", diag));
    expect(url.origin + url.pathname).toBe("https://github.com/bunhine0452/Ocul-PM/issues/new");
    expect(url.searchParams.get("template")).toBe("platform-bug.yml");
    expect(url.searchParams.get("title")).toBe("[Bug] ");
    expect(url.searchParams.get("version")).toBe("3.6.0");
    expect(url.searchParams.get("diagnostics")).toBe(diag);
  });

  /** A query key that is not a field id in the form is silently dropped — keep them in sync. */
  it("prefills only field ids that exist in the form", () => {
    const yml = readFileSync(
      join(__dirname, "../../.github/ISSUE_TEMPLATE", PLATFORM_BUG_TEMPLATE),
      "utf8",
    );
    expect(yml).toMatch(/^\s+id: version$/m);
    expect(yml).toMatch(/^\s+id: diagnostics$/m);
  });
});
