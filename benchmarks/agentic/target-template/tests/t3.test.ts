import { expect, test } from "vitest";
import { parseRange } from "../src/index.js";

// t3 (feature): parseRange("3-7") → { start: 3, end: 7 }
test("parseRange 는 'start-end' 문자열을 파싱한다", () => {
  expect(parseRange("3-7")).toEqual({ start: 3, end: 7 });
  expect(parseRange("0-100")).toEqual({ start: 0, end: 100 });
});

test("parseRange 는 start === end 를 허용한다", () => {
  expect(parseRange("10-10")).toEqual({ start: 10, end: 10 });
});

test("parseRange 는 잘못된 입력에서 던진다", () => {
  expect(() => parseRange("7-3")).toThrow(); // start > end
  expect(() => parseRange("a-b")).toThrow();
  expect(() => parseRange("")).toThrow();
  expect(() => parseRange("5")).toThrow();
});
