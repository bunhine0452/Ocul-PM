import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  estimateMessagesTokens,
  formatTokenCount,
  MESSAGE_OVERHEAD_TOKENS,
} from "@/lib/tokenEstimate";

// AI 패널 2026-07-20 개편 — 전송 전 입력 토큰 추정 휴리스틱.
// 정확한 BPE 값이 아니라 문자 계열별 밀도 근사가 안정적으로 유지되는지 고정.

describe("estimateTokens — 문자 계열별 휴리스틱", () => {
  it("빈 문자열은 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("ASCII 는 ≈3.6 chars/token", () => {
    // 36 ASCII chars → 10 tokens
    expect(estimateTokens("a".repeat(36))).toBe(10);
  });

  it("한글은 ≈0.7 token/char (ASCII 보다 훨씬 밀도 높음)", () => {
    const ko = "안녕하세요반갑습니다"; // 10 chars → ceil(7) = 7
    expect(estimateTokens(ko)).toBe(7);
    // 같은 길이의 ASCII 보다 크게 추정되어야 한다.
    expect(estimateTokens(ko)).toBeGreaterThan(estimateTokens("abcdefghij"));
  });

  it("혼합 텍스트는 두 계열의 합", () => {
    // "hello " (6 ascii → 1.67) + "세계" (2 cjk → 1.4) → ceil(3.07) = 4
    expect(estimateTokens("hello 세계")).toBe(4);
  });

  it("서로게이트 페어(이모지)는 1문자로 계산되어 NaN 없이 처리", () => {
    expect(estimateTokens("😀😀")).toBeGreaterThan(0);
    expect(Number.isFinite(estimateTokens("😀 test 한글"))).toBe(true);
  });
});

describe("estimateMessagesTokens — 멀티턴 리플레이 합산", () => {
  it("메시지당 오버헤드를 더한다", () => {
    const msgs = [{ content: "a".repeat(36) }, { content: "" }];
    expect(estimateMessagesTokens(msgs)).toBe(10 + MESSAGE_OVERHEAD_TOKENS * 2);
  });

  it("빈 배열은 0", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});

describe("formatTokenCount", () => {
  it("1000 미만은 그대로", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(987)).toBe("987");
  });

  it("1k 대는 소수 1자리", () => {
    expect(formatTokenCount(1234)).toBe("1.2k");
    expect(formatTokenCount(1000)).toBe("1k"); // 1.0 → "1"
  });

  it("10k 이상은 정수 k", () => {
    expect(formatTokenCount(45600)).toBe("46k");
    expect(formatTokenCount(10499)).toBe("10k");
  });
});
