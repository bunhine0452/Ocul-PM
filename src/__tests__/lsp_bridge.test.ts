import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";

import {
  completionStart,
  hasLanguageServer,
  LSP_EXTENSIONS,
  offsetOf,
  parseHover,
  positionOf,
  toCmCompletions,
  toCmDiagnostics,
  wordAtColumn,
} from "@/features/code/lspBridge";
import type { LspDiagnostic } from "@/lib/bindings";

// ─── LSP ↔ CodeMirror 좌표 (docs/lsp/00-master-plan.md §위치 인코딩) ─────────
//
// 여기서 ±1 이 어긋나면 진단이 옆 줄에 붙고 완성이 엉뚱한 자리에서 뜬다.
// 화면으로는 미묘해서 못 잡는 종류라 순수 함수로 잠근다.

const diag = (over: Partial<LspDiagnostic> = {}): LspDiagnostic => ({
  start_line: 0,
  start_character: 0,
  end_line: 0,
  end_character: 1,
  severity: "error",
  message: "boom",
  source: null,
  ...over,
});

describe("좌표 변환", () => {
  const doc = Text.of(["fn main() {", "    let x = 1;", "}"]);

  it("LSP 0-based 줄을 CM6 1-based 로 옮긴다", () => {
    // 둘째 줄(LSP line 1) 4번째 문자 = "let" 의 l
    const at = offsetOf(doc, 1, 4);
    expect(doc.sliceString(at, at + 3)).toBe("let");
  });

  it("오프셋 → 위치가 왕복한다", () => {
    for (const [line, ch] of [
      [0, 0],
      [0, 3],
      [1, 4],
      [2, 0],
    ] as const) {
      const off = offsetOf(doc, line, ch);
      expect(positionOf(doc, off)).toEqual({ line, character: ch });
    }
  });

  it("한글이 있어도 코드 유닛으로 센다", () => {
    // JS 문자열도 LSP 도 UTF-16 코드 유닛이라 한글 1자 = 1 유닛이다.
    // (UTF-8 바이트로 세면 여기서 3배로 어긋난다.)
    const ko = Text.of(["// 한글 주석", "let x = 1;"]);
    const at = offsetOf(ko, 0, 3); // "// " 다음 = "한"
    expect(ko.sliceString(at, at + 2)).toBe("한글");
    expect(positionOf(ko, at)).toEqual({ line: 0, character: 3 });
  });

  it("문서 밖을 가리키는 오래된 진단은 던지지 않고 접는다", () => {
    // 편집 직후 도착한 진단은 지워진 줄을 가리킬 수 있다.
    expect(offsetOf(doc, 999, 0)).toBe(doc.line(doc.lines).from);
    expect(offsetOf(doc, 0, 9999)).toBe(doc.line(1).to);
    expect(offsetOf(doc, -5, -5)).toBe(0);
    expect(positionOf(doc, 99999)).toEqual(positionOf(doc, doc.length));
  });
});

describe("진단 변환", () => {
  const doc = Text.of(["fn main() {", "    let x = ;", "}"]);

  it("범위를 오프셋으로 옮기고 심각도를 넘긴다", () => {
    const [d] = toCmDiagnostics(doc, [
      diag({ start_line: 1, start_character: 4, end_line: 1, end_character: 7, source: "rustc" }),
    ]);
    expect(doc.sliceString(d.from, d.to)).toBe("let");
    expect(d.severity).toBe("error");
    expect(d.source).toBe("rustc");
    expect(d.message).toBe("boom");
  });

  it("길이 0 범위를 한 글자로 넓힌다", () => {
    // 서버는 "이 지점" 을 start==end 로 표현한다. CM6 는 from==to 면 그릴
    // 밑줄이 없어 진단이 조용히 사라진다 — 있는 오류가 안 보이는 게 최악이다.
    const [d] = toCmDiagnostics(doc, [
      diag({ start_line: 1, start_character: 13, end_line: 1, end_character: 13 }),
    ]);
    expect(d.to).toBeGreaterThan(d.from);
  });

  it("네 심각도를 모두 옮긴다", () => {
    const items = (["error", "warning", "info", "hint"] as const).map((s) =>
      diag({ severity: s }),
    );
    expect(toCmDiagnostics(doc, items).map((d) => d.severity)).toEqual([
      "error",
      "warning",
      "info",
      "hint",
    ]);
  });

  it("빈 목록은 빈 목록", () => {
    expect(toCmDiagnostics(doc, [])).toEqual([]);
  });
});

describe("완성 변환", () => {
  const item = (over = {}) => ({
    label: "push",
    detail: null,
    kind: null,
    insert_text: null,
    sort_text: null,
    ...over,
  });

  it("서버 순서를 boost 로 고정한다", () => {
    // rust-analyzer 는 타입이 맞는 후보를 앞으로 올린다 — CM6 가 알파벳순으로
    // 다시 섞으면 그 지능이 사라진다.
    const got = toCmCompletions([item({ label: "zzz" }), item({ label: "aaa" })]);
    expect(got.map((c) => c.label)).toEqual(["zzz", "aaa"]);
    expect(got[0].boost).toBeGreaterThan(got[1].boost!);
  });

  it("boost 가 CM6 범위(-99..99)를 넘지 않는다", () => {
    const many = Array.from({ length: 250 }, (_, i) => item({ label: `i${i}` }));
    for (const c of toCmCompletions(many)) {
      expect(c.boost).toBeGreaterThanOrEqual(-99);
      expect(c.boost).toBeLessThanOrEqual(99);
    }
  });

  it("insert_text 가 있으면 apply 로 넘긴다", () => {
    const [c] = toCmCompletions([item({ label: "foo", insert_text: "foo()" })]);
    expect(c.apply).toBe("foo()");
    // 없으면 undefined — CM6 가 label 을 그대로 넣는다.
    expect(toCmCompletions([item()])[0].apply).toBeUndefined();
  });
});

