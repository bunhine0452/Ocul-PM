// 아웃라인의 "지금 어느 심볼 안인가" 계산.
//
// 백엔드가 준 자료를 화면 좌표로 옮기는 순수 함수라, 여기가 회귀를 잡기에
// 가장 싼 자리다 (편집기·DOM 을 띄우지 않고 규칙만 본다).
//
// git 거터 마커 접기(`markersByLine`)가 여기 함께 있었다 — Monaco 이관에서
// 거터가 데코레이션이 되며 그 함수가 사라졌다 (`monaco/decorations.ts` 가
// 덩어리를 그대로 범위로 넘긴다).
import { describe, expect, it } from "vitest";
import type { LspSymbol } from "@/lib/bindings";
import { indexOfEnclosing } from "@/features/code/CodeOutline";

describe("CodeOutline — 커서가 든 심볼", () => {
  const sym = (name: string, line: number, depth = 0): LspSymbol => ({
    name,
    detail: null,
    kind: "function",
    depth,
    line,
    character: 0,
  });

  it("커서보다 앞에서 시작하는 마지막 심볼을 고른다", () => {
    const list = [sym("a", 0), sym("b", 10), sym("c", 20)];
    expect(indexOfEnclosing(list, 0)).toBe(0);
    expect(indexOfEnclosing(list, 9)).toBe(0);
    expect(indexOfEnclosing(list, 10)).toBe(1);
    expect(indexOfEnclosing(list, 99)).toBe(2);
  });

  it("첫 심볼보다 위에 있으면 아무것도 고르지 않는다", () => {
    expect(indexOfEnclosing([sym("a", 5)], 2)).toBe(-1);
    expect(indexOfEnclosing([], 0)).toBe(-1);
  });

  it("중첩된 자식이 부모보다 우선한다 (문서 순서라 자연히 그렇게 된다)", () => {
    const list = [sym("Widget", 10), sym("draw", 12, 1), sym("Other", 30)];
    expect(indexOfEnclosing(list, 13)).toBe(1);
    expect(indexOfEnclosing(list, 11)).toBe(0);
  });
});
