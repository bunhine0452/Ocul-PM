// 테마 다리 — `--code-*` CSS 변수 → Monaco `defineTheme`.
//
// **여기가 조용한 회귀가 사는 자리다.** CodeMirror 판에서는 `.cm-*` 클래스가
// `var(--code-kw)` 를 직접 들고 있어서 `data-theme`/`data-preset` 을 바꾸면
// 브라우저가 알아서 다시 칠했다 — 리마운트도, JS 도 필요 없었다.
//
// Monaco 는 그렇지 않다. 테마를 `defineTheme` 로 **JS 객체**로 받고 CSS 변수를
// 읽지 않는다. 그래서 전환이 일어날 때마다 계산된 변수값을 읽어 테마를 다시
// 정의해 줘야 한다. 안 하면 프리셋을 바꿔도 코드 색만 옛것으로 남는다.

import type * as MonacoNs from "monaco-editor/editor/editor.api";

export const THEME_NAME = "oculpm";

/** 이 다리가 읽는 토큰 전부. `code.css`/`tokens.css` 의 정의와 같은 집합이어야 한다. */
export const CODE_TOKENS = [
  "--code-fg",
  "--code-kw",
  "--code-str",
  "--code-comment",
  "--code-num",
  "--code-fn",
  "--code-type",
  "--code-prop",
  "--code-def",
  "--code-op",
  "--code-active-line",
  "--code-selection",
  "--code-selection-match",
  "--code-search-match",
  "--code-search-current",
  // 산문(논의 문서) 쪽 — 코드 팔레트가 아니라 본문 팔레트를 쓴다. 테마는
  // Monaco 에서 **전역**이라(같은 시점에 두 벌을 못 쓴다) 한 테마에 두 언어의
  // 규칙을 함께 싣고, `.md-prose` 접미사로 갈라 서로를 안 건드리게 한다.
  "--text",
  "--text-2",
  "--text-3",
  "--accent-text",
] as const;

export type CodeTokenValues = Record<string, string>;

/** 현재 계산된 `--code-*` 값들. 요소를 받는 이유는 프리셋이 조상에 걸리기 때문. */
export function readCodeTokens(el: Element): CodeTokenValues {
  const cs = getComputedStyle(el);
  const out: CodeTokenValues = {};
  for (const name of CODE_TOKENS) out[name] = cs.getPropertyValue(name).trim();
  return out;
}

/**
 * Monaco 는 `#rrggbb`(+aa) 만 받는다 — `color-mix()` · `oklch()` · 이름색은 던진다.
 * 토큰이 그런 형태로 오면 이 함수가 canvas 로 한 번 굽는다.
 */
function toHex(value: string, fallback: string): string {
  const v = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) {
    // #rgb → #rrggbb (Monaco 는 3자리를 안 받는다)
    if (v.length === 4) return "#" + [...v.slice(1)].map((c) => c + c).join("");
    return v;
  }
  if (!v) return fallback;
  try {
    const c = document.createElement("canvas").getContext("2d");
    if (!c) return fallback;
    c.fillStyle = "#000";
    c.fillStyle = v; // 못 읽으면 앞의 값이 남는다
    const got = c.fillStyle;
    if (typeof got === "string" && got.startsWith("#")) return got;
    const m = /rgba?\(([^)]+)\)/.exec(String(got));
    if (m) {
      const [r, g, b] = m[1].split(",").map((n) => Math.round(parseFloat(n)));
      return (
        "#" +
        [r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("")
      );
    }
  } catch {
    /* jsdom 등 canvas 가 없는 환경 */
  }
  return fallback;
}

/**
 * 토큰값으로 Monaco 테마를 정의(또는 재정의)한다.
 *
 * `dark` 는 base 선택용 — 색은 전부 토큰이 이기지만, 우리가 안 덮는 부분
 * (위젯 그림자·스크롤바 등)의 기본값이 base 에서 온다.
 */