describe("서버 부착 대상", () => {
  it("등록된 확장자만 서버를 붙인다", () => {
    for (const p of ["a.rs", "src/x.ts", "b.tsx", "c.py", "d.go", "e.MJS"]) {
      expect(hasLanguageServer(p)).toBe(true);
    }
  });

  it("하이라이트만 되는 파일은 붙이지 않는다", () => {
    // 여기서 true 를 돌려주면 override 자동완성이 걸려 CM6 언어 모드의 기본
    // 완성(CSS 속성 등)이 통째로 사라진다.
    for (const p of ["a.css", "b.md", "c.json", "d.yaml", "Makefile", "LICENSE", ""]) {
      expect(hasLanguageServer(p)).toBe(false);
    }
  });

  it("확장자 목록이 Rust 레지스트리와 같은 집합이다", () => {
    // 반대 방향은 registry::tests::extension_coverage_matches_frontend 가 잠근다.
    expect([...LSP_EXTENSIONS].sort()).toEqual(
      ["cjs", "go", "js", "jsx", "mjs", "py", "pyi", "rs", "ts", "tsx"].sort(),
    );
  });
});

describe("호버 파싱", () => {
  it("rust-analyzer 의 실제 모양 — 시그니처 블록 + 문서", () => {
    const md = "```rust\nlsp_probe\n```\n\n```rust\nfn greet(name: &str) -> String\n```\n\n---\n\n인사말을 만든다.";
    expect(parseHover(md)).toEqual([
      { kind: "code", text: "lsp_probe", lang: "rust" },
      { kind: "code", text: "fn greet(name: &str) -> String", lang: "rust" },
      { kind: "text", text: "인사말을 만든다." },
    ]);
  });

  it("언어 없는 펜스와 산문만 있는 호버", () => {
    expect(parseHover("```\nplain\n```")).toEqual([
      { kind: "code", text: "plain", lang: null },
    ]);
    expect(parseHover("그냥 설명")).toEqual([{ kind: "text", text: "그냥 설명" }]);
  });

  it("닫히지 않은 펜스도 버리지 않는다", () => {
    // 서버가 잘린 내용을 줘도 보여주는 편이 빈 툴팁보다 낫다.
    expect(parseHover("```rust\nfn a()")).toEqual([
      { kind: "code", text: "fn a()", lang: "rust" },
    ]);
  });

  it("구분선만 있는 덩어리는 버린다", () => {
    // 툴팁 안에서 가로줄은 자리만 먹는다.
    expect(parseHover("---")).toEqual([]);
    expect(parseHover("a\n\n---\n\nb")).toEqual([
      { kind: "text", text: "a" },
      { kind: "text", text: "b" },
    ]);
  });

  it("빈 입력은 빈 목록", () => {
    expect(parseHover("")).toEqual([]);
    expect(parseHover("   \n\n  ")).toEqual([]);
  });
});

describe("커서 위 식별자 (F2 초깃값)", () => {
  it("식별자 안·앞·뒤 어디서든 그 식별자를 준다", () => {
    const line = "    let value = compute(x);";
    expect(wordAtColumn(line, 8)).toBe("value"); // 안
    expect(wordAtColumn(line, 4 + 4)).toBe("value"); // 앞
    // 커서가 식별자 바로 뒤 — F2 를 누르는 가장 흔한 자리다.
    expect(wordAtColumn(line, 13)).toBe("value");
    expect(wordAtColumn(line, "    let value = compute".length)).toBe("compute");
  });

  it("식별자가 아닌 자리에서는 빈 문자열", () => {
    expect(wordAtColumn("a + b", 2)).toBe("");
    expect(wordAtColumn("", 0)).toBe("");
  });

  it("범위를 벗어난 열은 접는다", () => {
    expect(wordAtColumn("abc", 999)).toBe("abc");
    expect(wordAtColumn("abc", -5)).toBe("abc");
  });

  it("밑줄과 $ 를 식별자에 포함한다", () => {
    expect(wordAtColumn("let _my_var = 1", 6)).toBe("_my_var");
    expect(wordAtColumn("const $el = q()", 7)).toBe("$el");
  });
});

describe("완성 시작 지점", () => {
  it("단어 중간에서는 단어 시작으로 되돌아간다", () => {
    expect(completionStart("let re", false)).toBe(4);
    expect(completionStart("foo.ba", false)).toBe(4);
  });

  it("멤버 완성이 가장 필요한 자리 — 트리거 문자 직후를 연다", () => {
    // CM6 기본 matchBefore 만 쓰면 여기서 아무것도 안 뜬다.
    expect(completionStart("foo.", false)).toBe(4);
    expect(completionStart("std::", false)).toBe(5);
    expect(completionStart("ptr->", false)).toBe(5);
  });

  it("그 밖의 자리에서는 저절로 열지 않는다", () => {
    expect(completionStart("let x = ", false)).toBeNull();
    expect(completionStart("", false)).toBeNull();
    expect(completionStart("foo(", false)).toBeNull();
  });

  it("명시 호출(⌃Space)은 어디서든 연다", () => {
    expect(completionStart("let x = ", true)).toBe(8);
    expect(completionStart("", true)).toBe(0);
  });
});
