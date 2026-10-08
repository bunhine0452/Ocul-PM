// 논의 편집기의 Monaco 설정 — 코드 화면과 **다른 물건**이다.
//
// 여기는 산문이라 줄 번호 · 미니맵 · 거터 · 접기가 전부 소음이고, 대신 줄바꿈이
// 켜져 있어야 한다. 문법도 코드용 `markdown` 이 아니라 `markdown-prose` 다 — 제목
// 단계와 `{#id}` 를 갈라 칠한다. 색은 `monaco/theme.ts` 의 한 테마가 준다(Monaco 의
// 테마는 전역이라 규칙을 `.md-prose` 접미사로 갈랐다).

import type * as MonacoNs from "monaco-editor/editor/editor.api";
import { PROSE_LANGUAGE_ID } from "@/features/code/monaco/langProse";
import { THEME_NAME } from "@/features/code/monaco/theme";

/** 원고 한 줄의 최대 폭(px). 한 칼럼으로 읽히는 폭 — 한글 40자 안팎. */
export const PROSE_MEASURE_PX = 680;
/** 좁은 판에서도 남기는 좌우 여백(px). */
export const PROSE_MIN_GUTTER_PX = 28;

export const PROSE_OPTIONS: MonacoNs.editor.IStandaloneEditorConstructionOptions = {
  theme: THEME_NAME,
  language: PROSE_LANGUAGE_ID,
  automaticLayout: true,
  // 산문은 본문 글꼴로 쓴다 — 고정폭이면 한국어 문단이 코드처럼 읽힌다. 비례 폭
  // 글꼴은 줄바꿈을 글자 수가 아니라 실제 폭으로 재야 해서 `advanced` 다.
  fontFamily: "var(--font)",
  fontSize: 15,
  lineHeight: 1.8,
  wrappingStrategy: "advanced",
  // 폭은 `keepProseCentered` 가 판 폭에 맞춰 다시 정한다 (여기 값은 첫 프레임용).
  wordWrap: "bounded",
  wordWrapColumn: 84,
  lineNumbers: "off",
  glyphMargin: false,
  folding: false,
  minimap: { enabled: false },
  renderLineHighlight: "none",
  lineDecorationsWidth: PROSE_MIN_GUTTER_PX,
  lineNumbersMinChars: 0,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollBeyondLastLine: false,
  // 문단 끝에서도 화면 가운데로 올려 쓸 수 있게.
  padding: { top: 28, bottom: 400 },
  fixedOverflowWidgets: true,
  scrollbar: { useShadows: false, vertical: "auto", horizontal: "hidden", verticalScrollbarSize: 10 },
  // 산문에서 자동 괄호 닫기는 방해가 더 크다(`(그런데` 를 치면 닫는 괄호가 따라온다).
  // 대신 **선택 감싸기**는 남긴다 — 서식 단축키와 같은 손놀림이다.
  autoClosingBrackets: "never",
  autoClosingQuotes: "never",
  autoSurround: "languageDefined",
  matchBrackets: "never",
  occurrencesHighlight: "off",
  selectionHighlight: false,
  guides: { indentation: false, bracketPairs: false },
  stickyScroll: { enabled: false },
  // ── 제안은 전부 끈다 (2026-10-08 사용자 보고: 쓰는 동안 자동완성이 계속 뜬다).
  // 이 언어엔 제안 제공자가 없는데도 떴던 것은 Monaco 기본값 — 문서의 단어를
  // 모아 타자마다 띄우는 `wordBasedSuggestions` + `quickSuggestions` — 때문이다.
  // 산문에서 그건 도움이 아니라 방해다. 손으로 부르는 ⌃Space 까지 막을 이유는
  // 없지만, 띄울 것이 없도록 단어 제안 자체를 끈다.
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  wordBasedSuggestions: "off",
  inlineSuggest: { enabled: false },
  parameterHints: { enabled: false },
  snippetSuggestions: "none",
  tabCompletion: "off",
  acceptSuggestionOnEnter: "off",
  hover: { enabled: "off" },
  // 한글 문장부호(·, ‘’ …)를 「헷갈리는 유니코드」 로 칠하지 않는다.
  unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
  // 다중 커서는 산문에서도 쓸모가 있다 (표의 같은 열을 한꺼번에 고친다).
  multiCursorModifier: "alt",
  contextmenu: false,
  tabSize: 2,
  insertSpaces: true,
  detectIndentation: false,
};

/**
 * 판 폭 → 왼쪽 여백과 줄바꿈 폭. 원고 칼럼이 판 가운데 오도록 좌우 여백을 같게
 * 하고, 좁으면 여백을 최소로 두고 칼럼을 줄인다 (순수).
 */
export function proseLayout(
  paneWidth: number,
  charWidth: number,
): { gutter: number; column: number } {
  const measure = Math.max(0, Math.min(PROSE_MEASURE_PX, paneWidth - 2 * PROSE_MIN_GUTTER_PX));
  const gutter = Math.max(PROSE_MIN_GUTTER_PX, Math.floor((paneWidth - measure) / 2));
  const column = Math.max(16, Math.floor(measure / Math.max(1, charWidth)));
  return { gutter, column };
}

/**
 * 원고 칼럼을 판 가운데에 둔다 — 폭이 바뀔 때마다 다시 맞춘다.
 *
 * 예전엔 CSS 로 `.view-lines` 를 78ch 에 묶었는데, 그건 Monaco 가 모르는 폭이다.
 * 줄바꿈은 판 끝에서 일어나고 화면은 78ch 에서 잘려서, 넓은 창의 원문 모드에서
 * **문장 가운데가 보이지 않은 채** 편집됐다 (2026-10-08 하네스로 확인). 이제 폭을
 * Monaco 에 말한다: 왼쪽 여백 = `lineDecorationsWidth`, 오른쪽 끝 = `wordWrapColumn`
 * (`bounded` 라 판이 더 좁으면 판 끝에서 접힌다).
 */
export function keepProseCentered(
  editor: MonacoNs.editor.IStandaloneCodeEditor,
  monaco: typeof MonacoNs,
): MonacoNs.IDisposable {
  let last = "";
  const apply = () => {
    const info = editor.getLayoutInfo();
    const font = editor.getOption(monaco.editor.EditorOption.fontInfo);
    const pane = info.width - info.verticalScrollbarWidth;
    if (pane <= 0) return;
    const { gutter, column } = proseLayout(pane, font.typicalHalfwidthCharacterWidth);
    const key = `${gutter}:${column}`;
    if (key === last) return;
    last = key;
    editor.updateOptions({ lineDecorationsWidth: gutter, wordWrapColumn: column });
  };
  apply();
  return editor.onDidLayoutChange(apply);
}
