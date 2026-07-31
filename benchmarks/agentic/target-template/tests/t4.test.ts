import { expect, test } from "vitest";
import { formatDuration } from "../src/index.js";

// t4 (feature): 초 → "1h 2m 5s" (0 인 단위는 생략, 0초는 "0s")
test("formatDuration 은 초 단위를 사람이 읽는 문자열로 바꾼다", () => {
  expect(formatDuration(0)).toBe("0s");
  expect(formatDuration(45)).toBe("45s");
  expect(formatDuration(90)).toBe("1m 30s");
  expect(formatDuration(3600)).toBe("1h");
  expect(formatDuration(3725)).toBe("1h 2m 5s");
});

test("formatDuration 은 음수와 소수에서 던진다", () => {
  expect(() => formatDuration(-1)).toThrow();
  expect(() => formatDuration(1.5)).toThrow();
});
