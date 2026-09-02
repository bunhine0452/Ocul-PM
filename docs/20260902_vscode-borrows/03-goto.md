# B4 파일 내 심볼 이동(⇧⌘O) · 줄 이동(⌃G)

> [00-master-plan.md](00-master-plan.md) 의 Phase 3.
> 근거: `vscode/src/vs/editor/contrib/gotoSymbol` · `editor/contrib/quickAccess`

## 지금 상태

- **워크스페이스 심볼**은 이미 있다 — ⌘K 팔레트가 `lsp_workspace_symbols` 를 부른다
  (`CommandPalette.tsx:154`). 프로젝트 전역, 서버 색인 의존.
- **파일 내 구조**도 이미 있다 — `CodeOutline` 이 `lsp_document_symbols` 결과를 사이드바에
  평면 목록 + depth 로 그린다.
- 없는 것: 그 둘 사이의 **키보드 경로**. 지금 파일 안에서 함수 하나로 뛰려면 사이드바
  아웃라인을 마우스로 클릭해야 하고, 특정 줄로 가려면 스크롤해야 한다.

## 무엇

코드 화면 안에서만 사는 가벼운 quick-pick 하나. 두 모드가 한 입력창을 공유한다.

| 키 | 모드 | 입력 | 동작 |
|---|---|---|---|
| ⇧⌘O | 심볼 | 빈 문자열로 시작 | 지금 파일의 심볼을 fuzzy 로 좁혀 이동 |
| ⌃G | 줄 | `:` 로 시작 | `:123` → 123행, `:123:8` → 123행 8열 |

VS Code 와 같은 관례: 심볼 창에서 `:` 를 치면 줄 모드로 넘어간다(같은 위젯). `@` 로 시작하는
입력도 심볼 모드로 받는다(VS Code 의 `@` 접두 습관 그대로).

**⌘K 팔레트를 확장하지 않는 이유**: 팔레트는 창 전역이고 프로젝트 전체가 대상이다. 이건
"지금 이 파일"이 대상이라 목록이 이미 로컬에 있고(아웃라인), 서버 왕복도 없어야 한다.
둘을 한 위젯에 섞으면 팔레트가 화면 상태에 의존하기 시작한다.

## 설계

### 데이터

이미 `CodeScreenV2` 가 아웃라인용으로 `LspSymbol[]` 을 들고 있다(활성 파일 기준). 그 값을
그대로 쓴다 — **새 커맨드도, 새 상태도 없다.** 서버가 없는 파일(css·md)에서는 심볼 목록이
비므로, 그때는 줄 모드만 열린다(입력창에 `:` 를 미리 채워 연다).

### 순수 모듈 `src/features/code/gotoModel.ts`

```ts
export type GotoQuery =
  | { kind: "symbol"; needle: string }
  | { kind: "line"; line: number; character: number | null }
  | { kind: "empty" };

/** 입력 문자열 → 질의. `:12:3` · `@foo` · `foo` · `` 를 가른다. */
export function parseGoto(input: string): GotoQuery;

/** 심볼 fuzzy 매칭 — 부분 문자열 + 초성/카멜 약어(`hM` → handleMutate). 점수 내림차순. */
export function rankSymbols(symbols: LspSymbol[], needle: string): RankedSymbol[];

/** 줄 번호를 문서 범위로 접는다 (1..lineCount). */
export function clampLine(line: number, lineCount: number): number;
```

`homeMatch.ts`(시작 화면의 초성 매칭)에 이미 비슷한 랭커가 있다 — **거기서 점수 함수를
재사용**하고, 심볼 이름에 맞는 가중(정확 접두 > 카멜 약어 > 부분 문자열)만 얹는다.
새 매칭 알고리즘을 또 쓰지 않는다(DRY).

### UI

`src/features/code/CodeGoto.tsx` — `AppDialog` 를 쓰지 않는다. 코드 화면 상단에 붙는
얇은 오버레이(팔레트처럼 화면 중앙 상단, `.code-goto`)로, Esc·↑↓·⏎ 와 포커스 트랩은
`useModalBehavior` 를 그대로 쓴다(모달 규약 재사용).

- 목록: `아이콘 · 심볼 이름 · 상위 경로(depth 로 유추) · 줄 번호`
- 커서 이동 중 **미리 점프**한다 (VS Code 와 같다 — 선택이 바뀔 때마다 에디터가 그 줄로
  스크롤). Esc 로 닫으면 **원래 줄로 되돌린다.** 이게 이 위젯의 가치의 절반이다.
- 되돌리기용으로 열 때의 커서(`cursorRef.current`)를 기억해 둔다.

### 배선

- 키: `CodeScreenV2` 의 기존 keydown 핸들러(가시성 앵커 `isVisible()` 이 이미 있다)에
  ⇧⌘O / ⌃G 추가. macOS 에서 ⌃G 는 CM6 기본 키맵과 겹치지 않는다(⌃G 는 emacs 스타일
  키맵을 안 쓰면 비어 있다) — `basicSetup` 키맵 확인 후, 겹치면 CM 키맵보다 먼저 잡는다.
- 점프: 기존 `openPath(path, line)` 이 아니라 같은 파일이므로 `setJump({ line, ch, nonce })`
  경로를 그대로 쓴다(이미 `CodePane` → `CodeEditor` 의 `jump` prop 이 있다).
- 치트시트: `src/lib/shortcutRegistry.ts` 의 `CODE` 그룹에 2줄 추가
  (`polish_phase2.test.tsx` 가 중복 조합을 검사하므로 거기서 자동 검증된다).

## 파일별 변경

| 파일 | 변경 |
|---|---|
| `src/features/code/gotoModel.ts` | 신규 — 순수 |
| `src/features/code/CodeGoto.tsx` | 신규 — 오버레이 |
| `src/features/code/CodeScreenV2.tsx` | 키 2개 · 상태 · 심볼 목록 전달 · 점프/되돌리기 |
| `src/features/code/code.css` | `.code-goto*` |
| `src/lib/shortcutRegistry.ts` | 2줄 |
| `src/i18n/*` | 라벨·플레이스홀더·빈 상태 |
| `src/__tests__/code_goto.test.tsx` | 신규 |

## 테스트

**순수** — `parseGoto`: `""`/`"foo"`/`"@foo"`/`":12"`/`":12:3"`/`":0"`/`":abc"`(줄 아님 → 심볼).
`rankSymbols`: 정확 접두 우선 · 카멜 약어(`hM`) · 대소문자 무시 · 빈 needle 은 원래 순서 유지.
`clampLine`: 0·음수·초과.

**컴포넌트** — 열면 지금 파일 심볼이 뜬다 · 타자로 좁혀진다 · ↑↓ 로 이동할 때마다 점프가
발화한다 · Esc 면 **원래 줄로 되돌아간다** · ⏎ 면 그 자리에 남는다 · 심볼이 없는 파일에서는
줄 모드로 열린다 · a11y(`vitest-axe`).
