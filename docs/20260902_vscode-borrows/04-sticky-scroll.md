# B7 스티키 스크롤

> [00-master-plan.md](00-master-plan.md) 의 Phase 4.
> 근거: `vscode/src/vs/editor/contrib/stickyScroll` · `editor/common/config/editorOptions.ts:3155`
> (기본값 `{ enabled: true, maxLineCount: 5, defaultModel: 'outlineModel', scrollWithEditor: true }`)

## 무엇

에디터 상단에 지금 커서(정확히는 **뷰포트 첫 줄**)를 감싸는 상위 스코프의 시작 줄들을
겹쳐 고정한다. 1,000줄짜리 파일 중간에서 "여기가 무슨 클래스의 무슨 메서드인가" 를
스크롤해 올라가 확인하지 않게 된다. 줄을 클릭하면 그 줄로 이동한다.

## 모델 — 우리는 2단 폴백만 쓴다

VS Code 는 3단이다: `outlineModel`(LSP 문서 심볼) → `foldingProviderModel` → `indentationModel`.

우리도 **① LSP 문서 심볼**을 1순위로 쓴다 (이미 있다 — `lsp_document_symbols`, 아웃라인이
쓰는 그 값). 서버가 없는 파일(css·md·json 등)은 **② 들여쓰기 모델**로 떨어진다: CodeMirror 의
`foldable`/`indentUnit` 을 쓰지 않고, 순수 함수로 "이 줄보다 들여쓰기가 얕으면서 위에 있는
가장 가까운 비어 있지 않은 줄" 을 재귀로 모은다. 폴딩 제공자 모델은 건너뛴다 — CM6 의
폴딩은 언어 확장마다 제각각이라 심볼과 들여쓰기 사이에서 값이 겹친다.

## 설계

### 순수 모듈 `src/features/code/stickyModel.ts`

```ts
export interface StickyLine { line: number; text: string; }

/** LSP 심볼 기반. `line`(0-based 뷰포트 첫 줄)을 감싸는 심볼들의 시작 줄, 바깥→안쪽. */
export function stickyFromSymbols(symbols: LspSymbol[], line: number, max: number): number[];

/** 들여쓰기 기반 폴백. `lines` 는 문서 줄 배열, 탭은 tabSize 로 환산. */
export function stickyFromIndent(lines: string[], line: number, max: number, tabSize: number): number[];
```

규칙:
- 결과는 **바깥에서 안쪽 순서**(클래스 → 메서드), 최대 `max` 줄(기본 5).
- 뷰포트 첫 줄 자신이 심볼 시작 줄이면 포함하지 않는다(중복해 보인다).
- 빈 줄·주석만 있는 줄은 들여쓰기 폴백에서 앵커가 되지 않는다.

### CM6 확장 `src/features/code/stickyScroll.ts`

`ViewPlugin` 하나 + `StateEffect` 하나.

```
setStickySource: StateEffect<{ symbols: LspSymbol[] | null; tabSize: number }>
stickyScroll(maxLines): Extension
  · update: 뷰포트 첫 줄이 바뀌면(또는 소스 갱신) 모델을 다시 계산
  · 그림: 에디터 위에 절대 배치한 DOM 패널(.cm-sticky) — 줄 단위 <button>
  · 클릭: view.dispatch(scrollIntoView) 로 그 줄로 이동
  · 가로 스크롤 동기화(scrollWithEditor 와 같은 값): scrollDOM 의 scrollLeft 를 따라간다
```

**하이라이팅은 하지 않는다.** VS Code 는 sticky 줄도 토큰 색을 입히지만, CM6 에서 그러려면
그 줄만 다시 파싱해 렌더해야 한다. 1차는 단색 텍스트 + 아이콘(심볼 종류)로 간다 — 값의
90%는 "어느 함수 안인가" 이고 색은 거기에 기여하지 않는다.

### 배선

- `CodeEditor.tsx`: 확장 배열에 `stickyScroll(maxLines)` 추가(설정이 꺼져 있으면 아예 안 단다
  — 이 파일의 다른 확장들과 같은 규약: prop 유무로 판단). `symbols` 는 prop 으로 받아
  `setStickySource` effect 로 밀어 넣는다(재마운트 없이).
- `CodePane.tsx` → `CodeEditor` 로 `stickySymbols` 를 내려보낸다. 아웃라인이 이미 이
  값을 갖고 있으므로 `CodeScreenV2` → `CodePane` → `CodeEditor` 로 한 칸 더 내리면 된다.
  (같은 파일을 두 창에 열면 각자 자기 값을 그린다 — LSP 는 왼쪽 창만 붙지만 심볼 목록은
  화면 상태라 공유해도 무해하다.)

### 설정

| 설정 | 기본 | 비고 |
|---|---|---|
| `codeStickyScroll` | `false` | D1 — 켜야 바뀐다. VS Code 기본은 켜짐이지만 우리 패인은 분할·미리보기로 이미 좁다 |
| `codeStickyMaxLines` | `5` | VS Code 와 같은 기본, 1–10 |

## 실패 모드

- **좁은 패인**: 분할 + svg 미리보기면 에디터 폭이 400px 아래로 간다. sticky 줄이 잘리면
  가치보다 소음이므로, 패인 폭 320px 미만이면 자동으로 그리지 않는다(CSS 가 아니라
  플러그인에서 판단 — `view.dom.clientWidth`).
- **심볼이 늦게 온다**: 서버 기동 중에는 목록이 비어 폴백(들여쓰기)이 그린다. 심볼이
  도착하면 effect 로 갈아탄다 — 깜빡임은 한 번이고, 그게 "서버가 붙었다" 는 신호이기도 하다.
- **접힌 코드**: 폴딩과 겹치면 VS Code 도 sticky 를 그린다. 그대로 둔다.

## 파일별 변경

| 파일 | 변경 |
|---|---|
| `src/features/code/stickyModel.ts` | 신규 — 순수 |
| `src/features/code/stickyScroll.ts` | 신규 — CM6 확장 |
| `src/features/code/CodeEditor.tsx` | 확장 등록 + effect 배선 |
| `src/features/code/CodePane.tsx` · `CodeScreenV2.tsx` | 심볼 전달 |
| `src/features/code/code.css` | `.cm-sticky*` |
| `src/lib/settings.ts` · `CodeSettings.tsx` · `src/i18n/*` | 설정 2 |
| `src/__tests__/code_sticky.test.ts` | 신규 — 순수 함수만 |

## 테스트

jsdom 에는 레이아웃이 없어 CM6 뷰포트를 흉내낼 수 없다 → **순수 함수만** 테스트한다
(`stickyScroll.ts` 는 얇게 유지해서 이 경계가 성립하게 만든다).

- `stickyFromSymbols`: 중첩 심볼(클래스>메서드>클로저) 바깥→안쪽 · `max` 절단은 **안쪽을
  버린다**(바깥 맥락이 더 중요) · 뷰포트 첫 줄 = 심볼 시작이면 제외 · 심볼 밖이면 빈 배열.
- `stickyFromIndent`: 탭/공백 혼용 · 빈 줄 건너뛰기 · 같은 들여쓰기의 형제는 앵커 아님 ·
  파일 첫 줄.
