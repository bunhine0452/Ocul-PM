import { expect, test } from "vitest";
import { slugify } from "../src/index.js";

// t2 (bug): 연속 공백/특수문자는 하이픈 하나로 접히고, 앞뒤 하이픈은 없어야 한다.
test("slugify 는 연속 공백을 하이픈 하나로 접는다", () => {
  expect(slugify("Hello   World")).toBe("hello-world");
});

test("slugify 는 특수문자를 제거하고 하이픈 하나로 접는다", () => {
  expect(slugify("Hello,  World!")).toBe("hello-world");
  expect(slugify("Rock & Roll")).toBe("rock-roll");
});

test("slugify 결과는 앞뒤 하이픈이 없다", () => {
  expect(slugify("  !leading and trailing?  ")).toBe("leading-and-trailing");
});

test("slugify 의 단순 케이스는 그대로다", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});
