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
  // ── 위젯 크롬 (2026-09-09) ──
  // 예전엔 이 다리가 **색 10개**만 정하고 나머지는 `inherit: true` 로 base
  // (`vs`/`vs-dark`) 에 맡겼다. 그 결과 ⌘F 검색창 · 자동완성 목록 · 우클릭
  // 메뉴 · 피크 뷰 · 인레이 힌트가 전부 VS Code 기본 회색으로 떴다 —
  // 아이보리 캔버스 위에 남의 앱 조각이 떠 있는 그림이고, 프리셋
  // (Solarized·Nord·Dracula) 을 고르면 아예 딴 세상이 된다. 위젯은 편집기의
  // 절반이므로, 편집기 색은 정해 놓고 위젯을 안 정하면 "테마가 있다" 고 할 수
  // 없다. 아래 토큰이 그 크롬 전부의 재료다.
  "--bg-content",
  "--bg-card",
  "--bg-inset",
  "--bg-hover",
  "--sep",
  "--sep-strong",
  "--accent",
  "--accent-soft",
  "--accent-ring",
  "--danger",
  "--warn",
  "--info",
  "--ok",
  "--diff-add-line",
  "--diff-del-line",
] as const;

export type CodeTokenValues = Record<string, string>;

/** 현재 계산된 `--code-*` 값들. 요소를 받는 이유는 프리셋이 조상에 걸리기 때문. */
export function readCodeTokens(el: Element): CodeTokenValues {
  const cs = getComputedStyle(el);
  const out: CodeTokenValues = {};
  for (const name of CODE_TOKENS) out[name] = cs.getPropertyValue(name).trim();
  return out;
}

/** 0~255 한 칸을 두 자리 16진수로. */
function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

/**
 * `#rrggbb`/`#rrggbbaa` 의 **알파만** 갈아끼운다 (0~1).
 *
 * 위젯 색 몇 개는 토큰에 이름이 없다 — 스크롤바 손잡이 3단 · 들여쓰기 가이드의
 * 활성/비활성처럼 "같은 잉크의 다른 농도" 라 램프에 자리를 만들 것도 아니다.
 * CSS 쪽 스크롤바가 `color-mix(--text-3 30%)` 로 쓰는 것과 같은 규칙을 여기서는
 * 이 함수가 편다.
 */
function withAlpha(hex: string, a: number): string {
  return hex.slice(0, 7) + hex2(a * 255);
}

/**
 * Monaco 는 `#rrggbb`(+aa) 만 받는다 — `color-mix()` · `oklch()` · 이름색은 던진다.
 * 토큰이 그런 형태로 오면 이 함수가 canvas 로 한 번 굽는다.
 */
function toHex(value: string, fallback: string): string {
  const v = (value ?? "").trim();
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
      const parts = m[1].split(",").map((n) => parseFloat(n));
      const a = parts.length > 3 ? parts[3] : 1;
      // **알파를 버리지 않는다.** 이 다리가 굽는 값의 절반은
      // `color-mix(…, transparent)` 라 (활성 줄 5% · 선택 20% · 같은 낱말 12% ·
      // 검색 일치 35%) 알파가 곧 그 토큰의 전부다. 예전 코드는 r·g·b 셋만
      // 집어 돌려줘서, 선택 영역이 **불투명한 액센트 판**이 되어 고른 글자를
      // 덮었다. Monaco 는 `#rrggbbaa` 를 받는다.
      const rgb = [parts[0], parts[1], parts[2]].map(hex2).join("");
      return a >= 1 ? "#" + rgb : "#" + rgb + hex2(a * 255);
    }
  } catch {
    /* jsdom 등 canvas 가 없는 환경 */
  }
  return fallback;
}

/**
 * 토큰값으로 Monaco 테마를 정의(또는 재정의)한다.
 *
 * `dark` 는 base 선택용이다. 2026-09-09 이전에는 여기에 색이 **열 개**뿐이라
 * base(`vs`/`vs-dark`) 가 위젯 크롬 전부를 칠했고, 그래서 ⌘F·자동완성·우클릭
 * 메뉴만 VS Code 회색이었다. 이제 위젯까지 토큰으로 덮으므로 base 가 남기는
 * 것은 우리가 이름조차 모르는 구석뿐이다.
 */
