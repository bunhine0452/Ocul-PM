---
schema_version: 1
type: feature
slug: "diff-notes-track"
status: done
difficulty: medium
created_at: "2026-10-30T22:46:41+09:00"
session_id: "20261030-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/diff/diffNoteStore.ts"
    op: update
  - path: "src/features/diff/DiffNotes.tsx"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/contexts/workspaceState.ts"
    op: update
  - path: "src/contexts/workspaceDefaults.ts"
    op: update
  - path: "src/__tests__/diff_notes.test.tsx"
    op: update
related: []
tags:
  - "변경"
  - "orca-bench"
  - "diff-notes"
  - "mcp-tool"
---
[x] 변경: 보낸 메모가 고쳐졌는지 저절로 안다

## 추가 기능

사용자 요청(10-30): 「orca 보다 더 좋게」 가운데 「보낸 메모가 고쳐졌는지 자동 표시」(계획 `beyond-orca-20261030` #notes-track). Orca 는 메모를 고정해 두고 사람이 Resolve 를 누른다. Ocul 은 파일을 보고 스스로 안다.

## 동작 흐름

- **보내기:** 이제 메모를 지우지 않고 `sent` 로 바꾼다(`markSent`). 보낼 묶음은 아직 안 보낸 메모만이다.
- **판정**(`resolveNotes`, 순수 함수): 파일의 지금 내용(`projectFileApi.read`)과 견준다.
  - 그 줄에 같은 코드(공백 무시)가 있으면 「아직」.
  - 다른 줄에 있으면 가장 가까운 줄로 따라가고 「아직」.
  - 어디에도 없거나 파일이 없으면 「고쳐짐」.
  - 지운 줄(old) 메모는 판정하지 않고 「보냄」으로 둔다.
- **다시 판정:** 변경 화면의 변경 목록(`changes`)이 새로 오면 다시 판정한다(Claude 가 고치면 워처가 새로 온다). 바뀐 것이 있을 때만 저장소를 깨운다.
- **영속:** WorkspaceContext 에 `diffNotes` 를 더했다. 처음 한 번만 hydrate 하고, 그 뒤로는 모듈 저장소가 원본이며 바뀌면 상태에 적는다. 창을 다시 열어도 남는다.
- **표시:**
  - 카드 앞에 「고쳐짐(초록) / 아직(노랑) / 보냄」 칩을 단다. 왼쪽 줄 색이 같고, 고쳐진 메모는 글을 흐리게 한다.
  - 툴바에 「고쳐짐 k/n」을 단다. 다 고쳐지면 초록이다.

## 검증

- `diff_notes.test.tsx` → 6 passed(+2):
  - 같은 줄 · 옮긴 줄(1→4) · 사라짐 · 지운 줄 · 안 보낸 메모 · 지운 파일
  - 보냄 표시와 카드의 「Open」 → 판정 뒤 「Fixed」, hydrate 는 한 번만
- 하네스(어두운 ko): 보낸 메모 둘의 카드 칩과 툴바 「고쳐짐 2/2」를 확인했다.
- 전체:
  - `pnpm typecheck` 0 · `pnpm test` 972 passed · `pnpm lint` 0 · `pnpm build` 0
  - rust passed 1166 failed 0