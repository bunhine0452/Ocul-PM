import { describe, expect, it } from "vitest";
import { scanFileRefs } from "@/features/terminal/fileLinks";

describe("scanFileRefs", () => {
  it("컴파일러 출력의 파일:줄:열을 잡는다", () => {
    const refs = scanFileRefs("src/lib/foo.ts:42:7 - error TS2345: 인자 타입 불일치");
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("src/lib/foo.ts");
    expect(refs[0].line).toBe(42);
  });

  it("줄 번호가 없어도 파일은 잡는다", () => {
    const refs = scanFileRefs("수정됨: src/App.tsx");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ path: "src/App.tsx", line: null });
  });

  it("범위가 파일명+줄 전체를 덮는다 (클릭 대상)", () => {
    const text = "at src/a.ts:12";
    const [ref] = scanFileRefs(text);
    expect(text.slice(ref.start, ref.end)).toBe("src/a.ts:12");
  });

  it("./ 접두사를 벗긴다", () => {
    expect(scanFileRefs("./src/x.rs:3")[0].path).toBe("src/x.rs");
  });

  it("한 줄에 여러 개도 전부 잡는다", () => {
    const refs = scanFileRefs("a/b.ts:1 와 c/d.rs:2 둘 다");
    expect(refs.map((r) => `${r.path}:${r.line}`)).toEqual(["a/b.ts:1", "c/d.rs:2"]);
  });

  it("괄호·따옴표 안도 잡는다 (스택트레이스 형태)", () => {
    expect(scanFileRefs("  at fn (src/x.js:9:3)")[0]).toMatchObject({
      path: "src/x.js",
      line: 9,
    });
    expect(scanFileRefs('입력 "src/y.ts:5" 확인')[0].path).toBe("src/y.ts");
  });

  // --- 신뢰 경계: 클릭해도 백엔드가 거절할 것은 링크로 만들지 않는다 ---

  it("절대경로는 링크로 만들지 않는다", () => {
    expect(scanFileRefs("/etc/passwd.bak:1")).toEqual([]);
    expect(scanFileRefs("~/.ssh/config.d:2")).toEqual([]);
  });

  it("상위 탈출 경로는 링크로 만들지 않는다", () => {
    expect(scanFileRefs("../../.ssh/id_rsa.pub:1")).toEqual([]);
    expect(scanFileRefs("src/../../etc/hosts.txt")).toEqual([]);
  });

  it("Windows 드라이브 절대경로도 막는다", () => {
    expect(scanFileRefs("C:/Windows/system.ini:1")).toEqual([]);
  });

  it("URL 은 WebLinks 애드온 몫이라 가로채지 않는다", () => {
    expect(scanFileRefs("https://example.com/app.js:12")).toEqual([]);
    expect(scanFileRefs("http://cdn.test/a/b.css")).toEqual([]);
  });

  // --- 오탐 방어 ---

  it("확장자가 없으면 링크가 아니다", () => {
    expect(scanFileRefs("Makefile:12")).toEqual([]);
    expect(scanFileRefs("warning:42 무언가")).toEqual([]);
    expect(scanFileRefs("localhost:3000")).toEqual([]);
  });

  it("줄 번호 0 은 줄 없음으로 낮춘다 (편집기가 해석 못 함)", () => {
    expect(scanFileRefs("src/a.ts:0")[0].line).toBeNull();
  });

  it("빈 줄은 빈 배열", () => {
    expect(scanFileRefs("")).toEqual([]);
    expect(scanFileRefs("   ")).toEqual([]);
  });

  it("여러 번 호출해도 결과가 같다 (정규식 lastIndex 누수 없음)", () => {
    const text = "src/a.ts:1 src/b.ts:2";
    expect(scanFileRefs(text)).toEqual(scanFileRefs(text));
  });
});
