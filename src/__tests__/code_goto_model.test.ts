// B4 파일 내 이동 — 순수 모델 (docs/20260902_vscode-borrows/03-goto.md).
//
// 여기서 지키는 계약은 셋이다: 입력 한 줄이 두 모드로 갈리는 규칙,
// 심볼 정렬의 우선순위, 줄 번호의 범위.
import { describe, expect, it } from "vitest";
import type { LspSymbol } from "@/lib/bindings";

import {
  clampLine,
  containerChains,
  countLines,
  parseGoto,
  rankSymbols,
} from "@/features/code/gotoModel";

function sym(name: string, line: number, depth = 0, kind = "function"): LspSymbol {
  return { name, detail: null, kind, depth, line, character: 0 };
}

describe("parseGoto", () => {
  it("빈 입력은 심볼 전체", () => {
    expect(parseGoto("")).toEqual({ kind: "empty" });
    expect(parseGoto("   ")).toEqual({ kind: "empty" });
  });

  it("맨 글자는 심볼 이름", () => {
    expect(parseGoto("foo")).toEqual({ kind: "symbol", needle: "foo" });
  });

  it("@ 접두도 심볼 (VS Code 습관)", () => {
    expect(parseGoto("@foo")).toEqual({ kind: "symbol", needle: "foo" });
    expect(parseGoto("@")).toEqual({ kind: "empty" });
  });

  it(": 접두는 줄 — 열까지", () => {
    expect(parseGoto(":12")).toEqual({ kind: "line", line: 12, character: null });
    expect(parseGoto(":12:3")).toEqual({ kind: "line", line: 12, character: 3 });
  });

  it(": 만 치면 줄 모드지만 숫자는 아직 없다", () => {
    expect(parseGoto(":")).toEqual({ kind: "line", line: null, character: null });
  });

  it(":0 도 줄로 받는다 — 범위는 clampLine 의 몫", () => {
    expect(parseGoto(":0")).toEqual({ kind: "line", line: 0, character: null });
  });

  it("숫자만 쳐도 줄", () => {
    expect(parseGoto("125")).toEqual({ kind: "line", line: 125, character: null });
  });

  it(":abc 는 줄이 아니므로 심볼로 되받는다", () => {
    expect(parseGoto(":abc")).toEqual({ kind: "symbol", needle: "abc" });
  });

  it("음수·소수·꼬리 콜론은 줄이 아니다", () => {
    expect(parseGoto(":-3")).toEqual({ kind: "symbol", needle: "-3" });
    expect(parseGoto(":1.5")).toEqual({ kind: "symbol", needle: "1.5" });
    expect(parseGoto(":12:")).toEqual({ kind: "symbol", needle: "12:" });
  });
});

describe("rankSymbols", () => {
  const symbols = [
    sym("handleMutate", 10),
    sym("handleMove", 20),
    sym("parse_goto_query", 30),
    sym("Renderer", 40, 0, "struct"),
  ];

  it("빈 질의는 문서 순서 그대로 전부", () => {
    const out = rankSymbols(symbols, "");
    expect(out.map((r) => r.symbol.name)).toEqual([
      "handleMutate",
      "handleMove",
      "parse_goto_query",
      "Renderer",
    ]);
  });

  it("정확 접두가 맨 위", () => {
    const out = rankSymbols(symbols, "parse");
    expect(out[0].symbol.name).toBe("parse_goto_query");
  });

  it("카멜 약어 (hM → handleMutate)", () => {
    const out = rankSymbols(symbols, "hM");
    expect(out.map((r) => r.symbol.name).slice(0, 2)).toEqual(["handleMutate", "handleMove"]);
  });

  it("약어가 부분수열보다 위 (hm: handleMutate > rhythm)", () => {
    const out = rankSymbols([sym("rhythm", 1), sym("handleMutate", 2)], "hm");
    expect(out.map((r) => r.symbol.name)).toEqual(["handleMutate", "rhythm"]);
  });

  it("구분자 약어 (pgq → parse_goto_query)", () => {
    const out = rankSymbols([sym("pageQuery", 1), sym("parse_goto_query", 2)], "pgq");
    expect(out[0].symbol.name).toBe("parse_goto_query");
  });

  it("대소문자를 가리지 않는다", () => {
    expect(rankSymbols(symbols, "renderer")[0].symbol.name).toBe("Renderer");
  });

  it("맞지 않는 심볼은 버린다", () => {
    expect(rankSymbols(symbols, "zzzz")).toEqual([]);
  });

  it("동점은 문서 순서", () => {
    const out = rankSymbols([sym("aa", 3), sym("ab", 1)], "a");
    expect(out.map((r) => r.symbol.name)).toEqual(["aa", "ab"]);
  });

  it("구분자만 친 질의는 약어가 아니다", () => {
    expect(rankSymbols([sym("Renderer", 1)], "_")).toEqual([]);
  });
});

describe("containerChains", () => {
  it("depth 로 상위 사슬을 세운다", () => {
    const chains = containerChains([
      sym("Editor", 1, 0, "struct"),
      sym("draw", 2, 1, "method"),
      sym("inner", 3, 2, "function"),
      sym("main", 9, 0),
    ]);
    expect(chains).toEqual([[], ["Editor"], ["Editor", "draw"], []]);
  });

  it("깊이가 건너뛰어도 구멍이 새지 않는다", () => {
    const chains = containerChains([sym("A", 1, 0), sym("B", 2, 2), sym("C", 3, 2)]);
    expect(chains).toEqual([[], ["A"], ["A"]]);
  });
});

describe("clampLine", () => {
  it("0·음수는 첫 줄", () => {
    expect(clampLine(0, 40)).toBe(1);
    expect(clampLine(-9, 40)).toBe(1);
  });
  it("초과는 마지막 줄", () => {
    expect(clampLine(999, 40)).toBe(40);
  });
  it("범위 안은 그대로", () => {
    expect(clampLine(12, 40)).toBe(12);
  });
  it("줄 수를 모르면(0) 상한을 걸지 않는다", () => {
    expect(clampLine(999, 0)).toBe(999);
  });
});

describe("countLines", () => {
  it("빈 본문도 한 줄", () => {
    expect(countLines("")).toBe(1);
  });
  it("끝 개행은 빈 마지막 줄을 만든다 (에디터와 같이)", () => {
    expect(countLines("a\nb\n")).toBe(3);
  });
});
