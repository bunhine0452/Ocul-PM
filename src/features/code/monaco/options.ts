// 편집기 옵션 — **한 곳에서, 순수 함수로** (Phase 3 `{#cap-basics}`).
//
// 왜 떼어냈나: 이 라운드가 켠 기본기(폴딩 · 괄호 매칭 · 자동 괄호 닫기 · 선택
// 일치 강조 · 입력 시 들여쓰기 · 다중 커서)는 **옵션 몇 줄**이 전부라, 누가
// 리팩터링하다 한 줄을 지워도 아무 테스트도 안 깨지고 화면만 조용히 옛날로
// 돌아간다. CodeMirror 판이 정확히 그 상태였다 — 지붕(LSP 17커맨드 · DAP)은
// 올렸는데 `foldGutter` · `bracketMatching` · `closeBrackets` ·
// `indentOnInput` · `multipleSelections` 가 전부 0이었다.
//
// 그래서 옵션을 값으로 만들고 `monaco_options.test.ts` 가 그 값을 문다.
//
// 여기서 monaco 를 임포트하지 않는다 (타입만) — jsdom 테스트가 편집기를 통째로
// 로드하지 않게 하려는 것으로, `codeLang.ts` 와 같은 이유다.

import type * as MonacoNs from "monaco-editor/editor/editor.api";

export interface EditorOptionsInput {
  /** `monaco/theme.ts` 의 테마 이름. */
  theme: string;
  /** 중단점 거터를 다는가 — 디버그 불가 파일에서 빈 칸이 남으면 누를 수 있는 자리처럼 보인다. */
  glyphMargin: boolean;
  /** 겹쳐 고정할 줄 수. `0` 이면 스티키를 끈다. */
  stickyMaxLines: number;
  /** 설정 `codeTabSize`. */
  tabSize: number;
  /** 설정 `codeInsertSpaces`. */
  insertSpaces: boolean;
  /** 설정 `codeMinimap`. */
  minimap: boolean;
  /** 줄바꿈 (화면 상태 `codeWordWrap` 을 파일 종류로 푼 값). */
  wordWrap: boolean;
}

/**
 * 미니맵 옵션 한 벌. **켜고 끄는 자리도 이걸 써야 한다** — Monaco 의
 * `updateOptions({ minimap: { enabled } })` 는 나머지 필드를 기본값으로 되돌려,
 * 마운트 직후 효과가 한 번 돌기만 해도 덩어리 렌더·상시 손잡이가 조용히 사라진다.
 */
export function minimapOptions(enabled: boolean): MonacoNs.editor.IEditorMinimapOptions {
  // 글자 대신 **덩어리**로 그린다 — 13px 본문의 1px 축소판은 어차피 못 읽고,
  // 읽으려 드는 순간 눈이 그리로 샌다. 덩어리는 밀도(어디가 빽빽한가)만 말한다.
  // 손잡이는 늘 보인다 — 스크롤 위치가 곧 미니맵의 쓸모다.
  return { enabled, renderCharacters: false, showSlider: "always", maxColumn: 100, scale: 1 };
}

/**
 * 편집기 하나의 옵션 전부.
 *
 * **`detectIndentation: false` 가 의도다.** Monaco 기본값은 `true` 라 파일
 * 내용에서 들여쓰기를 추정해 `tabSize`·`insertSpaces` 를 덮는다. 이 앱에는
 * 사용자가 고른 `codeTabSize`·`codeInsertSpaces` 가 있고 **저장 시 포맷이 그
 * 값으로 간다**(`lsp_format` 옵션). 추정을 켜 두면 4로 그려 놓고 저장할 때
 * 2로 다시 들여써서 파일 전체가 diff 로 물든다. 화면과 저장이 같은 값을
 * 보게 한다.
 */
