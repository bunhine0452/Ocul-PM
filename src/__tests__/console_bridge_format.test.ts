// 실기기 A0d 포렌식 실패의 재발 방지 — React 19 가 컴포넌트 에러를
// console.warn("%s\n\n%s", error, stack) 로 내보낼 때, 브리지가 포맷을
// 치환하지 못하면 로그에 "%s" 리터럴만 남아 실제 예외가 증발한다.
import { describe, expect, test } from "vitest";
import { formatConsoleArgs } from "@/lib/oculpmLog";

describe("console bridge %-format", () => {
  test("React 19 에러 포맷의 실제 메시지가 로그에 남는다", () => {
    const err = new Error("term.open failed: invalid color");
    const out = formatConsoleArgs(["%s\n\n%s", err, "in TerminalInstanceImpl"]);
    expect(out).toContain("term.open failed: invalid color");
    expect(out).toContain("in TerminalInstanceImpl");
    expect(out).not.toContain("%s");
  });

  test("포맷 문자열이 아니면 종전처럼 join", () => {
    expect(formatConsoleArgs(["a", 1])).toBe("a 1");
  });

  test("%c 는 스타일 인자를 소비하고 비운다", () => {
    expect(formatConsoleArgs(["%cX", "color:red", "tail"])).toBe("X tail");
  });
});