export function defineCodeTheme(
  monaco: typeof MonacoNs,
  tokens: CodeTokenValues,
  dark: boolean,
): void {
  const fg = toHex(tokens["--code-fg"], dark ? "#d4d4d4" : "#1f1f1f");
  const pick = (name: string, fb: string) => toHex(tokens[name], fb);

  monaco.editor.defineTheme(THEME_NAME, {
    base: dark ? "vs-dark" : "vs",
    // 우리가 안 정한 토큰은 base 테마 규칙을 그대로 물려받는다.
    inherit: true,
    rules: [
      { token: "", foreground: fg },
      { token: "keyword", foreground: pick("--code-kw", fg) },
      { token: "keyword.control", foreground: pick("--code-kw", fg) },
      { token: "string", foreground: pick("--code-str", fg) },
      { token: "string.escape", foreground: pick("--code-str", fg) },
      { token: "regexp", foreground: pick("--code-str", fg) },
      { token: "comment", foreground: pick("--code-comment", fg), fontStyle: "italic" },
      { token: "number", foreground: pick("--code-num", fg) },
      { token: "constant", foreground: pick("--code-num", fg) },
      { token: "function", foreground: pick("--code-fn", fg) },
      { token: "entity.name.function", foreground: pick("--code-fn", fg) },
      { token: "type", foreground: pick("--code-type", fg) },
      { token: "type.identifier", foreground: pick("--code-type", fg) },
      { token: "namespace", foreground: pick("--code-type", fg) },
      { token: "attribute.name", foreground: pick("--code-prop", fg) },
      { token: "variable", foreground: pick("--code-def", fg) },
      { token: "variable.predefined", foreground: pick("--code-def", fg) },
      { token: "identifier", foreground: fg },
      { token: "operator", foreground: pick("--code-op", fg) },
      { token: "delimiter", foreground: pick("--code-op", fg) },
      { token: "tag", foreground: pick("--code-kw", fg) },
      { token: "metatag", foreground: pick("--code-comment", fg) },

      // ── 논의 문서(`markdown-prose`) — 대비를 낮춰 읽는 데 방해가 없게 ──
      // CodeMirror 판 `mdHighlight` 가 하던 판단을 그대로 옮겼다: `##`(파서가
      // 아는 섹션)만 강조색이고 나머지 제목은 본문색이다.
      { token: "type.h1.md-prose", foreground: pick("--text", fg), fontStyle: "bold" },
      { token: "type.h2.md-prose", foreground: pick("--accent-text", fg), fontStyle: "bold" },
      { token: "type.h3.md-prose", foreground: pick("--text", fg), fontStyle: "bold" },
      { token: "type.h4.md-prose", foreground: pick("--text-2", fg), fontStyle: "bold" },
      { token: "strong.md-prose", foreground: pick("--text", fg), fontStyle: "bold" },
      { token: "emphasis.md-prose", foreground: pick("--text", fg), fontStyle: "italic" },
      { token: "string.link.md-prose", foreground: pick("--accent-text", fg) },
      { token: "string.md-prose", foreground: pick("--accent-text", fg) },
      { token: "keyword.md-prose", foreground: pick("--text-3", fg) },
      { token: "delimiter.md-prose", foreground: pick("--text-3", fg) },
      { token: "comment.md-prose", foreground: pick("--text-2", fg), fontStyle: "italic" },
      // 안정 id — 삽입 메뉴가 만들어 주지만 지워졌는지가 눈에 보여야 한다.
      { token: "variable.anchor.md-prose", foreground: pick("--text-3", fg) },
    ].map((r) => ({ ...r, foreground: r.foreground.replace("#", "") })),
    colors: {
      // 편집면 바탕은 **투명**이어야 한다 — 뒤의 `.code-pane` 이 그린다.
      // Monaco 는 `#rrggbbaa` 를 받으므로 00 알파로 준다.
      "editor.background": "#00000000",
      "editor.foreground": fg,
      "editorCursor.foreground": fg,
      "editor.lineHighlightBackground": pick("--code-active-line", "#00000010"),
      "editor.selectionBackground": pick("--code-selection", "#2c5d8f"),
      "editor.selectionHighlightBackground": pick("--code-selection-match", "#2c5d8f40"),
      "editor.findMatchBackground": pick("--code-search-match", "#5a4a1f"),
      "editor.findMatchHighlightBackground": pick("--code-search-match", "#5a4a1f"),
      "editorLineNumber.foreground": toHex(tokens["--code-comment"], "#8a8a8a"),
    },
  });
}

/**
 * `data-theme`/`data-preset` 이 바뀌면 테마를 다시 정의한다.
 *
 * CodeMirror 는 CSS 가 알아서 하던 일이라 이 감시자가 **회귀 방지 장치**다.
 * 반환값은 해제 함수.
 */
export function watchThemeChanges(onChange: () => void): () => void {
  const root = document.documentElement;
  const obs = new MutationObserver((records) => {
    if (records.some((r) => r.attributeName === "data-theme" || r.attributeName === "data-preset")) {
      onChange();
    }
  });
  obs.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-preset"] });
  return () => obs.disconnect();
}

/** 지금이 어두운 계열인가 — `data-theme` 가 없으면 시스템 설정을 따른다. */
export function isDarkTheme(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr) return attr.includes("dark");
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}
