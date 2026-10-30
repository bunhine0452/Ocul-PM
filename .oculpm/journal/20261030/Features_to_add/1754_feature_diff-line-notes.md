---
schema_version: 1
type: feature
slug: "diff-line-notes"
status: done
difficulty: medium
created_at: "2026-10-30T17:54:02+09:00"
session_id: "20261030-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/diff/diffNoteStore.ts"
    op: create
  - path: "src/features/diff/DiffNotes.tsx"
    op: create
  - path: "src/features/diff/PatchView.tsx"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/terminal/sendToClaude.ts"
    op: update
  - path: "src/features/terminal/SendToClaudeHost.tsx"
    op: update
  - path: "src/__tests__/diff_notes.test.tsx"
    op: create
related: []
tags:
  - "변경"
  - "orca-bench"
  - "send-to-claude"
  - "mcp-tool"
---
[x] 변경: 줄 메모를 묶어 Claude 에게 보낸다

## 추가 기능

사용자 결정(10-30): Orca 의 「Annotate AI Diffs」를 가져온다(계획 `orca-bench-20261030` #diff-notes). 변경 화면의 줄마다 메모를 달고, 한 번에 묶어 Claude 세션에 보낸다. Orca 문서가 든 이유를 그대로 따랐다: 하나씩 보내면 에이전트가 오락가락하고, 묶어야 한 번에 고친다.

## 동작 흐름

- **달기:** diff 줄에 올리면 거터에 「+」가 뜬다(`NoteAddButton`). 누르면 줄 아래 편집기가 열린다. ⌘↩ 로 남기고 Esc 로 취소한다.
- **표시:** 메모가 있는 줄은 「+」 대신 점이다. 「+674」로 읽히던 것을 하네스에서 고쳤다. 카드를 누르면 고치고, × 로 지운다.
- **저장:** `diffNoteStore.ts` 는 창 안의 모듈 저장소이고 프로젝트별이다. 한 줄에 메모 하나다.
  - `DiffNotes.tsx` 와 이름이 대소문자만 달라 macOS 에서 충돌했다. 그래서 이 이름이 됐다.
- **읽기:** `PatchView` 는 `notes` prop 이 있을 때만 메모를 그린다. 변경 화면만 주고, 일지 상세는 읽기만 한다. 줄마다 구독하지 않고 한 번 읽어 내려 준다.
- **보내기:**
  1. 툴바에 「메모 N개 → Claude」 · 「메모 모두 지우기」가 생긴다.
  2. 보내기를 누르면 `composeNotes` 가 파일별 · 줄 순서로 묶는다. 각 줄은 「- 11행 `코드` — 메모」 꼴이고, 지운 줄은 「지운 11행」이다.
  3. 묶은 글을 「Claude 에게 보내기」 대화상자에 미리 채운다(`SendContext.prefill`, kind `notes`).
  4. 받는 세션 고르기, 새 세션, ⌘↩ 보내기는 그대로 쓴다.
  5. 보내면 `onSent` 로 메모를 비운다. 고친 뒤에는 줄 번호가 달라지기 때문이다.

## 검증

- `diff_notes.test.tsx` → 4 passed: 달기 → ⌘↩ → 카드 → 같은 줄 고치기(하나로 유지), 나란히 보기에서 Esc 취소, 메모를 끈 diff 에는 단추 없음, 묶음 글(파일 · 줄 순서 · 지운 줄 · 여러 줄 메모 · 빈 메모 버림).
- `send_to_claude.test.tsx` → 5 passed(+1): 미리 채움과 보낸 뒤 `onSent`.
- 하네스 스크린숏(어두운 ko · 밝은 en): 편집기, 카드, 점, 툴바 「메모 2개 → Claude」를 확인했다.
- `pnpm typecheck` 0 · `pnpm test` 964 passed · `pnpm lint` 0 · `pnpm build` 0