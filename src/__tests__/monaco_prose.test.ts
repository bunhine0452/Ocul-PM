// 논의 문서 문법(`markdown-prose`)의 자물쇠 (Phase 4 `{#disc-port}`).
//
// 이 라운드가 반복해서 만난 결함의 모양은 하나다: **아무 데서도 안 걸리는
// 조용한 색 빠짐.** 문법이 토큰을 내는데 테마에 그 규칙이 없으면 Monarch 는
// 점을 하나씩 떼며 폴백한다 — `type.h2.md-prose` 가 없으면 `type` 으로 떨어져
// **코드용 타입 색**으로 칠해진다. 화면은 그럴싸하고 아무 테스트도 안 깨진다.
//
// 그래서 문법이 내는 토큰 집합과 테마가 아는 토큰 집합을 여기서 맞춘다.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PROSE_LANGUAGE_ID } from "@/features/code/monaco/langProse";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** 문법이 낼 수 있는 토큰 전부. 여기 없는 것을 문법이 내면 아래 테스트가 잡는다. */
const PROSE_TOKENS = [
  "type.h1",
  "type.h2",
  "type.h3",
  "type.h4",
  "comment",
  "delimiter",
  "keyword",
  "variable.anchor",
  "string",
  "strong",
  "emphasis",
  "string.link",
] as const;

describe("markdown-prose 문법", () => {
  it("코드용 `markdown` 과 다른 언어다 — `.md` 파일은 여전히 Monaco 것으로 연다", () => {
    expect(PROSE_LANGUAGE_ID).toBe("markdown-prose");
  });

  it("토큰 접미사가 `.md-prose` 다 — 테마 규칙이 코드 쪽과 갈리는 근거", () => {
    expect(read("src/features/code/monaco/langProse.ts")).toContain('tokenPostfix: ".md-prose"');
  });

  it("문법이 내는 토큰이 전부 적힌 목록 안에 있다", () => {
    const src = read("src/features/code/monaco/langProse.ts");
    const tokenizer = src.slice(src.indexOf("tokenizer: {"), src.indexOf("};", src.indexOf("tokenizer: {")));
    // `"…"` 로 쓰인 것 중 `@state` · 정규식 조각이 아닌 것 = 토큰 이름.
    const emitted = new Set(
      [...tokenizer.matchAll(/"([a-z][a-zA-Z.]*)"/g)]
        .map((m) => m[1])
        .filter((name) => !name.startsWith("@")),
    );
    expect(emitted.size).toBeGreaterThan(0);
    for (const token of emitted) {
      expect(PROSE_TOKENS as readonly string[], `${token} 이 목록에 없다`).toContain(token);
    }
  });

  it("적힌 토큰마다 `.md-prose` 테마 규칙이 있다 — 없으면 코드 색으로 조용히 폴백한다", () => {
    const theme = read("src/features/code/monaco/theme.ts");
    for (const token of PROSE_TOKENS) {
      expect(theme, `${token}.md-prose 규칙이 없다`).toContain(`token: "${token}.md-prose"`);
    }
  });

  it("테마가 산문 팔레트 토큰을 읽는다 — 코드 팔레트로 칠하면 대비가 코드용이 된다", () => {
    const theme = read("src/features/code/monaco/theme.ts");
    for (const cssVar of ["--text", "--text-2", "--text-3", "--accent-text"]) {
      expect(theme).toContain(`"${cssVar}"`);
    }
  });
});
