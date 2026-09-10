// 시맨틱 토큰 어휘의 자물쇠 {#cap-semantic}.
//
// **왜 이게 필요한가.** 시맨틱 토큰은 Monarch 강조 위에 덮어쓴다. 서버가
// "이건 method 다" 라고 말했는데 테마에 `method` 규칙이 없으면 Monaco 는 맨 위
// `{ token: "" }` 로 떨어뜨려 **본문색**을 칠한다 — 즉 규칙 하나를 빠뜨리면 그
// 종류의 색이 도로 빠진다. 켜기 전보다 나빠지는 것이라 화면으로는 "LSP 가
// 붙으면 색이 흐려진다" 로 보이고, 원인을 찾기가 아주 어렵다.
//
// 여기서는 `defineCodeTheme` 이 낸 규칙 목록만 본다 (Monaco 를 안 올린다).
import { describe, expect, it } from "vitest";

import { defineCodeTheme } from "@/features/code/monaco/theme";

/** LSP 3.17 표준 종류 + rust-analyzer 가 더 내는 둘. 백엔드 상수와 같은 집합. */
const SEMANTIC_TOKEN_TYPES = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
  "builtinType",
  "lifetime",
];

function rulesOf(): Array<{ token: string; foreground?: string }> {
  let captured: Array<{ token: string; foreground?: string }> = [];
  const monaco = {
    editor: {
      defineTheme: (_name: string, data: { rules: typeof captured }) => {
        captured = data.rules;
      },
    },
  } as never;
  // 토큰값은 비워 둔다 — 이 테스트가 보는 것은 **어떤 이름에 규칙이 있는가**지
  // 색이 무엇인가가 아니다 (색은 프리셋마다 다르고 육안 확인의 몫이다).
  defineCodeTheme(monaco, {}, false);
  return captured;
}

describe("시맨틱 토큰 어휘", () => {
  it("서버가 낼 수 있는 종류마다 규칙이 있다", () => {
    const named = new Set(rulesOf().map((r) => r.token));
    const missing = SEMANTIC_TOKEN_TYPES.filter((t) => !named.has(t));
    expect(missing, "규칙이 없는 종류는 본문색이 된다 — 켜기 전보다 나빠진다").toEqual([]);
  });

});
