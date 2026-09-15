---
schema_version: 1
type: refactor
slug: "split-codescreen"
status: done
difficulty: medium
created_at: "2026-09-15T23:02:29+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/codeScreen/useCodeTree.ts"
    op: create
  - path: "src/features/code/codeScreen/CodeSidebar.tsx"
    op: create
  - path: "src/features/code/codeScreen/useTreeInteraction.ts"
    op: create
  - path: "src/features/code/codeScreen/useCodeTabs.ts"
    op: create
  - path: "src/features/code/codeScreen/useCodeScreenKeys.ts"
    op: create
  - path: "src/features/code/codeScreen/DebugLaunchDialog.tsx"
    op: create
  - path: "src/features/code/codeScreen/useClosedTabs.ts"
    op: create
  - path: "src/features/code/codeScreen/DeleteConfirmDialog.tsx"
    op: create
  - path: "src/features/code/codeScreen/usePanelResize.ts"
    op: create
  - path: "src/features/code/codeScreen/useProblemsFeed.ts"
    op: create
  - path: "src/features/code/codeScreen/useDocumentSymbols.ts"
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
[x] CodeScreenV2.tsx 1,471 → 780줄 — codeScreen/ 훅 8·하위 컴포넌트 3, lazy 경로·효과 순서 불변

## 동기

최적화 원장 §2.3 `{#file-size-debt}` 상위 7 중 `CodeScreenV2.tsx`(1,471줄, 코드 화면 셸). 병렬 세션 CS 가 worktree 에서 구현, 커밋 `1e52c026`.

## 변경 요약

`CodeScreenV2.tsx` **780줄**(상태 배선·툴바·페인·하단 패널·오버레이) + `codeScreen/` 11파일: `useCodeTree` 227(dirCache·필터·expanded·loadDir/refresh·prune/ancestor 효과) · `CodeSidebar` 198(`<aside>` 순수 뷰) · `useTreeInteraction` 158 · `useCodeTabs` 145(탭 상태 + persist 효과·dirty·jump·paneRefs) · `useCodeScreenKeys` 145(창 keydown ⌃Tab·⇧⌘]·⇧⌘T·⇧⌘F·⌘P·⌘B·⌥Z·⌃G·⇧⌘O·⌘X/V/N) · `DebugLaunchDialog` 131 · `useClosedTabs` 90(⌘W 핸들러 등록) · `DeleteConfirmDialog` 86 · `usePanelResize` 64 · `useProblemsFeed` 42 · `useDocumentSymbols` 40.

- prop API·export·`ShellV2`/`screens.ts` lazy import 불변, DOM/CSS/i18n 불변(`CodeSidebar` 는 동일 `<aside>` 서브트리).
- 효과 순서 전역 보존(persist → symbols → problems → loadTree/prune/ancestors → openTarget → closeHandler → useTreeWatch → useFileOps → useCodeImport → keys → useTreeDrag). 소유자가 바뀐 상태는 항상 마운트되는 다이얼로그로 들어간 `starting` 하나(수명 동일).
- 원문 비주석 줄 전부가 새 파일에 그대로 있음을 스크립트로 확인 — 예외 50줄은 import·경계 prop 배선·deps 배열.
- deps 배열에 안정 식별자(`setTabs`·`tabsRef`·`setExpanded`… useState setter/useRef)를 추가 — exhaustive-deps 가 훅 인자로 온 것을 안정으로 못 보고 `--max-warnings=4` 가 꽉 차 있어서. 재실행 타이밍 불변, 각 배열에 한 줄 메모.
- `check-bindings-imports.mjs`: `CodeScreenV2.tsx` 는 allowlist 에서 빠지고(더는 commands/events 를 직접 안 부름) 직접 호출을 물려받은 훅 4개가 `{#split-codescreen}` 사유로 들어감.

## 검증

- `pnpm typecheck` 0 · `pnpm lint` 7게이트 0(eslint 4 = 예산).
- `CodeScreenV2` 참조 5파일 84/84 · `code_*`+design/file_size 35파일 **517/517** 통과.
- 미검증: 설치본 코드 화면 육안(#eyes-split-regression).