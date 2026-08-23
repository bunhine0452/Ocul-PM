// 디버거의 순수 부분 — 실행 구성 추측, 확정 중단점 병합, 거터 표시 판정.
//
// 프로토콜·상태 기계는 Rust 쪽이 단위 테스트 + 실제 lldb-dap 왕복
// (`src-tauri/tests/dap_lldb.rs`)으로 덮는다. 여기서 지키는 것은 그 결과를
// 화면 좌표로 옮기는 규칙이다.
import { describe, expect, it } from "vitest";
import type { DapBreakpoint } from "@/lib/bindings";
import {
  adapterLanguageFor,
  defaultProgramFor,
  parseArgs,
  toLaunchRequest,
} from "@/features/code/debugConfig";
import { unverifiedLines } from "@/features/code/breakpointGutter";
import { mergeConfirmed } from "@/features/code/useDebug";

describe("debugConfig — 어떤 언어를 디버그할 수 있나", () => {
  it("확장자로 어댑터 언어를 고른다", () => {
    expect(adapterLanguageFor("src/main.rs")).toBe("rust");
    expect(adapterLanguageFor("a/b.py")).toBe("python");
    expect(adapterLanguageFor("cmd/main.go")).toBe("go");
  });

  it("디버그 어댑터가 없는 것은 null — 거터를 아예 안 단다", () => {
    // 하이라이트도 언어 서버도 있지만 디버그는 안 되는 것들.
    expect(adapterLanguageFor("app.ts")).toBeNull();
    expect(adapterLanguageFor("styles.css")).toBeNull();
    expect(adapterLanguageFor("README.md")).toBeNull();
    expect(adapterLanguageFor(null)).toBeNull();
    expect(adapterLanguageFor("Makefile")).toBeNull();
  });

  it("컴파일 언어는 **산출물**을, 인터프리터 언어는 소스를 첫 값으로 준다", () => {
    // Rust·Go 는 소스 경로로 못 붙는다 — 디버그 심벌이 든 바이너리가 대상이다.
    expect(defaultProgramFor("rust", "src/main.rs", "ocul-pm")).toBe("target/debug/ocul-pm");
    expect(defaultProgramFor("go", "cmd/main.go", "srv")).toBe("./srv");
    // 파이썬은 인터프리터가 소스를 직접 받는다.
    expect(defaultProgramFor("python", "scripts/run.py", "proj")).toBe("scripts/run.py");
    expect(defaultProgramFor(null, "a.ts", "proj")).toBe("");
  });

  it("인자는 공백으로 나누고 빈 칸은 버린다", () => {
    expect(parseArgs("  --verbose   -n 3 ")).toEqual(["--verbose", "-n", "3"]);
    expect(parseArgs("")).toEqual([]);
    expect(parseArgs("   ")).toEqual([]);
  });

  it("폼 값이 그대로 요청이 된다", () => {
    expect(
      toLaunchRequest({
        language: "rust",
        program: "  target/debug/app  ",
        args: "-x 1",
        stopOnEntry: true,
      }),
    ).toEqual({
      language_id: "rust",
      program: "target/debug/app",
      args: ["-x", "1"],
      stop_on_entry: true,
      cwd: null,
    });
  });
});

describe("중단점 — 어댑터의 확정을 화면에 반영", () => {
  const bp = (path: string, line: number, verified: boolean): DapBreakpoint => ({
    path,
    line,
    verified,
    message: null,
  });

  it("어댑터가 옮긴 줄을 따라간다", () => {
    // 12행을 요청했는데 어댑터가 13행으로 옮겼다면, 거터도 13행에 찍혀야 한다.
    const { lines } = mergeConfirmed([bp("src/a.rs", 13, true)]);
    expect(lines.get("src/a.rs")).toEqual([13]);
  });

  it("못 건 줄만 따로 표시한다 (옮긴 것은 정상이라 표시하지 않는다)", () => {
    const confirmed = [bp("src/a.rs", 13, true), bp("src/a.rs", 40, false)];
    const { lines, unverified } = mergeConfirmed(confirmed);
    expect(lines.get("src/a.rs")).toEqual([13, 40]);
    expect(unverified.get("src/a.rs")).toEqual([40]);
    // 거터 확장이 쓰는 판정도 같은 답이어야 한다.
    expect(unverifiedLines(confirmed)).toEqual([40]);
  });

  it("줄은 정렬되고 중복은 접힌다", () => {
    const { lines } = mergeConfirmed([
      bp("src/a.rs", 30, true),
      bp("src/a.rs", 3, true),
      bp("src/a.rs", 30, true),
    ]);
    expect(lines.get("src/a.rs")).toEqual([3, 30]);
  });

  it("파일별로 갈린다", () => {
    const { lines, unverified } = mergeConfirmed([
      bp("src/a.rs", 1, true),
      bp("src/b.rs", 2, false),
    ]);
    expect(lines.get("src/a.rs")).toEqual([1]);
    expect(lines.get("src/b.rs")).toEqual([2]);
    expect(unverified.get("src/a.rs")).toBeUndefined();
    expect(unverified.get("src/b.rs")).toEqual([2]);
  });

  it("전부 걸렸으면 표시할 것이 없다", () => {
    expect(unverifiedLines([bp("x", 1, true), bp("x", 2, true)])).toEqual([]);
    expect(unverifiedLines([])).toEqual([]);
  });
});