export function defineCodeTheme(
  monaco: typeof MonacoNs,
  tokens: CodeTokenValues,
  dark: boolean,
): void {
  const fg = toHex(tokens["--code-fg"], dark ? "#d4d4d4" : "#1f1f1f");
  const pick = (name: string, fb: string) => toHex(tokens[name], fb);

  // 위젯 크롬의 재료. fallback 은 **base 테마 값이 아니라 우리 팔레트의 기본
  // 가족**이다 — 토큰을 못 읽는 상황(테스트·이른 호출)에서도 앱 얼굴로
  // 떨어져야지, VS Code 회색으로 떨어지면 이 라운드가 고친 것이 도로 나온다.
  const surface = pick("--bg-card", dark ? "#222825" : "#ffffff");
  const surfaceIn = pick("--bg-inset", dark ? "#282e2b" : "#f0ede4");
  const surfaceBody = pick("--bg-content", dark ? "#1c211f" : "#faf9f5");
  const line = pick("--sep", dark ? "#ffffff14" : "#3c342619");
  const lineStrong = pick("--sep-strong", dark ? "#ffffff26" : "#3c34262b");
  const hover = pick("--bg-hover", dark ? "#ffffff0e" : "#3830240d");
  const accent = pick("--accent", dark ? "#34d095" : "#0e8a60");
  const accentSoft = pick("--accent-soft", dark ? "#34d09526" : "#e3f2ea");
  const accentRing = pick("--accent-ring", dark ? "#34d09566" : "#0e8a6052");
  const accentText = pick("--accent-text", dark ? "#34d095" : "#0a6b4b");
  const ink = pick("--text", dark ? "#e8e6e1" : "#211e18");
  const ink2 = pick("--text-2", dark ? "#a8a49b" : "#6d675c");
  const ink3 = pick("--text-3", dark ? "#8b867c" : "#797369");
  const danger = pick("--danger", "#e0524b");
  const warn = pick("--warn", "#c2810a");
  const info = pick("--info", "#2570e0");
  const ok = pick("--ok", "#12a06b");
  const addLine = pick("--diff-add-line", "#1f9d57");
  const delLine = pick("--diff-del-line", "#d6443c");

  monaco.editor.defineTheme(THEME_NAME, {
    base: dark ? "vs-dark" : "vs",
    // 우리가 안 정한 **문법 토큰**은 base 규칙을 물려받는다 (색 지정은 아래
    // `colors` 가 거의 전부 덮는다).
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
      // ── 편집면 ───────────────────────────────────────────────────────
      // 편집면 바탕은 **투명**이어야 한다 — 뒤의 `.code-pane` 이 그린다.
      // Monaco 는 `#rrggbbaa` 를 받으므로 00 알파로 준다.
      "editor.background": "#00000000",
      "editor.foreground": fg,
      "editorCursor.foreground": fg,
      "editor.lineHighlightBackground": pick("--code-active-line", "#00000010"),
      "editor.selectionBackground": pick("--code-selection", "#2c5d8f"),
      "editor.selectionHighlightBackground": pick("--code-selection-match", "#2c5d8f40"),
      "editor.inactiveSelectionBackground": withAlpha(accent, 0.1),
      // 지금 걸린 일치와 나머지 일치는 **다른 색**이어야 한다. 둘 다
      // `--code-search-match` 였던 탓에 ⏎ 로 다음 일치로 넘어가도 어디로 갔는지
      // 화면이 말해 주지 않았다 (토큰은 처음부터 두 벌이었는데 한 벌만 썼다).
      "editor.findMatchBackground": pick("--code-search-current", "#e5c07b99"),
      "editor.findMatchHighlightBackground": pick("--code-search-match", "#e5c07b59"),
      "editor.findRangeHighlightBackground": withAlpha(accent, 0.07),
      "editor.rangeHighlightBackground": withAlpha(accent, 0.07),
      // 커서가 놓인 낱말의 다른 출현 — 읽기(약)와 쓰기(강)를 나눈다.
      "editor.wordHighlightBackground": pick("--code-selection-match", "#2c5d8f40"),
      "editor.wordHighlightStrongBackground": withAlpha(accent, 0.22),
      "editorWhitespace.foreground": withAlpha(ink3, 0.3),
      "editorRuler.foreground": line,
      "editorLink.activeForeground": accentText,
      "editorCodeLens.foreground": ink3,
      "editorInlayHint.background": withAlpha(ink3, 0.12),
      "editorInlayHint.foreground": ink3,
      "editorGhostText.foreground": withAlpha(ink3, 0.7),

      // 줄번호 — 지금 줄만 본문색으로 올린다. 예전엔 전부 주석색이라
      // 커서가 몇 번째 줄에 있는지 거터가 답하지 않았다.
      "editorLineNumber.foreground": pick("--code-comment", "#8a8a8a"),
      "editorLineNumber.activeForeground": ink2,

      // 들여쓰기 가이드 · 괄호 — 구조를 그리는 선들.
      "editorIndentGuide.background1": withAlpha(ink3, 0.16),
      "editorIndentGuide.activeBackground1": withAlpha(ink3, 0.45),
      "editorBracketMatch.background": withAlpha(accent, 0.16),
      "editorBracketMatch.border": accentRing,
      // 짝 색칠 6단 — 문법 팔레트를 그대로 돌려 쓴다 (새 색을 만들지 않는다).
      "editorBracketHighlight.foreground1": pick("--code-fn", fg),
      "editorBracketHighlight.foreground2": pick("--code-type", fg),
      "editorBracketHighlight.foreground3": pick("--code-kw", fg),
      "editorBracketHighlight.foreground4": pick("--code-num", fg),
      "editorBracketHighlight.foreground5": pick("--code-prop", fg),
      "editorBracketHighlight.foreground6": pick("--code-str", fg),
      "editorBracketHighlight.unexpectedBracket.foreground": danger,

      // 진단 — 상태색 램프 그대로. 물결선이 앱의 오류색과 달랐다.
      "editorError.foreground": danger,
      "editorWarning.foreground": warn,
      "editorInfo.foreground": info,
      "editorHint.foreground": ink3,
      "editorLightBulb.foreground": warn,
      "editorLightBulbAutoFix.foreground": ok,

      // 개요 눈금자(오른쪽 얇은 띠) — 어디에 무엇이 있는지의 축소판.
      "editorOverviewRuler.border": "#00000000",
      "editorOverviewRuler.errorForeground": danger,
      "editorOverviewRuler.warningForeground": warn,
      "editorOverviewRuler.infoForeground": info,
      "editorOverviewRuler.findMatchForeground": pick("--code-search-current", "#e5c07b99"),
      "editorOverviewRuler.selectionHighlightForeground": withAlpha(accent, 0.3),
      "editorOverviewRuler.wordHighlightForeground": withAlpha(accent, 0.3),
      "editorOverviewRuler.addedForeground": addLine,
      "editorOverviewRuler.deletedForeground": delLine,
      "editorOverviewRuler.modifiedForeground": accent,
      "editorOverviewRuler.bracketMatchForeground": accentRing,

      // 겹쳐 고정되는 상위 스코프 — 본문과 같은 바탕이어야 "고정된 본문" 으로
      // 읽힌다 (다른 색이면 떠 있는 패널로 보인다).
      "editorStickyScroll.background": surfaceBody,
      "editorStickyScrollHover.background": hover,
      "editorStickyScroll.border": line,

      // ── 위젯 크롬 ────────────────────────────────────────────────────
      // 여기부터가 예전에 통째로 비어 있던 자리다. 자동완성·호버·⌘F·우클릭
      // 메뉴·피크는 전부 아래 색들 위에 그려진다.
      focusBorder: accentRing,
      "widget.shadow": withAlpha(ink, 0.16),
      "widget.border": lineStrong,
      "editorWidget.background": surface,
      "editorWidget.foreground": ink2,
      "editorWidget.border": lineStrong,
      "editorWidget.resizeBorder": accentRing,
      "editorHoverWidget.background": surface,
      "editorHoverWidget.foreground": ink2,
      "editorHoverWidget.border": lineStrong,
      "editorHoverWidget.statusBarBackground": surfaceIn,
      "editorSuggestWidget.background": surface,
      "editorSuggestWidget.foreground": ink2,
      "editorSuggestWidget.border": lineStrong,
      "editorSuggestWidget.selectedBackground": accentSoft,
      "editorSuggestWidget.selectedForeground": ink,
      "editorSuggestWidget.highlightForeground": accentText,
      "editorSuggestWidget.focusHighlightForeground": accentText,
      "editorSuggestWidgetStatus.foreground": ink3,

      // 목록 — 자동완성·피크·빠른 열기가 전부 이 한 벌을 공유한다.
      "list.hoverBackground": hover,
      "list.hoverForeground": ink,
      "list.focusBackground": accentSoft,
      "list.focusForeground": ink,
      "list.activeSelectionBackground": accentSoft,
      "list.activeSelectionForeground": ink,
      "list.inactiveSelectionBackground": surfaceIn,
      "list.inactiveSelectionForeground": ink,
      "list.highlightForeground": accentText,
      "list.focusHighlightForeground": accentText,
      "list.errorForeground": danger,
      "list.warningForeground": warn,

      // 입력칸 — ⌘F 의 찾기/바꾸기 칸과 그 토글들.
      "input.background": surfaceIn,
      "input.foreground": ink,
      "input.border": line,
      "input.placeholderForeground": ink3,
      "inputOption.activeBackground": accentSoft,
      "inputOption.activeForeground": accentText,
      "inputOption.activeBorder": accentRing,
      "inputValidation.errorBackground": surface,
      "inputValidation.errorForeground": danger,
      "inputValidation.errorBorder": danger,

      // 우클릭 메뉴 — 앱의 `.code-ctxmenu` 와 같은 얼굴이어야 한다.
      "menu.background": surface,
      "menu.foreground": ink2,
      "menu.border": lineStrong,
      "menu.selectionBackground": accentSoft,
      "menu.selectionForeground": ink,
      "menu.separatorBackground": line,

      // 빠른 열기(⌘P 계열 · Monaco 내장) — 앱 팔레트와 같은 규격.
      "quickInput.background": surface,
      "quickInput.foreground": ink,
      "quickInputTitle.background": surfaceIn,
      "quickInputList.focusBackground": accentSoft,
      "quickInputList.focusForeground": ink,
      "pickerGroup.foreground": ink3,
      "pickerGroup.border": line,

      // 피크(정의·참조를 제자리에서 펼치기).
      "peekView.border": accent,
      "peekViewEditor.background": surfaceBody,
      "peekViewEditor.matchHighlightBackground": pick("--code-search-match", "#e5c07b59"),
      "peekViewEditorGutter.background": surfaceBody,
      "peekViewResult.background": surfaceIn,
      "peekViewResult.fileForeground": ink,
      "peekViewResult.lineForeground": ink2,
      "peekViewResult.selectionBackground": accentSoft,
      "peekViewResult.selectionForeground": ink,
      "peekViewResult.matchHighlightBackground": pick("--code-search-match", "#e5c07b59"),
      "peekViewTitle.background": surfaceIn,
      "peekViewTitleLabel.foreground": ink,
      "peekViewTitleDescription.foreground": ink3,

      // 스크롤바 손잡이 3단 — CSS 쪽 가는 스크롤바(`code.css` 프로덕션 다듬기)와
      // 같은 농도 규칙. 기본 회색은 어느 프리셋에서도 제자리가 아니었다.
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": withAlpha(ink3, 0.22),
      "scrollbarSlider.hoverBackground": withAlpha(ink3, 0.35),
      "scrollbarSlider.activeBackground": withAlpha(ink3, 0.5),

      // 잡다 — 배지·진행·아이콘·분할 손잡이.
      "badge.background": accentSoft,
      "badge.foreground": accentText,
      "progressBar.background": accent,
      "icon.foreground": ink3,
      "toolbar.hoverBackground": hover,
      "toolbar.activeBackground": pick("--bg-hover", "#0000000d"),
      "sash.hoverBorder": accentRing,
      "editorGroup.border": line,
      "textLink.foreground": accentText,
      "textLink.activeForeground": accentText,
      "textCodeBlock.background": surfaceIn,
      "textPreformat.foreground": pick("--code-str", fg),
      "textSeparator.foreground": line,

      // 인라인 비교(⌘K 편집의 diff 편집기)도 앱의 diff 색을 쓴다.
      "diffEditor.insertedTextBackground": withAlpha(addLine, 0.14),
      "diffEditor.removedTextBackground": withAlpha(delLine, 0.14),
      "diffEditor.insertedLineBackground": withAlpha(addLine, 0.09),
      "diffEditor.removedLineBackground": withAlpha(delLine, 0.09),
      "diffEditor.border": line,
      "diffEditorGutter.insertedLineBackground": withAlpha(addLine, 0.09),
      "diffEditorGutter.removedLineBackground": withAlpha(delLine, 0.09),
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
