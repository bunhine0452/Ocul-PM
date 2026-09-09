---
schema_version: 1
type: refactor
slug: "monaco-reclaim-phase2"
status: done
difficulty: high
created_at: "2026-09-09T19:15:27+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "64d2ae17-87d9-425b-b5db-3a9d7e3670d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/monaco/symbols.ts"
    op: create
  - path: "src/features/code/monaco/langExtra.ts"
    op: create
  - path: "src/features/code/stickyScroll.ts"
    op: delete
  - path: "src/features/code/stickyModel.ts"
    op: delete
  - path: "src/features/code/signatureTooltip.ts"
    op: delete
  - path: "src/features/code/gitGutter.ts"
    op: delete
  - path: "src/features/code/breakpointGutter.ts"
    op: delete
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/codeLang.ts"
    op: update
  - path: "src/features/code/lspBridge.ts"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/features/code/monaco/setup.ts"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/features/settings/CodeSettings.tsx"
    op: update
  - path: "src/__tests__/monaco_lsp.test.ts"
    op: create
  - path: "src/__tests__/code_sticky.test.ts"
    op: update
  - path: "src/__tests__/monaco_contributions.test.ts"
    op: update
  - path: "docs/20260908_monaco-editor/02-reclaim.md"
    op: create
  - path: "package.json"
    op: update
related:
  - ref: "20260908/Refactors/2014_refactor_monaco-port-phase1.md"
    kind: "followup"
tags:
  - "monaco"
  - "editor"
  - "codemirror"
  - "sticky-scroll"
  - "monarch"
  - "mcp-tool"
---
[x] Monaco 이관 Phase 2 — 손으로 만든 것을 내장으로 갈아치우고 지운다

## 동기

Phase 1 은 **계약을 지키며 갈아끼우는** 단계라 옛 파일을 지우지 않았다. 이 단계가
그 뒷정리다 — 마스터 플랜이 "이관은 순증이 아니라 순감이다" 라고 적어 둔 것을
숫자로 만든다.

SSOT: `docs/20260908_monaco-editor/02-reclaim.md`

## 변경 요약

**지웠다 (738줄 + `.cm-*` CSS 45규칙)**

| 파일 | 줄 | 대체 |
|---|---:|---|
| `stickyScroll.ts` | 229 | Monaco `stickyScroll` 옵션 |
| `stickyModel.ts` | 152 | 위 + 새 `monaco/symbols.ts`(123) |
| `signatureTooltip.ts` | 172 | 내장 `parameterHints` 위젯 |
| `gitGutter.ts` | 86 | `monaco/decorations.ts` (Phase 1) |
| `breakpointGutter.ts` | 99 | `monaco/decorations.ts` (Phase 1) |
| `codeLang.ts` 언어 확장부 | 27 | Monarch 언어 id |
| `lspBridge.ts` CM 변환부 | 67 | `monaco/lsp.ts` (Phase 1) |

뒤의 셋은 플랜 항목에 없었다. Phase 1 이 **대체해 놓고 안 지운 잔재**라 아무도 안
부르면서 `@codemirror/*` 임포트를 붙들고 있었고, 그대로 두면 Phase 4 의 의존성
제거가 그 자리에서 막힌다.

**새로 썼다**

- `monaco/symbols.ts`(123) — LSP 심볼 → Monaco 아웃라인 (스티키의 원천).
- `monaco/langExtra.ts`(165) — 0.56 에 없는 JSON · TOML Monarch 문법 (D1a).
  그냥 두면 두 언어가 무채색으로 열려 회귀다.

**의존성 13개 제거** — `@codemirror/lang-*` 8개 · `legacy-modes` · `lint` ·
`merge` · `autocomplete` · `codemirror`(메타). 남은 7개는 전부
`DiscussionEditor.tsx` 하나가 쓴다.

## 판단 셋