export function baseEditorOptions(
  input: EditorOptionsInput,
): MonacoNs.editor.IStandaloneEditorConstructionOptions {
  return {
    theme: input.theme,
    automaticLayout: true,
    fontSize: 13,
    fontFamily: "var(--mono)",
    lineHeight: 1.6,
    tabSize: input.tabSize,
    insertSpaces: input.insertSpaces,
    detectIndentation: false,
    glyphMargin: input.glyphMargin,
    // `outlineModel` 은 **사슬**이다 — 심볼 공급자가 있으면 그것으로, 없거나
    // 빈 답이면 폴딩 → 들여쓰기로 스스로 떨어진다(`stickyScrollModelProvider`
    // 의 fall-through). 그래서 언어 서버가 없는 파일에서도 CodeMirror 판의
    // 들여쓰기 폴백과 같은 그림이 나온다.
    stickyScroll: {
      enabled: input.stickyMaxLines > 0,
      maxLineCount: Math.max(input.stickyMaxLines, 1),
      defaultModel: "outlineModel",
    },
    minimap: minimapOptions(input.minimap),
    // 줄바꿈 — 마운트 뒤에는 `CodeEditor` 가 `updateOptions` 로 바꾼다 (⌥Z ·
    // 상태줄). 산문(md·txt)은 화면이 기본으로 켜서 내려보낸다.
    wordWrap: input.wordWrap ? "on" : "off",
    wrappingIndent: "same",
    scrollBeyondLastLine: true,
    // 거터까지 한 띠로 — 줄번호 칸이 다른 색(`--code-gutter`)이라 `line` 만
    // 칠하면 띠가 거터 앞에서 끊겨 두 물건으로 보인다.
    renderLineHighlight: "all",
    // 줄번호 폭 3자(999줄까지 안 흔들림) · 거터 안쪽 여백은 git 띠(3px)+접기 손잡이.
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 14,
    // 커서 — 2px 액센트 막대, 이동은 미끄러진다. 움직임 축소 설정은 Monaco 가
    // 스스로 존중한다(`accessibilitySupport` 와 `prefers-reduced-motion`).
    cursorWidth: 2,
    cursorBlinking: "smooth",
    cursorSmoothCaretAnimation: "on",
    smoothScrolling: true,
    // 선택 영역 모서리를 둥글리지 않는다 — 글자 격자 위의 도형은 각져야 격자에 맞는다.
    roundedSelection: false,
    overviewRulerBorder: false,

    // ── 여기서부터가 CodeMirror 판에 **아예 없던** 기본기다 {#cap-basics} ──
    folding: true,
    foldingHighlight: true,
    matchBrackets: "always",
    autoClosingBrackets: "languageDefined",
    autoClosingQuotes: "languageDefined",
    // 선택해 두고 따옴표·괄호를 치면 감싼다 (지우고 덮어쓰지 않는다).
    autoSurround: "languageDefined",
    // 언어 설정의 들여쓰기 규칙까지 쓴다 — `{` 뒤 개행에서 한 칸 들어가고
    // `}` 를 치면 도로 나온다. `advanced` 는 그중 onEnter 규칙만 쓴다.
    autoIndent: "full",
    selectionHighlight: true,
    occurrencesHighlight: "singleFile",
    // 브래킷 쌍 색칠 · 들여쓰기 가이드는 자리를 안 먹으므로 설정을 두지 않는다
    // (미니맵만 폭을 먹어 좁은 분할에서 문제가 되므로 그것만 끄고 켠다).
    bracketPairColorization: { enabled: true },
    // 괄호 쌍 가이드는 **커서가 든 쌍만** — 전부 그리면 들여쓰기 가이드와 겹쳐 격자가 된다.
    guides: { indentation: true, bracketPairs: "active", highlightActiveIndentation: true },

    // ── 다중 커서 · 열 선택 {#cap-multicursor} ──
    // macOS 관례대로 ⌥클릭이 커서를 더한다. ⌥⇧드래그는 같은 수식키에 ⇧ 가
    // 붙은 것이라 자동으로 열(블록) 선택이 된다. ⌘D(다음 일치 추가)는
    // `multicursor` 기여가 들고 온다 — 앱에 ⌘D 를 쓰는 자리가 없어 안 부딪힌다.
    multiCursorModifier: "alt",
    multiCursorMergeOverlapping: true,

    // ── 기여는 실려 있는데 옵션이 꺼져 있던 것 ──
    // `setup.ts` 는 `linkedEditing` 기여를 싣지만 Monaco 기본값이 false 라
    // **죽은 임포트**였다 — 이 파일 머리가 경고하는 바로 그 모양이 이미 한 번
    // 일어나 있었던 셈이다. 켜면 여는 태그를 고칠 때 닫는 태그가 같이 바뀐다
    // (JSX·HTML·XML). 서버가 `linkedEditingRangeProvider` 를 안 주면 조용히
    // 아무 일도 안 하므로 켜 두는 쪽이 손해가 없다.
    linkedEditing: true,

    // 커서 위아래로 최소 세 줄은 남긴다 (vim 의 scrolloff). 0 이면 화면 맨
    // 아랫줄에서 타이핑하게 되고, 다음 줄이 안 보이니 매번 손으로 스크롤해야
    // 한다 — 커서를 따라다니는 것은 편집기의 일이다.
    cursorSurroundingLines: 3,

    // 탭으로 들여쓴 파일에서 ←/→ 가 **탭 한 칸**씩 움직인다. 없으면 탭 하나가
    // 커서 한 번에 지나가 버려, 들여쓰기 안에서 자리를 잡을 수가 없다.
    stickyTabStops: true,

    // 고른 완성 항목이 커서 자리에 미리 들어가 보이고(고스트), 목록 아래에
    // ⏎/⇥ 안내가 선다. 무엇이 들어갈지 **넣기 전에** 보이는 것이 자동완성의
    // 절반이다.
    suggest: { preview: true, showStatusBar: true },

    // ── 시맨틱 강조 {#cap-semantic} ──
    // 표준 Monaco 의 기본값은 `'configuredByTheme'` 인데 **standalone 테마는
    // `semanticHighlighting` 을 항상 false 로 들고 있다** (StandaloneTheme 이
    // 생성자에서 못박는다). 그래서 공급자를 아무리 등록해도 이 한 줄이 없으면
    // Monaco 는 묻지조차 않는다. 옵션은 설정 서비스로 흘러 들어간다
    // (`updateConfigurationService` → `editor.semanticHighlighting.enabled`).
    "semanticHighlighting.enabled": true,

    // 마지막 줄 아래 여백 — 파일 끝을 화면 가운데로 올려 읽을 수 있게.
    padding: { bottom: 300 },
    // 위젯(호버·완성·시그니처)을 body 아래로 — 좁은 분할에서 잘리지 않는다.
    fixedOverflowWidgets: true,
    // 앱의 가는 스크롤바(10px)와 같은 두께 — 기본 14px 은 편집면 옆에서 혼자 굵었다.
    scrollbar: { useShadows: false, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  };
}

/**
 * 인라인 비교(diff 편집기)용 덮어쓰기.
 *
 * 원본과 수정본을 **한 열**에 그린다 (CodeMirror 의 unifiedMergeView 와 같은
 * 모양). 미니맵과 개요 눈금자는 diff 에서 자리만 먹는다 — 어디가 바뀌었는지는
 * 이미 본문에 색으로 있다.
 */
export function diffEditorOptions(
  base: MonacoNs.editor.IStandaloneEditorConstructionOptions,
): MonacoNs.editor.IStandaloneDiffEditorConstructionOptions {
  return {
    ...base,
    renderSideBySide: false,
    originalEditable: false,
    renderOverviewRuler: false,
    minimap: { enabled: false },
  };
}
