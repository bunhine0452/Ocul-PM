/**
 * OS 경로의 이름·부모 (크로스플랫폼 라운드 {#ui-winpath-name}, E2E 발견).
 *
 * Windows 러너에서 폴더를 골라 들인 프로젝트의 이름이 `D:\a\_temp\…\e2e-fixture` —
 * 경로 전체였다. 이름을 뽑던 자리들이 `/` 로만 잘랐다. 표의 macOS 행은 예전
 * `split("/")` 판정과 같은 답이어야 한다(D3) — 거기서 `\` 는 파일 이름의 글자다.
 */
import { describe, expect, it } from "vitest";

import {
  displaySeparator,
  lastSeparatorIndex,
  pathBaseName,
  pathSegments,
  relativeUnder,
} from "@/lib/osPath";
import { __setPlatformForTests } from "@/lib/platform";
import { formatCwdCrumb } from "@/features/terminal/railModel";
import { splitCrumb } from "@/features/terminal/TerminalPaneHead";

describe("pathBaseName — the folder name a new project is named after", () => {
  const windows: Array<[string, string]> = [
    ["D:\\a\\_temp\\oculpm-e2e-Zqwb9P\\fixture\\e2e-fixture", "e2e-fixture"],
    ["C:\\Users\\me\\proj\\", "proj"],
    ["C:/Users/me/proj", "proj"],
    ["C:\\Users\\me/mixed\\proj", "proj"],
    ["\\\\server\\share\\team\\proj", "proj"],
    ["\\\\server\\share", "share"],
    ["\\\\?\\C:\\Users\\me\\very-long-proj", "very-long-proj"],
    ["\\\\?\\UNC\\server\\share\\proj", "proj"],
    ["\\\\.\\C:\\proj", "proj"],
    ["C:\\", "C:"],
    ["C:\\Users\\me\\한글 폴더", "한글 폴더"], // i18n-ignore -- 경로 픽스처 (한글 폴더 이름)
  ];
  it.each(windows)("windows: %s → %s", (path, name) => {
    expect(pathBaseName(path, "windows")).toBe(name);
  });

  const unix: Array<[string, string]> = [
    ["/Users/me/Desktop/git/ai-pm", "ai-pm"],
    ["/home/runner/work/_temp/fixture/e2e-fixture/", "e2e-fixture"],
    ["/Users/me/odd\\name", "odd\\name"],
    ["/", ""],
    ["", ""],
  ];
  it.each(unix)("mac/linux: %s → %s (backslash is a filename character)", (path, name) => {
    expect(pathBaseName(path, "mac")).toBe(name);
    expect(pathBaseName(path, "linux")).toBe(name);
  });

  it("mac matches the old split('/') rule on every unix fixture", () => {
    for (const [path] of unix) {
      const old = path.split("/").filter(Boolean).pop() ?? "";
      expect(pathBaseName(path, "mac")).toBe(old);
    }
  });

  it("defaults to the running platform", () => {
    __setPlatformForTests("windows");
    expect(pathBaseName("D:\\x\\proj")).toBe("proj");
    __setPlatformForTests("mac");
    expect(pathBaseName("D:\\x\\proj")).toBe("D:\\x\\proj");
  });
});

describe("pathSegments · lastSeparatorIndex · displaySeparator", () => {
  it("windows splits on both separators and drops the verbatim prefix", () => {
    expect(pathSegments("\\\\?\\C:\\a/b\\c", "windows")).toEqual(["C:", "a", "b", "c"]);
    expect(lastSeparatorIndex("a/b\\c", "windows")).toBe(3);
    expect(displaySeparator("windows")).toBe("\\");
  });
  it("mac/linux split on slash only", () => {
    expect(pathSegments("/a/b\\c", "linux")).toEqual(["a", "b\\c"]);
    expect(lastSeparatorIndex("a/b\\c", "mac")).toBe(1);
    expect(displaySeparator("mac")).toBe("/");
  });
});

describe("relativeUnder — is the shell's cwd inside the project?", () => {
  it("windows: either separator, case-insensitive, trailing separator ignored", () => {
    expect(relativeUnder("D:\\a\\proj", "D:\\a\\proj\\src\\x", "windows")).toBe("src\\x");
    expect(relativeUnder("D:\\a\\proj\\", "d:\\A\\Proj", "windows")).toBe("");
    expect(relativeUnder("D:/a/proj", "D:\\a\\proj\\src", "windows")).toBe("src");
    expect(relativeUnder("D:\\a\\proj", "D:\\a\\project", "windows")).toBeNull();
    expect(relativeUnder("D:\\a\\proj", "C:\\a\\proj", "windows")).toBeNull();
  });
  it("mac: the old exact rule (case-sensitive, slash only)", () => {
    expect(relativeUnder("/Users/me/proj", "/Users/me/proj/src", "mac")).toBe("src");
    expect(relativeUnder("/Users/me/proj", "/Users/me/proj", "mac")).toBe("");
    expect(relativeUnder("/Users/me/proj", "/Users/me/Proj/src", "mac")).toBeNull();
    expect(relativeUnder("/Users/me/proj", "/Users/me/project", "mac")).toBeNull();
  });
});

describe("terminal crumbs on Windows (status bar · pane head)", () => {
  it("names the project folder, not the whole path, and keeps native separators", () => {
    __setPlatformForTests("windows");
    const root = "D:\\a\\_temp\\fixture\\e2e-fixture";
    expect(formatCwdCrumb(root, root)).toBe("e2e-fixture");
    expect(formatCwdCrumb(`${root}\\src\\lib`, root)).toBe("e2e-fixture\\src\\lib");
    expect(formatCwdCrumb("C:\\Windows\\System32\\drivers", root)).toBe("…\\System32\\drivers");
    expect(splitCrumb("e2e-fixture\\src\\lib")).toEqual({ parent: "e2e-fixture\\src\\", leaf: "lib" });
  });
  it("mac is unchanged", () => {
    const root = "/Users/me/Desktop/git/ai-pm";
    expect(formatCwdCrumb(`${root}/src/features`, root)).toBe("ai-pm/src/features");
    expect(formatCwdCrumb("/tmp/a/b/c", root)).toBe("…/b/c");
    expect(splitCrumb("ai-pm/src/features")).toEqual({ parent: "ai-pm/src/", leaf: "features" });
    expect(splitCrumb("a\\b")).toEqual({ parent: "", leaf: "a\\b" });
  });
});
