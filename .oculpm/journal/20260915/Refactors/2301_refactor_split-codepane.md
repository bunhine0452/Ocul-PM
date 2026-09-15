---
schema_version: 1
type: refactor
slug: "split-codepane"
status: done
difficulty: medium
created_at: "2026-09-15T23:01:08+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/codePane/useSaveFlow.ts"
    op: create
  - path: "src/features/code/codePane/useDiffModes.ts"
    op: create
  - path: "src/features/code/codePane/useLspActions.ts"
    op: create
  - path: "src/features/code/codePane/useBufferEdits.ts"
    op: create
  - path: "src/features/code/codePane/useExternalChanges.ts"
    op: create
  - path: "src/features/code/codePane/useGitGutter.ts"
    op: create
  - path: "src/features/code/codePane/lspLabel.ts"
    op: create
  - path: "src/features/code/codePane/types.ts"
    op: create
  - path: "src/features/code/codePane/LspDialogs.tsx"
    op: create
  - path: "src/features/code/codePane/CrumbActions.tsx"
    op: create
  - path: "src/features/code/codePane/PaneBanners.tsx"
    op: create
  - path: "src/features/code/codePane/JournalEntriesPop.tsx"
    op: create
  - path: "src/features/code/codePane/CodeEmptyState.tsx"
    op: create
  - path: "src/features/code/codePane/UnopenableHint.tsx"
    op: create
  - path: "scripts/check-bindings-imports.mjs"
    op: update
related: []
tags:
  - "refactor"
  - "file-size-debt"
  - "code"
  - "optimization-round-2"
  - "parallel-session"
  - "mcp-tool"
---
[x] CodePane.tsx 1,555 → 798줄 — codePane/ 훅 6·하위 컴포넌트 6, 효과 순서 보존, lint:bindings allowlist +5

## 동기

최적화 원장 §2.3 `{#file-size-debt}` 상위 7 중 `CodePane.tsx`(1,555줄, 편집기 페인). 병렬 세션 CP 가 worktree 에서 구현, 커밋 `deeef3a0`.

## 변경 요약

`CodePane.tsx` **798줄**(공유 페인 상태·`loadFile`·조립) + `codePane/` 15파일: 훅 `useSaveFlow` 254(저장 위생·⌘S·flushPath·자동저장·충돌 해소) · `useDiffModes` 204(HEAD/일지/로컬 히스토리 인라인 diff) · `useLspActions` 197(F12·F2·⌘.·⇧F12 + 다이얼로그 상태) · `useBufferEdits` 147 · `useExternalChanges` 104(워처 리로드/충돌/사라짐) · `useGitGutter` 43; 헬퍼 `lspLabel` 23 · `types` 28; 컴포넌트 `LspDialogs` 120 · `CrumbActions` 110 · `PaneBanners` 75 · `JournalEntriesPop` 53 · `CodeEmptyState` 38(**CodePane 에서 재수출**해 CodeScreenV2 import 불변) · `UnopenableHint` 30.

- 공개 표면(`CodePane`·`CodePaneHandle`·`CodePaneProps`·`CodeEmptyState` export, props·상태·DOM·CSS·i18n) 불변.
- 효과 순서 정확히 보존(gutter cleanup → load → svg text → svg timer → jump → ⌘S → autoSave → watcher). 호출 순서가 바뀐 훅은 `useImperativeHandle` 뿐(layout 단계라 passive 효과와 무관). 줄 단위 감사: import·타입 별칭 3·deps 배열·lspLabel 헬퍼·prop 이 된 JSX 표현식 외엔 원문 그대로.
- svg 미리보기 상태/효과(~35줄)는 남김 — 빼면 useEffect 둘이 load 효과 앞으로 밀린다(무관찰이지만 규칙 위반). 다음 절단면은 `useSvgPreview`.
- **`lint:bindings` allowlist +5**(`useGitGutter`·`useDiffModes`·`useLspActions`·`useSaveFlow`·`useExternalChanges`): CodePane 이 이미 하던 `commands.*`/`events.*` 직접 호출을 그대로 들고 나간 것. `@/api/*` `call` 래퍼로 바꾸면 오류 경로 의미(봉투→throw)가 바뀌어 순수 이동이 아님 — 게이트 문구가 사유 첨부 추가를 허용하고 `{#planner-diff-split}`·`{#acp-split}` 선례와 같음. 파사드 경유는 improvement-round `#api-facades` 후속.

## 검증

- `pnpm typecheck` 0 · `pnpm lint` 7게이트 0(eslint 경고 4 = 상한, 파일 크기 clean).
- CodePane 참조 8파일 142/142, `code_*` 31파일 **411/411** 통과(기준선과 동일).
- 미검증: 설치본 편집·포매터·LSP 육안(#eyes-split-regression). `CodePane.tsx` 798 은 래칫 2줄 여유 — 다음에 `useSvgPreview` 로.