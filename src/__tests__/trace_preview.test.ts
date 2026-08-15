import { describe, expect, it } from "vitest";

import { peekLines } from "@/features/chat/tracePreview";

// 2026-08-16 — 도구 호출이 "무엇을 시켰다" 한 줄로만 접혀서, 대화가 똑같이 생긴
// 스무 줄이 됐다. 이제 결과의 머리 몇 줄을 늘 보여 준다 — 자르는 규칙이 여기다.

describe("peekLines", () => {
  it("짧은 출력은 그대로 보여 주고 잘렸다고 하지 않는다", () => {
    const peek = peekLines("ok\ndone");
    expect(peek.text).toBe("ok\ndone");
    expect(peek.hiddenLines).toBe(0);
    expect(peek.truncated).toBe(false);
  });

  it("머리 N 줄만 떼고 남은 줄 수를 센다", () => {
    const source = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    const peek = peekLines(source, 4);
    expect(peek.text).toBe("line 1\nline 2\nline 3\nline 4");
    expect(peek.hiddenLines).toBe(6);
    expect(peek.truncated).toBe(true);
  });

  it("끝의 빈 줄은 세지 않는다 — 개행 하나가 \"+1줄\"이 되면 거짓말이다", () => {
    const peek = peekLines("ok\n\n\n", 4);
    expect(peek.text).toBe("ok");
    expect(peek.hiddenLines).toBe(0);
    expect(peek.truncated).toBe(false);
  });

  it("빈 출력은 보여 줄 것이 없다", () => {
    expect(peekLines("")).toEqual({ text: "", hiddenLines: 0, truncated: false });
    expect(peekLines("   \n  ")).toEqual({ text: "", hiddenLines: 0, truncated: false });
  });

  it("글자 수 상한에 걸리면 **줄 경계**에서 자른다 (반 줄을 만들지 않는다)", () => {
    const long = ["a".repeat(60), "b".repeat(60), "c".repeat(60)].join("\n");
    const peek = peekLines(long, 4, 100);
    expect(peek.text).toBe("a".repeat(60));
    expect(peek.hiddenLines).toBe(2);
    expect(peek.truncated).toBe(true);
  });

  it("첫 줄부터 한도를 넘으면 그 줄을 잘라서라도 보여 준다", () => {
    const peek = peekLines("x".repeat(5000), 4, 100);
    expect(peek.text).toHaveLength(100);
    expect(peek.truncated).toBe(true);
  });

  it("한 줄이 아주 길어도 DOM 에 통째로 싣지 않는다 (minified 번들·base64)", () => {
    const source = `${"z".repeat(200_000)}\ntail`;
    const peek = peekLines(source);
    expect(peek.text.length).toBeLessThanOrEqual(800);
    expect(peek.truncated).toBe(true);
  });
});
