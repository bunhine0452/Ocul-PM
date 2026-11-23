import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// @ts-expect-error — release tooling (.mjs, no types), not part of the app build.
import { filesIn, main, updateCask, updateWingetInstaller, updateWingetLocale, updateWingetVersion, versionOfAsset } from "../../scripts/packaging/update-manifests.mjs";

// The install channels (packaging/) point at release assets that release.yml makes. They live outside the app and
// the app never reads them — so nothing but this file notices when an asset name, the .app name, the bundle id or
// the minimum macOS drifts away from them. Each assertion is written so that reverting the manifest (or the
// release naming it follows) turns it red.

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const cask = read("packaging/homebrew/ocul-pm.rb");
const wingetVersion = read("packaging/winget/KimHyunbin.Ocul.yaml");
const wingetInstaller = read("packaging/winget/KimHyunbin.Ocul.installer.yaml");
const wingetLocale = read("packaging/winget/KimHyunbin.Ocul.locale.en-US.yaml");
const tauri = JSON.parse(read("src-tauri/tauri.conf.json")) as { identifier: string; version: string; app?: unknown; bundle: { macOS: { bundleName: string; minimumSystemVersion: string }; targets: string } };
const field = (text: string, key: string) => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(text)?.[1].trim();
const caskVersion = /^\s*version\s+"([^"]+)"/m.exec(cask)?.[1] ?? "";
const changedLines = (a: string, b: string) => a.split("\n").filter((line, i) => line !== b.split("\n")[i]).length;

const tmp = mkdtempSync(join(tmpdir(), "packaging-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("the cask follows what release.yml ships", () => {
  it("downloads the signed Apple Silicon dmg that notes.mjs and the macOS job name", () => {
    expect(cask).toContain("Ocul-PM_#{version}_aarch64.dmg");
    expect(cask).toContain("releases/download/v#{version}/");
    // the release notes table keys the macOS row on this very suffix
    expect(read(".github/scripts/release/notes.mjs")).toContain("_aarch64\\.dmg$");
    expect(cask).toMatch(/depends_on arch: :arm64/);
  });

  it("installs the .app the bundle config names and zaps only the bundle identifier's folders", () => {
    expect(cask).toContain(`app "${tauri.bundle.macOS.bundleName}.app"`);
    const zap = cask.slice(cask.indexOf("zap trash"));
    const lines = zap.split("\n").filter((l) => l.includes("~/"));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toContain(tauri.identifier);
    // project records (.oculpm) and Claude's own folder are the user's — never in a zap
    expect(zap).not.toMatch(/\.oculpm|\.claude/);
  });

  it("asks for the same minimum macOS as the bundle", () => {
    expect(tauri.bundle.macOS.minimumSystemVersion).toBe("13.0");
    expect(cask).toContain('depends_on macos: ">= :ventura"');
  });

  it("looks for new versions among v<number> tags so the extension's ext-v tags cannot take the latest", () => {
    expect(cask).toMatch(/strategy :git/);
    const re = /regex\(\/(.+)\/i\)/.exec(cask)?.[1] ?? "";
    expect(new RegExp(re, "i").test("v4.12.1")).toBe(true);
    expect(new RegExp(re, "i").test("ext-v0.3.0")).toBe(false);
  });
});

describe("the winget manifests follow what release.yml ships", () => {
  it("share one identifier and version, schema 1.6+", () => {
    for (const t of [wingetVersion, wingetInstaller, wingetLocale]) {
      expect(field(t, "PackageIdentifier")).toBe("KimHyunbin.Ocul");
      expect(field(t, "PackageVersion")).toBe(field(wingetVersion, "PackageVersion"));
      const [maj, min] = (field(t, "ManifestVersion") ?? "0.0.0").split(".").map(Number);
      expect(maj > 1 || (maj === 1 && min >= 6)).toBe(true);
    }
    expect(field(wingetVersion, "ManifestType")).toBe("version");
    expect(field(wingetInstaller, "ManifestType")).toBe("installer");
    expect(field(wingetLocale, "ManifestType")).toBe("defaultLocale");
  });

  it("points at the x64 NSIS setup exe latest-json.mjs names, per user", () => {
    const v = field(wingetInstaller, "PackageVersion");
    expect(read(".github/scripts/release/latest-json.mjs")).toContain("Ocul-PM_${version}_x64-setup.exe");
    expect(wingetInstaller).toContain(`https://github.com/bunhine0452/Ocul-PM/releases/download/v${v}/Ocul-PM_${v}_x64-setup.exe`);
    expect(field(wingetInstaller, "InstallerType")).toBe("nsis");
    expect(wingetInstaller).toMatch(/Architecture: x64/);
    expect(field(wingetInstaller, "Scope")).toBe("user");
    expect(tauri.bundle.targets).toBe("all");
  });

  it("links release notes of its own version", () => {
    expect(field(wingetLocale, "ReleaseNotesUrl")).toBe(`https://github.com/bunhine0452/Ocul-PM/releases/tag/v${field(wingetVersion, "PackageVersion")}`);
  });
});

