---
schema_version: 1
type: bug
slug: "diff-note-common-lines"
status: done
difficulty: low
created_at: "2026-10-31T00:17:56+09:00"
session_id: "20261031-001"
agent:
  id: "claude-code"
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
  - path: "src/__tests__/diff_notes.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ref: "20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md"
    kind: "followup"
tags:
  - "diff"
  - "redteam"
  - "mcp-tool"
---
[x] 변경: 흔한 줄 메모는 고쳐짐을 가리지 않는다

## 발생 원인
레드팀(10-31)이 찾은 반례다. 보낸 메모의 판정은 그 줄이 제자리를 떠나면 가장 가까운 같은 줄로 따라갔다. 그래서 지워진 5행 `</div>` 의 메모가 3행의 다른 `</div>` 로 옮겨 가 「아직」에 남았다. 빈 줄 메모는 영영 판정되지 않았다.

## 해결 방법
- `isTelling(code)`: 글자 · 숫자가 6개 이상이어야 줄을 알아볼 수 있다고 본다.
- 흔한 줄(`}` · `</div>` · 빈 줄)이 제자리를 떠나면 따라가지 않고 `unsure`(가릴 수 없음)로 둔다. 제자리에 있으면 「아직」.
- 카드에는 「보냄」(테두리 딱지, 툴팁 「흔한 줄이라 고쳐졌는지 가리지 않아요」)을 붙인다. 툴바의 「고쳐짐 k/n」 은 가릴 수 있는 메모(`isJudged`)만 센다.

## 검증
- `pnpm vitest run src/__tests__/diff_notes.test.tsx` → 6 passed (`</div>` 이동 · 제자리 · 빈 줄 단언 추가)
- 레드팀 재현(esbuild + node) → `{"line":5,"fixed":false,"unsure":true}`, 빈 줄도 unsure
- 전체 게이트 → Tests 973 passed · rust passed 1167 failed 0