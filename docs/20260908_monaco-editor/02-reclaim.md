# Phase 2 — 회수: 손으로 만든 것을 내장으로 갈아치웠다

> 플랜: [`monaco-editor-round`](../../.oculpm/planner/monaco-editor-round.md) `{#reclaim}`
> 앞선 단계: [`01-spike.md`](01-spike.md) (Phase 0) · Phase 1 은 일지
> `.oculpm/journal/20260908/Refactors/2014_refactor_monaco-port-phase1.md`.

Phase 1 은 **계약을 지키며 갈아끼우는** 단계라 옛 파일을 지우지 않았다. 이
단계가 그 뒷정리다 — "이관은 순증이 아니라 순감이다" 를 숫자로 만든다.

## 지운 것

| 파일 | 줄 | 대체 |
|---|---:|---|
| `code/stickyScroll.ts` | 229 | Monaco `stickyScroll` 옵션 |
| `code/stickyModel.ts` | 152 | 위 + `monaco/symbols.ts`(123) |
| `code/signatureTooltip.ts` | 172 | Monaco `parameterHints` 위젯 |
| `code/gitGutter.ts` | 86 | `monaco/decorations.ts` (Phase 1) |
| `code/breakpointGutter.ts` | 99 | `monaco/decorations.ts` (Phase 1) |
| `code/codeLang.ts` 의 언어 확장부 | 27 | Monarch 언어 id |
| `code/lspBridge.ts` 의 CM 변환부 | 67 | `monaco/lsp.ts` (Phase 1) |
| `code/code.css` 의 `.cm-*` 규칙 | 45개 | Monaco 선택자 |

`gitGutter.ts` · `breakpointGutter.ts` · `lspBridge.ts` 의 CM 절반은 Phase 1 이
대체해 놓고 **지우지 않은 잔재**였다. 플랜 항목에는 없지만 같은 이유로 함께
지운다 — 아무도 부르지 않는 코드가 `@codemirror/*` 임포트를 붙들고 있으면
Phase 4 의 의존성 제거가 그 자리에서 막힌다.

## 새로 쓴 것

| 파일 | 줄 | 왜 |
|---|---:|---|
| `monaco/symbols.ts` | 123 | LSP 심볼 → Monaco 아웃라인 (스티키의 원천) |
| `monaco/langExtra.ts` | 165 | 0.56 에 없는 JSON · TOML Monarch 문법 (D1a) |

## 결정

### 스티키는 아웃라인 모델로 간다 {#sticky-outline}

Phase 1 은 `defaultModel: "indentationModel"` 로 두었다 —
`DocumentSymbolProvider` 가 없으면 `outlineModel` 이 0줄을 그리기 때문이다.
이번에 그 공급자를 달았고, `outlineModel` 로 올렸다. 그 값은 **사슬**이라
(`stickyScrollModelProvider.js` 의 fall-through) 심볼이 없거나 빈 답이면
폴딩 → 들여쓰기로 스스로 떨어진다. 언어 서버가 없는 파일에서 CodeMirror 판과
같은 그림이 나오는 근거가 이것이다.

백엔드는 심볼의 **시작 줄만** 준다. 그래서 `toDocumentSymbols` 가 두 가지를
지어낸다 — 끝 줄(다음 형제의 시작 앞)과 중첩(`depth` 로 부모 되찾기). 앞엣것은
CodeMirror 판 `stickyFromSymbols` 가 쓰던 것과 **같은 추정**이고 대가도 같다:
함수 사이 빈 줄에서 앞 함수가 아직 감싸는 것처럼 보인다. 뒤엣것을 빼먹으면
스티키가 사슬이 아니라 가장 안쪽 한 줄만 그린다.

### ⇧⌘O 를 편집기에서 되돌린다 {#shadow-quick-outline}

심볼 공급자를 다는 순간 Monaco 의 내장 `quickOutline`(⇧⌘O)이 **켜진다** —
그 액션의 `precondition` 이 `hasDocumentSymbolProvider` 라, 공급자가 없을 때는
키가 아예 안 걸려 있었다. 그대로 두면 "스티키를 켜면 ⇧⌘O 가 다른 창을 연다"
는 들쭉날쭉함이 생기고, 이 화면의 파일 안 이동은 미리 점프와 `:줄` 모드를
겸하는 `CodeGoto` 다.

그래서 `CodeEditor` 에 같은 키의 액션을 얹어 부모로 되돌린다 — 동적
키바인딩(weight 1000)이 기여 액션(100)을 이긴다. 이 때문에 `CodeEditorProps`
에 `onGoToSymbol` 하나가 늘었다. **D2("계약을 한 줄도 안 바꾼다")는 Phase 1 의
회귀 범위를 좁히는 장치였고**, 그 목적은 이미 달성됐다(테스트 2,451개가 한 줄도
안 고치고 통과했다). 여기서 한 줄을 늘리는 대신 키 하나가 조용히 뒤바뀌는 것을
막는다.

### `CodeSearchPanel` 은 Monaco 로 대체할 수 없다 — 남긴다 {#search-verdict}

플랜 `{#reclaim-search}` 의 판정이다. **자리가 다르다.**

