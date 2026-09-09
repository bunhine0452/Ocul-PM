// 스티키 스크롤 — 이제 **그리는 것은 Monaco 내장**이다 (Phase 2 `{#reclaim-sticky}`).
//
// CodeMirror 판에서는 `stickyModel.ts` 가 "지금 줄을 감싸는 상위 스코프" 를
// 직접 계산했고 이 파일이 그 계산을 잠갔다. 그 계산은 Monaco 가 한다. 우리에게
// 남은 몫은 둘이고, 여기서 그 둘만 본다.
//
//   · `toDocumentSymbols` — 백엔드가 준 평평한 `LspSymbol[]`(시작 줄만)을
//     Monaco 아웃라인이 요구하는 **중첩 + 범위**로 옮긴다. 여기가 틀리면
//     사슬이 한 줄로 납작해지거나 함수 범위가 옆 함수까지 먹는다.
//   · `clampStickyMax` — 설정값을 쓸 수 있는 줄 수로 접는다.
import { describe, expect, it } from "vitest";

import { symbolKindOf, toDocumentSymbols } from "@/features/code/monaco/symbols";
import { clampStickyMax } from "@/lib/settings";
import type { LspSymbol } from "@/lib/bindings";

/** Monaco 를 jsdom 에 올리지 않는다 — 이 변환이 monaco 에서 읽는 것은 이 표뿐이다. */
const SymbolKind = {
  File: 0,
  Module: 1,
  Namespace: 2,
  Package: 3,
  Class: 4,
  Method: 5,
  Property: 6,
  Field: 7,
  Constructor: 8,
  Enum: 9,
  Interface: 10,
  Function: 11,
  Variable: 12,
  EnumMember: 15,
  Struct: 22,
  TypeParameter: 25,
} as const;
const monaco = { languages: { SymbolKind } } as never;

function sym(line: number, depth: number, kind = "function", name = "s" + line): LspSymbol {
  return { name, detail: null, kind, depth, line, character: 0 };
}

/** 클래스(10) > 메서드(12) > 클로저(14), 그리고 다음 최상위(30). */
const NESTED = [sym(10, 0, "class"), sym(12, 1, "method"), sym(14, 2), sym(30, 0)];

describe("toDocumentSymbols — 중첩", () => {
  it("depth 로 트리를 세운다 — 평평하면 스티키가 사슬을 못 그린다", () => {
    const [cls, next] = toDocumentSymbols(monaco, NESTED, 100);
    expect(cls.name).toBe("s10");
    expect(cls.children?.map((c) => c.name)).toEqual(["s12"]);
    expect(cls.children?.[0].children?.map((c) => c.name)).toEqual(["s14"]);
    expect(next.name).toBe("s30");
    expect(next.children).toEqual([]);
  });

  it("깊이가 건너뛰어도(0 → 2) 있는 조상 밑으로 붙인다", () => {
    const [root] = toDocumentSymbols(monaco, [sym(1, 0), sym(4, 2)], 50);
    expect(root.children?.map((c) => c.name)).toEqual(["s4"]);
  });

  it("형제가 끝난 뒤 다시 얕아지면 뿌리로 돌아온다", () => {
    const roots = toDocumentSymbols(monaco, [sym(1, 0), sym(2, 1), sym(9, 0)], 50);
    expect(roots.map((r) => r.name)).toEqual(["s1", "s9"]);
  });

  it("빈 목록", () => {
    expect(toDocumentSymbols(monaco, [], 50)).toEqual([]);
  });
});

describe("toDocumentSymbols — 지어낸 범위", () => {
  it("끝은 다음 형제(같거나 얕은 depth)의 시작이다", () => {
    const [cls] = toDocumentSymbols(monaco, NESTED, 100);
    // 클래스(10)는 다음 최상위(30) 앞까지.
    expect(cls.range.startLineNumber).toBe(11);
    expect(cls.range.endLineNumber).toBe(30);
    // 메서드(12)도 같은 이유로 30 까지 — 그 사이에 얕은 것이 없다.
    expect(cls.children?.[0].range.endLineNumber).toBe(30);
  });

  it("마지막 심볼은 문서 끝까지", () => {
    const roots = toDocumentSymbols(monaco, [sym(0, 0)], 42);
    expect(roots[0].range.endLineNumber).toBe(42);
  });

  it("0-based 줄을 1-based 로 옮긴다 — 여기서 ±1 이 어긋나면 한 줄씩 밀린다", () => {
    const [root] = toDocumentSymbols(monaco, [sym(0, 0)], 10);
    expect(root.range.startLineNumber).toBe(1);
    expect(root.selectionRange.startLineNumber).toBe(1);
  });

  it("문서보다 뒤를 가리키는 낡은 심볼은 문서 안으로 접는다", () => {
    // 편집 직후 도착한 옛 응답 — 범위 밖이면 Monaco 가 던진다.
    const [root] = toDocumentSymbols(monaco, [sym(999, 0)], 5);
    expect(root.range.startLineNumber).toBe(5);
    expect(root.range.endLineNumber).toBe(5);
  });

  it("선택 범위는 이름 자체다 — 고르면 커서가 함수 위 빈 줄이 아니라 이름에 선다", () => {
    const [root] = toDocumentSymbols(monaco, [sym(3, 0, "function", "render")], 50);
    expect(root.selectionRange.startColumn).toBe(1);
    expect(root.selectionRange.endColumn).toBe(1 + "render".length);
  });
});

describe("symbolKindOf", () => {
  it("소문자 하이픈 이름을 Monaco 열거형으로 옮긴다", () => {
    expect(symbolKindOf(SymbolKind as never, "class")).toBe(SymbolKind.Class);
    expect(symbolKindOf(SymbolKind as never, "enum-member")).toBe(SymbolKind.EnumMember);
    expect(symbolKindOf(SymbolKind as never, "type-parameter")).toBe(SymbolKind.TypeParameter);
  });

  it("모르는 값은 Variable — 백엔드의 `symbol` 폴백이 그대로 온다", () => {
    expect(symbolKindOf(SymbolKind as never, "symbol")).toBe(SymbolKind.Variable);
    expect(symbolKindOf(SymbolKind as never, "")).toBe(SymbolKind.Variable);
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
