// B7 스티키 스크롤 — 순수 모델 (docs/20260902_vscode-borrows/04-sticky-scroll.md).
//
// jsdom 에는 레이아웃이 없어 CM6 뷰포트를 흉내낼 수 없다. 계산은 전부 여기서
// 잠그고, 확장(stickyScroll.ts)은 "이 결과를 DOM 으로 옮기기" 만 남긴다.
import { describe, expect, it } from "vitest";

import {
  clampStickyMax,
  indentWidth,
  stickyFromIndent,
  stickyFromSymbols,
  type StickySymbol,
} from "@/features/code/stickyModel";

function sym(line: number, depth: number, kind = "function"): StickySymbol {
  return { line, depth, kind };
}

/** 클래스(10) > 메서드(12) > 클로저(14), 그리고 다음 최상위(30). */
const NESTED = [sym(10, 0, "class"), sym(12, 1, "method"), sym(14, 2), sym(30, 0)];

const lineNumbers = (rows: { line: number }[]) => rows.map((r) => r.line);

describe("stickyFromSymbols", () => {
  it("바깥에서 안쪽 순으로 모은다", () => {
    expect(lineNumbers(stickyFromSymbols(NESTED, 20, 5))).toEqual([10, 12, 14]);
  });

  it("종류를 함께 준다 — 아이콘 색은 그 자리의 뜻이다", () => {
    expect(stickyFromSymbols(NESTED, 20, 5).map((r) => r.kind)).toEqual([
      "class",
      "method",
      "function",
    ]);
  });

  it("max 절단은 안쪽을 버린다 — 바깥 맥락이 더 크다", () => {
    expect(lineNumbers(stickyFromSymbols(NESTED, 20, 2))).toEqual([10, 12]);
    expect(lineNumbers(stickyFromSymbols(NESTED, 20, 1))).toEqual([10]);
    expect(stickyFromSymbols(NESTED, 20, 0)).toEqual([]);
  });

  it("뷰포트 첫 줄이 심볼 시작이면 그 줄은 뺀다", () => {
    // 14행이 이미 화면 맨 위에 있다 — 겹쳐 그리면 같은 줄이 두 번 보인다.
    expect(lineNumbers(stickyFromSymbols(NESTED, 14, 5))).toEqual([10, 12]);
  });

  it("첫 심볼보다 위면 아무것도 없다", () => {
    expect(stickyFromSymbols(NESTED, 3, 5)).toEqual([]);
  });

  it("다음 최상위로 넘어가면 사슬이 끊긴다", () => {
    expect(lineNumbers(stickyFromSymbols(NESTED, 33, 5))).toEqual([30]);
  });

  it("깊이가 건너뛰어도(0 → 2) 있는 조상만 모은다", () => {
    expect(lineNumbers(stickyFromSymbols([sym(1, 0), sym(4, 2)], 6, 5))).toEqual([1, 4]);
  });

  it("빈 목록", () => {
    expect(stickyFromSymbols([], 10, 5)).toEqual([]);
  });
});

describe("clampStickyMax", () => {
  it("1–10 으로 접는다", () => {
    expect(clampStickyMax(0)).toBe(1);
    expect(clampStickyMax(99)).toBe(10);
    expect(clampStickyMax(5)).toBe(5);
    expect(clampStickyMax(3.7)).toBe(3);
  });
  it("쓰레기 값은 기본 5", () => {
    expect(clampStickyMax(Number.NaN)).toBe(5);
  });
});

describe("indentWidth", () => {
  it("탭은 다음 탭 스톱까지", () => {
    expect(indentWidth("\tx", 4)).toBe(4);
    expect(indentWidth("  \tx", 4)).toBe(4);
    expect(indentWidth("     \tx", 4)).toBe(8);
  });
  it("공백은 그대로 · 내용이 시작하면 멈춘다", () => {
    expect(indentWidth("    x  y", 4)).toBe(4);
    expect(indentWidth("x", 4)).toBe(0);
  });
});

describe("stickyFromIndent", () => {
  const DOC = [
    "body {", //            0
    "  .card {", //         1
    "    color: red;", //   2
    "", //                  3
    "    margin: 0;", //    4
    "  }", //               5
    "  .other {", //        6
    "    padding: 0;", //   7
    "  }", //               8
    "}", //                 9
  ];

  it("더 얕은 줄만 앵커가 된다", () => {
    expect(lineNumbers(stickyFromIndent(DOC, 2, 5, 2))).toEqual([0, 1]);
  });

  it("형제(같은 들여쓰기)는 앵커가 아니다", () => {
    // 7행의 조상은 6·0 이지 1 이 아니다.
    expect(lineNumbers(stickyFromIndent(DOC, 7, 5, 2))).toEqual([0, 6]);
  });

  it("빈 줄은 건너뛰고, 그 아래 내용 줄을 기준으로 삼는다", () => {
    // 3행은 빈 줄 — 4행(margin)의 들여쓰기로 사슬을 세운다.
    expect(lineNumbers(stickyFromIndent(DOC, 3, 5, 2))).toEqual([0, 1]);
  });

  it("최상위 줄은 감싸는 것이 없다", () => {
    expect(stickyFromIndent(DOC, 0, 5, 2)).toEqual([]);
    expect(stickyFromIndent(DOC, 9, 5, 2)).toEqual([]);
  });

  it("종류는 없다 — 들여쓰기는 무엇인지 모른다", () => {
    expect(stickyFromIndent(DOC, 2, 5, 2).every((r) => r.kind === null)).toBe(true);
  });

  it("주석만 있는 줄은 앵커가 아니다", () => {
    const doc = ["fn a() {", "  // 설명", "    let x = 1;"];
    expect(lineNumbers(stickyFromIndent(doc, 2, 5, 2))).toEqual([0]);
  });

  it("# 로 시작하는 줄은 주석으로 단정하지 않는다 (CSS 선택자)", () => {
    const doc = ["#main {", "  color: red;"];
    expect(lineNumbers(stickyFromIndent(doc, 1, 5, 2))).toEqual([0]);
  });

  it("탭과 공백이 섞여도 폭으로 비교한다", () => {
    const doc = ["fn a() {", "\tif x {", "\t\tlet y = 1;"];
    expect(lineNumbers(stickyFromIndent(doc, 2, 5, 4))).toEqual([0, 1]);
  });

  it("max 절단은 안쪽을 버린다", () => {
    expect(lineNumbers(stickyFromIndent(DOC, 2, 1, 2))).toEqual([0]);
    expect(stickyFromIndent(DOC, 2, 0, 2)).toEqual([]);
  });
});
