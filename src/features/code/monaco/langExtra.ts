// Monaco 0.56 에 **없는** 두 문법 — JSON · TOML (D1a).
//
// 0.56 의 Monarch 문법 84종에 `json` 이 없다: JSON 강조는 워커 기반 언어
// 서비스(`vs/language/json`)에만 있고, D1 로 그 워커를 끄기 때문에 함께
// 사라진다. `toml` 은 아예 목록에 없다.
//
// 둘 다 CodeMirror 판에서는 강조되던 언어라(`@codemirror/lang-json` ·
// `legacy-modes/mode/toml`) 그냥 두면 회귀다. `json.worker` 를 예외로 켜는
// 안은 기각했다 — +404KB 에 완성·진단 이중화를 막는 배선이 또 붙고 TOML 은
// 여전히 무채색이다. 그래서 문법 둘을 직접 든다.
//
// 토큰 이름은 `monaco/theme.ts` 가 아는 것들만 쓴다 (string · number ·
// comment · keyword · type · delimiter · attribute.name).

import type * as MonacoNs from "monaco-editor/editor/editor.api";

type Monaco = typeof MonacoNs;

/** 두 언어가 함께 쓰는 문자열 이스케이프. */
const ESCAPES = /\\(?:[bfnrt"'\\/]|u[0-9A-Fa-f]{4})/;

const JSON_CONF: MonacoNs.languages.LanguageConfiguration = {
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
  brackets: [
    ["{", "}"],
    ["[", "]"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: '"', close: '"', notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: '"', close: '"' },
  ],
};

/**
 * JSON — `.jsonc` 도 같은 id 로 열리므로 주석을 문법에 넣는다 (순정 JSON 에서
 * 주석이 나오면 그건 이미 사람이 실수한 자리라, 초록으로 칠해 두는 편이
 * 무채색보다 눈에 띈다).
 *
 * 키와 값을 가른다: `"a": 1` 의 `"a"` 는 속성, `1` 은 값이다. 무엇이 키인지는
 * **뒤에 `:` 가 오는가**로만 판별할 수 있어 lookahead 를 쓴다.
 */
const JSON_LANGUAGE: MonacoNs.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".json",
  escapes: ESCAPES,
  tokenizer: {
    root: [
      [/"([^"\\]|\\.)*"(?=\s*:)/, "attribute.name"],
      [/"/, "string", "@string"],
      [/-?\d+(\.\d+)?([eE][-+]?\d+)?/, "number"],
      [/\b(?:true|false|null)\b/, "keyword"],
      [/[{}[\]]/, "delimiter.bracket"],
      [/[,:]/, "delimiter"],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/[ \t\r\n]+/, ""],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, "string", "@pop"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
  },
};

const TOML_CONF: MonacoNs.languages.LanguageConfiguration = {
  comments: { lineComment: "#" },
  brackets: [
    ["{", "}"],
    ["[", "]"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: '"', close: '"', notIn: ["string"] },
    { open: "'", close: "'", notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

/**
 * TOML — `Cargo.toml` · `tauri.conf` 이웃들이 이 저장소의 일상이다.
 *
 * 순서가 뜻이다. 테이블 머리(`[a.b]` · `[[x]]`)를 **줄 맨 앞에서** 먼저 잡지
 * 않으면 배열 값 `[1, 2]` 와 구별되지 않는다. 날짜(RFC 3339)를 숫자보다 먼저
 * 보는 이유도 같다 — `2026-09-09` 는 숫자 규칙에 먼저 걸리면 세 조각이 된다.
 */
const TOML_LANGUAGE: MonacoNs.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".toml",
  escapes: ESCAPES,
  tokenizer: {
    root: [
      [/^\s*#.*$/, "comment"],
      [/^\s*\[\[.*?\]\]/, "type"],
      [/^\s*\[.*?\]/, "type"],
      // 키 = 값. 따옴표 친 키도 키다.
      [/(^\s*)([\w.-]+|"[^"]*")(\s*)(=)/, ["", "attribute.name", "", "delimiter"]],
      [/"""/, "string", "@mlbasic"],
      [/'''/, "string", "@mlliteral"],
      [/"/, "string", '@string."'],
      // 리터럴 문자열 — 이스케이프가 없다는 것이 TOML 의 규칙이다.
      [/'[^']*'/, "string"],
      [/\b(?:true|false)\b/, "keyword"],
      [/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[-+]\d{2}:\d{2})?)?/, "number"],
      [/\d{2}:\d{2}:\d{2}(?:\.\d+)?/, "number"],
      [/[-+]?(?:0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+)/, "number"],
      [/[-+]?(?:\d[\d_]*)(?:\.[\d_]+)?(?:[eE][-+]?\d+)?/, "number"],
      [/[-+]?(?:inf|nan)\b/, "number"],
      [/[{}[\]]/, "delimiter.bracket"],
      [/[,=]/, "delimiter"],
      [/#.*$/, "comment"],
      [/[ \t\r\n]+/, ""],
    ],
    string: [
      [/[^\\"']+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/["']/, { cases: { "$#==$S2": { token: "string", next: "@pop" }, "@default": "string" } }],
    ],
    mlbasic: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"""/, "string", "@pop"],
      [/"/, "string"],
    ],
    mlliteral: [
      [/[^']+/, "string"],
      [/'''/, "string", "@pop"],
      [/'/, "string"],
    ],
  },
};

/**
 * 0.56 이 안 주는 언어 둘을 등록한다. `setup.ts` 가 딱 한 번 부른다 —
 * 등록은 전역이고 두 번 하면 뒤엣것이 앞엣것을 덮는다.
 */
export function registerExtraLanguages(monaco: Monaco): void {
  monaco.languages.register({ id: "json", extensions: [".json", ".jsonc"], aliases: ["JSON"] });
  monaco.languages.setLanguageConfiguration("json", JSON_CONF);
  monaco.languages.setMonarchTokensProvider("json", JSON_LANGUAGE);

  monaco.languages.register({ id: "toml", extensions: [".toml"], aliases: ["TOML"] });
  monaco.languages.setLanguageConfiguration("toml", TOML_CONF);
  monaco.languages.setMonarchTokensProvider("toml", TOML_LANGUAGE);
}
