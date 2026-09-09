import { describe, expect, it } from "vitest";

import {
  completionStart,
  hasLanguageServer,
  LSP_EXTENSIONS,
  parseHover,
  wordAtColumn,
} from "@/features/code/lspBridge";

// ─── LSP 응답의 텍스트 해석 (docs/lsp/00-master-plan.md) ─────────────────────
//
// 좌표 변환은 이제 `monaco_lsp.test.ts` 가 본다 — Monaco 는 LSP 와 같은
// (줄, 문자) 쌍을 쓰므로 오프셋 환산이 사라졌다. 여기 남은 것은 좌표계와
// 무관한 판단들이고, 화면으로는 미묘해서 못 잡는 종류라 순수 함수로 잠근다.

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