describe("versions are well-formed and never ahead of the app", () => {
  const num = (v: string) => v.split(".").map((x) => parseInt(x, 10));
  const notAhead = (v: string) => {
    const [a, b] = [num(v), num(tauri.version)];
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return true;
  };
  it("cask and winget carry a plain semver at or below tauri.conf.json", () => {
    for (const v of [caskVersion, field(wingetVersion, "PackageVersion") ?? ""]) {
      expect(v).toMatch(/^\d+\.\d+\.\d+$/);
      expect(notAhead(v)).toBe(true);
    }
  });
});

describe("update-manifests.mjs", () => {
  const sha = "ab".repeat(32);

  it("reads the version from the asset name and refuses any other file", () => {
    expect(versionOfAsset("dmg", "/x/Ocul-PM_4.13.0_aarch64.dmg")).toBe("4.13.0");
    expect(versionOfAsset("exe", "https://github.com/o/r/releases/download/v4.13.0/Ocul-PM_4.13.0_x64-setup.exe?x=1")).toBe("4.13.0");
    expect(() => versionOfAsset("dmg", "Ocul-PM_4.13.0_x64.dmg")).toThrow();
    expect(() => versionOfAsset("exe", "Ocul-PM_4.13.0_aarch64.dmg")).toThrow();
    expect(() => versionOfAsset("dmg", "notes.txt")).toThrow();
  });

  it("changes only the version and sha256 lines of the cask", () => {
    const out = updateCask(cask, { version: "9.9.9", sha256: sha.toUpperCase() });
    expect(out).toContain('version "9.9.9"');
    expect(out).toContain(`sha256 "${sha}"`);
    expect(changedLines(cask, out)).toBe(caskVersion === "9.9.9" ? 1 : 2);
    expect(() => updateCask(cask, { version: "9.9.9", sha256: "not-a-hash" })).toThrow();
  });

  it("changes version, date, url and sha256 of the installer manifest and keeps the rest", () => {
    const out = updateWingetInstaller(wingetInstaller, { version: "9.9.9", sha256: sha, date: "2026-12-01" });
    expect(out).toContain("PackageVersion: 9.9.9");
    expect(out).toContain("ReleaseDate: 2026-12-01");
    expect(out).toContain("releases/download/v9.9.9/Ocul-PM_9.9.9_x64-setup.exe");
    expect(out).toContain(`InstallerSha256: ${sha.toUpperCase()}`);
    expect(changedLines(wingetInstaller, out)).toBeLessThanOrEqual(4);
    expect(out).toContain("InstallerType: nsis");
    expect(() => updateWingetInstaller(wingetInstaller, { version: "9.9.9", sha256: sha, date: "12/01" })).toThrow();
    expect(updateWingetVersion(wingetVersion, { version: "9.9.9" })).toContain("PackageVersion: 9.9.9");
    expect(updateWingetLocale(wingetLocale, { version: "9.9.9" })).toContain("releases/tag/v9.9.9");
  });

  it("fails loudly when a manifest line it must edit is gone", () => {
    expect(() => updateCask(cask.replace(/^\s*sha256 ".*$/m, ""), { version: "9.9.9", sha256: sha })).toThrow(/sha256/);
  });

  it("hashes local files without touching the network, and writes nothing if any input is refused", async () => {
    const root = join(tmp, "root");
    mkdirSync(join(root, "packaging"), { recursive: true });
    cpSync(join(ROOT, "packaging"), join(root, "packaging"), { recursive: true });
    const dmg = join(tmp, "Ocul-PM_9.9.9_aarch64.dmg");
    writeFileSync(dmg, "dmg bytes");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must not be used for local paths"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await main(["--dmg", dmg], root)).toBe(0);
      const caskOut = readFileSync(filesIn(root).cask, "utf8");
      expect(caskOut).toContain('version "9.9.9"');
      expect(caskOut).toMatch(/sha256 "[0-9a-f]{64}"/);
      expect(caskOut).not.toContain("0".repeat(64));
      expect(fetchSpy).not.toHaveBeenCalled();

      // a wrongly named exe after a good dmg: the cask must keep what it had before this call
      const before = readFileSync(filesIn(root).cask, "utf8");
      const bad = join(tmp, "setup.exe");
      writeFileSync(bad, "x");
      await expect(main(["--dmg", dmg, "--exe", bad, "--date", "2026-12-01"], root)).rejects.toThrow();
      expect(readFileSync(filesIn(root).cask, "utf8")).toBe(before);
      expect(readFileSync(filesIn(root).wingetInstaller, "utf8")).toBe(wingetInstaller);
    } finally {
      fetchSpy.mockRestore();
      log.mockRestore();
    }
  });
});
