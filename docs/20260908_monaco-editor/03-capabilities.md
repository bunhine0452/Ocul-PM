# Phase 3 — 새 능력: 지금 아예 없던 기본기

> 플랜: [`monaco-editor-round`](../../.oculpm/planner/monaco-editor-round.md) `{#capabilities}`
> 앞선 단계: [`02-reclaim.md`](02-reclaim.md).
>
> ⚠️ 번호 안내 — 플랜의 `{#fin-perf}` 는 성능 문서를 `03-performance.md` 라고
> 부른다. 3·4번을 Phase 3·4 문서가 가져갔으므로 성능은 **`05-performance.md`** 로 간다.

Phase 0 이 CodeMirror 판에서 실측한 값이다.

```
foldGutter / codeFolding      0        multipleSelections   0
bracketMatching               0        closeBrackets        0
indentOnInput                 0        highlightSelectionMatches 0
```

지붕(LSP 17커맨드 · DAP 디버거)은 올렸는데 바닥이 비어 있던 자리다. Monaco 는
이것들을 **옵션 몇 줄**로 준다 — 그래서 이 Phase 의 진짜 위험은 "못 켜는 것"이
아니라 **"켠 줄이 조용히 지워지는 것"** 이다.

## 옵션을 값으로 만들었다 {#options-as-value}

`monaco/options.ts` 의 `baseEditorOptions()` · `diffEditorOptions()`.
`CodeEditor.tsx` 안의 인라인 객체를 순수 함수로 떼어 `monaco_options.test.ts`
가 문다. 누가 리팩터링하다 `folding: true` 한 줄을 지우면 테스트가 붉어진다 —
CodeMirror 판에는 그 자물쇠가 없어서 위 표가 전부 0인 채로 오래 갔다.

## 켠 것

| 능력 | 옵션 | 비고 |
|---|---|---|
| 코드 폴딩 | `folding` · `foldingHighlight` | 접힌 범위를 강조 |
| 괄호 매칭 | `matchBrackets: "always"` | 커서가 괄호 밖이어도 감싸는 쌍을 표시 |
| 자동 괄호·따옴표 닫기 | `autoClosingBrackets` · `autoClosingQuotes` | 언어 설정이 정한다 |
| 선택 감싸기 | `autoSurround` | 선택해 두고 `(` 를 치면 감싼다(덮어쓰지 않는다) |
| 입력 시 들여쓰기 | `autoIndent: "full"` | `advanced` 는 onEnter 규칙만 본다 — `}` 를 쳤을 때 도로 나오는 것은 `indentationRules` 라 `full` 이어야 채워진다 |
| 선택 일치 강조 | `selectionHighlight` · `occurrencesHighlight: "singleFile"` | |
| 다중 커서 | `multiCursorModifier: "alt"` | ⌥클릭 · ⌘D(다음 일치 추가는 `multicursor` 기여가 준다) |
| 열(블록) 선택 | 위와 같은 값 | ⌥⇧드래그 — 같은 수식키에 ⇧ 가 붙은 것이라 자동으로 따라온다 |
| 브래킷 쌍 색칠 | `bracketPairColorization` | |
| 들여쓰기 가이드 | `guides.indentation` | 활성 줄 강조 포함 |
| 미니맵 | `minimap` | **설정으로 끄고 켠다** (아래) |

`⌘D` 는 앱에 쓰는 자리가 없어 안 부딪힌다(확인함). `⌘F`(찾기) · `⌥⌘F`(바꾸기)도
프로젝트 전역 검색의 `⇧⌘F` 와 겹치지 않는다.

## 결정

### 미니맵만 설정을 둔다 {#minimap-setting}

플랜의 질문("설정에 켜기/끄기를 둘지 판단")에 대한 답이다. **폭을 먹는 것만
끌 수 있게 한다.**

- **미니맵 → 설정 `codeMinimap`(기본 켬).** 이 화면은 좌우로 분할되고, 그때
  미니맵이 먹는 60~100px 이 본문에서 나온다. 끄고 싶을 이유가 실재한다.
- **브래킷 쌍 색칠 · 들여쓰기 가이드 → 설정 없음.** 자리를 안 먹고, 끌 이유를
  댈 수 없다. 아무도 안 바꿀 토글은 설정 화면의 소음이다.

### 들여쓰기는 설정이 정한다 — 추정하지 않는다 {#no-detect-indentation}

`detectIndentation: false`. Monaco 기본값은 `true` 라 **파일 내용에서 추정해
`tabSize`·`insertSpaces` 를 덮는다.**

