import { describe, expect, test } from "vitest";
import { clamp, formatPercent, histogram, mean, median, slugify } from "../src/index.js";

describe("기존 동작 (베이스라인 — 항상 그린이어야 함)", () => {
  test("mean 은 산술 평균을 반환한다", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([10])).toBe(10);
  });

  test("mean 은 빈 배열에서 던진다", () => {
    expect(() => mean([])).toThrow();
  });

  test("median 은 홀수 길이 배열의 중앙값을 반환한다", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([7])).toBe(7);
  });

  test("slugify 는 단일 공백을 하이픈으로 바꾼다", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("clamp 는 범위 안으로 자른다", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  test("histogram 은 버킷별 빈도를 센다", () => {
    const h = histogram([1, 2, 11, 12, 25], 10);
    expect(h.get(0)).toBe(2);
    expect(h.get(10)).toBe(2);
    expect(h.get(20)).toBe(1);
  });

  test("formatPercent 는 백분율 문자열을 만든다", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(0.1234, 2)).toBe("12.34%");
  });
});