| | Monaco find/replace 위젯 | `CodeSearchPanel.tsx` |
|---|---|---|
| 범위 | 열려 있는 **문서 하나** | **프로젝트 전체** (`code_search` 커맨드) |
| 결과 | 현재 편집면의 매치 하이라이트 | 파일별로 묶어 접었다 펴는 목록 |
| 치환 | 이 문서의 버퍼 | **디스크를 직접** 고친다 (미저장 파일은 건너뛴다) |
| 키 | ⌘F · ⌥⌘F | ⇧⌘F (트리 자리를 바꿔 앉는다) |

Monaco 위젯은 열린 문서 밖을 볼 수 없으므로 이 패널의 일을 못 한다. 반대로
**Monaco 위젯은 이관이 공짜로 준 것**이다 — CodeMirror 판 편집기에는
`@codemirror/search` 가 붙어 있지 않아 파일 안 찾기·바꾸기가 아예 없었다.
키도 안 부딪힌다(⌘F · ⌥⌘F vs ⇧⌘F).

→ 패널은 그대로 두고, 항목은 "대체 불가" 로 닫는다.

### JSON · TOML 문법을 직접 든다 {#d1a-done}

D1a 의 실행. `monaco/langExtra.ts` 가 `monaco.languages.register` +
`setMonarchTokensProvider` + `setLanguageConfiguration` 으로 둘을 등록한다.
`monaco_contributions.test.ts` 에 자물쇠 둘을 더했다:

- `codeLang.ts` 가 내놓는 언어 id 전부에 문법이 있는가 (Monaco 정의 임포트
  또는 `langExtra`). 없으면 그 확장자가 조용히 무채색으로 열린다.
- 우리가 직접 든 것이 **`json` · `toml` 뿐인가**, 그리고 그 둘이 정말 Monaco
  0.56 의 `languages/definitions/` 에 **없는가**. 언젠가 생기면 이 테스트가
  붉어지고, 그때 우리 문법을 지우면 된다.

### `.cm-*` CSS 는 지우는 것이 아니라 **옮기는** 것이다 {#css-port}

45개 규칙 중 상당수가 판단을 담고 있었다. 그냥 지우면 이관이 그 판단을 잃는다.

| 옛 규칙 | 담긴 판단 | 옮긴 곳 |
|---|---|---|
| `.cm-lintRange-*` | 물결선을 쓰지 않는다 — 13px 모노에서 글자와 뭉개진다 | `.squiggly-*` 에 `background-image: none` + 실선/파선/점선 |
| `.cm-lsp-hover` | 폭 480 · 높이 320 으로 묶는다 (rust-analyzer 문서가 화면을 가로지른다) | `.monaco-hover` |
| `.cm-lsp-signature-label strong` | 지금 치는 인자 강조가 이 기능의 전부다 | `.parameter-hints-widget .parameter.active` |
| `.cm-sticky` | 본문을 가리는 물건이라 **반드시 불투명** (유리 아님) | `.sticky-widget` |
| `.cm-deletedChunk` · `.cm-chunkButtons` | diff 화면과 **같은 색 토큰** | `.line-delete` · `.char-delete` · `.arrow-revert-change` |

호버·시그니처 위젯은 `fixedOverflowWidgets` 로 `body` 아래 뜨므로
`.code-editor-host` 로 좁힐 수 없다 — 이 앱에 다른 Monaco 가 없어서 전역으로 둔다.

## 함께 고친 것 — `.cm-editor` 잔재 하나 {#stale-selector}

`CodeScreenV2` 의 ⌘X/⌘V 가드가 `e.target.closest(".cm-editor, input, …")` 로
"지금 편집 중인가" 를 판별하고 있었다. 이관 뒤 그 클래스는 아무 데도 없어서
**편집기 안에서 ⌘V 가 붙여넣기가 아니라 파일 트리 붙여넣기로 갔다.** Phase 1 이
남긴 조용한 회귀다. `.monaco-editor` 로 고쳤다.

## 의존성

지운 패키지 13개: `@codemirror/lang-{css,go,html,javascript,json,python,rust,yaml}` ·
`legacy-modes` · `lint` · `merge` · `autocomplete` · `codemirror`(메타).

남은 7개(`state` · `view` · `commands` · `search` · `language` ·
`lang-markdown` · `@lezer/highlight`)는 전부 `DiscussionEditor.tsx` 하나가
쓴다. **Phase 4 가 그 파일을 옮기면 `@codemirror/*` 가 `package.json` 에서
사라진다** — 그 줄이 지워지는 것이 이 라운드의 완료 신호다.

## 게이트

`typecheck` · `test`(190파일 2,456개) · `lint` 6종 · `build` 전부 초록.
파일 크기 래칫이 `CodePane`(+4) · `CodeScreenV2`(+2)를 막아서, 늘린 만큼
같은 파일에서 낡은 주석(CodeMirror 시절의 "확장 재설정" 같은 것)을 줄여 갚았다.

`CodeScreenV2` 청크는 4,005.89 kB / gzip 1,042.77 kB. Phase 0 의 스파이크
숫자(3,864,710B / gzip 995,510)와는 **재는 대상이 달라** 그대로 비교하면
안 된다(스파이크는 편집기만, 이쪽은 코드 화면 전체다). 제대로 된 대조는
Phase 6 `{#fin-perf}` 가 `03-performance.md` 에 남긴다.