이 앱에서 그러면 안 되는 이유가 있다: 사용자가 고른 `codeTabSize` ·
`codeInsertSpaces` 가 **저장 시 포맷**(`lsp_format` 의 옵션)으로 그대로 간다.
추정을 켜 두면 4로 그려 놓고 저장할 때 2로 다시 들여써서 파일 전체가 diff 로
물든다. 화면과 저장이 같은 값을 보게 한다.

그래서 `insertSpaces` 가 `CodeEditor` 의 새 prop 으로 늘었다(`tabSize` 옆).
둘 다 설정이 바뀌면 `updateOptions` 로 열려 있는 편집기에 바로 먹는다 —
재마운트하지 않는 이유는 다른 것들과 같다(실행 취소 이력·접힘 상태가 날아간다).

### peek definition/references 는 만들지 않는다 — 패널을 남긴다 {#peek-verdict}

플랜 `{#cap-peek}` 의 판정. **표준 Monaco 로는 파일 밖을 못 본다.**

`standaloneServices.js` 의 `StandaloneTextModelService.createModelReference()` 는
이렇게 생겼다.

```js
createModelReference(resource) {
    const model = this.modelService.getModel(resource);
    if (!model) { return Promise.reject(new Error(`Model not found`)); }
    ...
}
```

peek 위젯은 대상 파일의 `ITextModel` 이 **이미 만들어져 있어야** 연다. 즉
프로젝트의 모든 파일에 대해 모델을 미리 만들어 두거나 그 서비스를 통째로
갈아끼워야 하는데, 앞은 메모리를 파일 수만큼 먹고 뒤는 표준 API 의 밖이다.

결과적으로 얻는 것은 **같은 파일 안에서만 되는 peek** 이고, 그건 지금 있는
것(F12 이동 + ⇧F12 전체 폭 참조 패널)보다 나쁘다 — 반만 되는 이동은 안 되는
이동보다 나쁘다. 정의·참조 공급자를 아예 등록하지 않는 이유도 같다(⌘클릭 링크가
같은 문제를 안고 켜진다).

**되살릴 조건**: Phase 5 의 ⌘K 인라인 편집이 어차피 "프로젝트 파일의 모델
레지스트리" 를 요구하게 되면, 그때 이 항목을 다시 연다.

### 시맨틱 토큰은 **막혔다** — 닫지 않는다 {#semantic-blocked}

플랜 `{#cap-semantic}` 은 "백엔드에 없으면 추가하고, 없으면 Monarch 로 만족하고
닫는다" 는 두 갈래를 줬다. 확인한 사실:

- 백엔드에 `semanticTokens` 는 **없다** (`commands/lsp.rs` 의 17개 커맨드 어디에도).
  `initialize_params` 의 클라이언트 capability 에도 없다.
- 추가 자체는 어렵지 않다 — legend 협상 + 델타 인코딩된 `u32` 배열 해독 +
  Monaco `DocumentSemanticTokensProvider` + 테마 규칙.

**그런데 지금은 할 수 없다.** 백엔드 커맨드를 더하면 `cargo test` 가
`src/lib/bindings.ts` 를 다시 만드는데, 2026-09-09 현재 **병렬 세션이 그 파일에
미커밋 변경을 들고 있다**(`FiringOverview.sessions_considered` ·
`RuleEntry.readonly`). 재생성하면 남의 진행 중 API 가 내 커밋에 섞이고, 안 섞으면
내 커맨드의 바인딩이 빠져 남의 체크아웃에서 타입이 깨진다. 둘 다 틀렸다.

→ 항목을 **`blocked`** 로 둔다. 해제 조건은 하나: **병렬 세션의 firing-ledger /
rules 작업이 머지되어 `bindings.ts` 가 깨끗해질 것.** 그 뒤에 이 항목만 다시 연다.
(`done` 으로 닫지 않는 이유는 그러면 플랜에서 사라지기 때문이다 — 이월은 살아
있는 플랜의 항목으로 남긴다.)

## 게이트

`typecheck` · `pnpm test`(내 스위트 전부 초록 · 새 자물쇠 16개) · `lint` 6종 ·
`build`. **주의**: `agent_context_model.test.ts` 하나가 붉은데 그것은 병렬
세션의 `contextModel.ts` 진행 중 변경이다(`surface.always_on is not iterable`) —
이 라운드와 무관하다. 파일 크기 래칫도 같은 이유로 `firing_ledger.rs` ·
`rules.rs` 를 계속 잡는다.
