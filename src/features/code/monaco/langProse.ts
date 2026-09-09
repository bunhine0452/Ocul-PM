// `markdown-prose` — 논의 문서 편집기가 쓰는 마크다운 문법 (Phase 4 `{#disc-port}`).
//
// **왜 Monaco 의 `markdown` 을 안 쓰나.** 0.56 의 Monarch 마크다운은 제목을
// 단계 구분 없이 전부 `keyword` 로 낸다(`markdown.js` 의 `^(\s{0,3})(#+)…`).
// 논의 문서에서는 그 단계가 곧 구조다 — `##` 는 파서가 아는 섹션(문제 · 배경 ·
// 옵션 · 토의 로그 · 결론 · 다음 단계)이고 `###` 는 그 안의 옵션 하나다. 한 색으로
// 뭉개면 "지금 어느 섹션에 쓰고 있나" 가 화면에서 사라진다.
//
// 그리고 이 문서 형식의 뼈대인 **안정 id**(`{#opt-a}` · `{#step-3}`)를 따로
// 칠한다. 삽입 메뉴가 만들어 주는 것이지만, 손으로 지웠는지가 눈에 보여야 한다.
//
// 언어 id 를 따로 두는 이유: 코드 화면에서 `.md` 파일을 열 때는 Monaco 의 것을
// 그대로 쓴다(거기서는 원문이 코드다). 테마 규칙도 `.md-prose` 접미사로 갈려
// 서로를 안 건드린다.

import type * as MonacoNs from "monaco-editor/editor/editor.api";

type Monaco = typeof MonacoNs;

export const PROSE_LANGUAGE_ID = "markdown-prose";

const CONF: MonacoNs.languages.LanguageConfiguration = {
  comments: { blockComment: ["<!--", "-->"] },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "`", close: "`" },
  ],
  // 선택해 두고 `*`·`_`·`` ` `` 를 치면 감싼다 — 산문에서 가장 잦은 손놀림이다.
  surroundingPairs: [
    { open: "*", close: "*" },
    { open: "_", close: "_" },
    { open: "`", close: "`" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
  ],
  onEnterRules: [
    // 목록 안에서 개행하면 다음 항목을 이어 준다 (`- ` · `- [ ] ` · `1. `).
    {
      beforeText: /^\s*(?:[-*+]\s+\[[ xX]\]|[-*+]|\d+\.)\s+.*$/,
      action: { indentAction: 0 /* None */, appendText: "- " },
    },
  ],
};

/**
 * 제목 단계별 토큰 + 안정 id + 흔한 인라인 서식.
 *
 * 순서가 뜻이다: 제목·인용·목록은 **줄 맨 앞**에서 먼저 잡아야 인라인 규칙이
 * 그 기호를 먼저 먹지 않는다. 코드 펜스는 그보다도 먼저다 — 펜스 안의 `#` 는
 * 제목이 아니다.
 */
const LANGUAGE: MonacoNs.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".md-prose",
  tokenizer: {
    root: [
      [/^\s*```.*$/, { token: "string", next: "@fence" }],
      [/^\s{0,3}#\s.*$/, "type.h1"],
      [/^\s{0,3}##\s.*$/, "type.h2"],
      [/^\s{0,3}###\s.*$/, "type.h3"],
      [/^\s{0,3}#{4,}\s.*$/, "type.h4"],
      [/^\s*>+.*$/, "comment"],
      // 표 구분선과 셀 경계 — 토의 로그가 표다.
      [/^\s*\|[-: |]+\|\s*$/, "delimiter"],
      [/^\s*(-{3,}|\*{3,}|_{3,})\s*$/, "delimiter"],
      // 목록 글머리만 칠하고 본문은 인라인 규칙으로 넘긴다.
      [/^\s*(?:[-*+]|\d+\.)\s+\[[ xX]\]/, "keyword"],
      [/^\s*(?:[-*+]|\d+\.)\s/, "keyword"],
      { include: "@inline" },
    ],
    inline: [
      // 안정 id — 이 문서 형식의 뼈대다.
      [/\{#[\w-]+\}/, "variable.anchor"],
      [/`[^`]*`/, "string"],
      [/\*\*[^*]+\*\*/, "strong"],
      [/__[^_]+__/, "strong"],
      [/\*[^*\n]+\*/, "emphasis"],
      [/(?<![\w_])_[^_\n]+_(?![\w_])/, "emphasis"],
      [/!?\[[^\]]*\]\([^)]*\)/, "string.link"],
      [/<https?:[^>]+>/, "string.link"],
      [/<!--/, { token: "comment", next: "@html_comment" }],
      [/\|/, "delimiter"],
    ],
    fence: [
      [/^\s*```\s*$/, { token: "string", next: "@pop" }],
      [/.*$/, "string"],
    ],
    html_comment: [
      [/-->/, { token: "comment", next: "@pop" }],
      [/./, "comment"],
    ],
  },
};

/** `setup.ts` 가 한 번만 부른다 — 등록은 전역이라 두 번 하면 뒤엣것이 덮는다. */
export function registerProseLanguage(monaco: Monaco): void {
  monaco.languages.register({ id: PROSE_LANGUAGE_ID });
  monaco.languages.setLanguageConfiguration(PROSE_LANGUAGE_ID, CONF);
  monaco.languages.setMonarchTokensProvider(PROSE_LANGUAGE_ID, LANGUAGE);
}
