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
  tildePath,
  pathBaseName,
  pathSegments,
  relativeUnder,
} from "@/lib/osPath";
import { __setPlatformForTests } from "@/lib/platform";

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


describe("tildePath", () => {
  it("홈 폴더를 ~ 로 접는다", () => {
    expect(tildePath("/Users/kimhyunbin/Desktop/git/ai-pm", "mac")).toBe("~/Desktop/git/ai-pm");
    expect(tildePath("/home/kim/lab/x", "linux")).toBe("~/lab/x");
  });
  it("홈 밖 경로는 그대로 둔다", () => {
    expect(tildePath("/opt/work/x", "mac")).toBe("/opt/work/x");
  });

  // {#ui-winpath-followups} — 홈의 모양은 OS 가 정한다.
  it.each([
    ["C:\\Users\\kim\\Desktop\\proj", "~\\Desktop\\proj"],
    ["c:\\users\\kim\\proj", "~\\proj"],
    ["D:/Users/kim/git/x", "~/git/x"],
    ["\\\\?\\C:\\Users\\kim\\proj", "~\\proj"],
    ["C:\\Users\\kim", "~"],
    ["C:\\work\\proj", "C:\\work\\proj"],
    ["/home/kim/x", "/home/kim/x"],
  ] as const)("windows: %s → %s", (path, want) => {
    expect(tildePath(path, "windows")).toBe(want);
  });

  it.each(["mac", "linux"] as const)("%s: 드라이브 경로는 모른다", (os) => {
    expect(tildePath("C:\\Users\\kim\\proj", os)).toBe("C:\\Users\\kim\\proj");
  });
});