**스티키를 `outlineModel` 로 올렸다.** Phase 1 은 `indentationModel` 이었다 —
`DocumentSymbolProvider` 가 없으면 `outlineModel` 이 0줄을 그리기 때문이다. 이번에
그 공급자를 달았고, 그 값은 **사슬**이라(`stickyScrollModelProvider.js` 의
fall-through) 심볼이 없으면 폴딩 → 들여쓰기로 스스로 떨어진다. 백엔드가 시작 줄만
주므로 `toDocumentSymbols` 가 끝 줄(다음 형제의 시작 앞)과 중첩(`depth` 로 부모
되찾기)을 지어낸다. 앞엣것은 `stickyFromSymbols` 가 쓰던 것과 **같은 추정**이고
대가도 같다. 뒤엣것을 빼먹으면 사슬이 아니라 가장 안쪽 한 줄만 그린다 — 첫 구현이
깊이 건너뜀(0 → 2)을 놓쳐 새 테스트가 잡았다.

**`CodeSearchPanel` 은 대체 불가라 남긴다** (`{#reclaim-search}` 판정). Monaco
위젯은 **문서 하나**가 대상이고, 이 패널은 **프로젝트 전역**(`code_search`)에
디스크 직접 치환 + 미저장 파일 건너뛰기다. 반대로 파일 안 찾기·바꾸기(⌘F·⌥⌘F)는
이관이 공짜로 준 것이다 — CodeMirror 판 편집기에는 `@codemirror/search` 가 아예
안 붙어 있었다. 키도 안 부딪힌다(⇧⌘F 는 패널).

**`.cm-*` CSS 는 지우는 게 아니라 옮기는 것이다.** 45개 중 상당수가 판단을 담고
있었다: 물결선 대신 실선 밑줄(13px 모노에서 물결이 글자와 뭉개진다) → `.squiggly-*`,
호버 폭 480/높이 320 → `.monaco-hover`, "지금 치는 인자 강조가 이 기능의 전부" →
`.parameter-hints-widget .parameter.active`, "본문을 가리는 물건이라 반드시 불투명" →
`.sticky-widget`, 인라인 diff 색 토큰 → `.line-delete`·`.char-delete`·
`.arrow-revert-change`.

## 함께 고친 회귀 하나

`CodeScreenV2` 의 ⌘X/⌘V 가드가 `e.target.closest(".cm-editor, input, …")` 로
"지금 편집 중인가" 를 보고 있었다. 이관 뒤 그 클래스는 아무 데도 없어서 **편집기
안에서 ⌘V 가 붙여넣기가 아니라 파일 트리 붙여넣기로 갔다.** Phase 1 이 남긴 조용한
회귀다. `.monaco-editor` 로 고쳤다.

## 계약 한 줄

`CodeEditorProps` 에 `onGoToSymbol` 이 늘었다. 심볼 공급자를 다는 순간 Monaco 내장
`quickOutline`(⇧⌘O)이 켜진다 — 그 액션의 `precondition` 이
`hasDocumentSymbolProvider` 라 공급자가 없을 때는 키가 안 걸려 있었다. 그대로 두면
"스티키를 켜면 ⇧⌘O 가 다른 창을 연다" 는 들쭉날쭉함이 생기므로, 같은 키에 우리
액션을 얹어(동적 키바인딩 weight 1000 > 기여 액션 100) 부모의 `CodeGoto` 로
되돌린다. D2("계약을 한 줄도 안 바꾼다")는 Phase 1 의 회귀 범위를 좁히는 장치였고
그 목적은 이미 달성됐다(테스트 2,451개 무수정 통과).

## 검증

- `pnpm typecheck` · `pnpm test`(190파일 2,455개) · `pnpm lint` 6종 ·
  `pnpm build` 전부 exit 0 직접 확인.
- 새 자물쇠 3종: `monaco_lsp.test.ts`(진단·완성 변환 — CM 판 테스트를 이어받음),
  `code_sticky.test.ts` 재작성(심볼 중첩·지어낸 범위), `monaco_contributions.test.ts`
  에 "언어 id 전부에 문법이 있는가" + "직접 든 것은 json·toml 뿐이고 그 둘이 정말
  0.56 에 없는가".
- 파일 크기 래칫이 `CodePane`(+4)·`CodeScreenV2`(+2)를 막아, 늘린 만큼 같은 파일의
  CodeMirror 시절 낡은 주석을 줄여 갚았다.
- **미확인**: 실제 화면의 스티키 렌더·JSON/TOML 강조·인라인 diff 색은 육안 확인
  전이다. Phase 6 `{#fin-eyes}` 격자에서 본다.