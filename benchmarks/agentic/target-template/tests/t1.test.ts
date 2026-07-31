import { expect, test } from "vitest";
import { median } from "../src/index.js";

// t1 (bug): 짝수 길이 배열의 median 은 가운데 두 값의 평균이어야 한다.
test("median 은 짝수 길이 배열에서 가운데 두 값의 평균을 반환한다", () => {
  expect(median([1, 2, 3, 4])).toBe(2.5);
  expect(median([4, 1])).toBe(2.5);
  expect(median([10, 20, 30, 40, 50, 60])).toBe(35);
});

test("median 의 홀수 길이 동작은 그대로다", () => {
  expect(median([3, 1, 2])).toBe(2);
});
