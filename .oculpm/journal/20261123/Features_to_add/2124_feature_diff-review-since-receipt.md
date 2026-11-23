---
schema_version: 1
type: feature
slug: "diff-review-since-receipt"
status: done
difficulty: high
created_at: "2026-11-23T21:24:39+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "scripts/check-no-localstorage.mjs"
    op: update
  - path: "src-tauri/src/commands/export.rs"
    op: update
  - path: "src-tauri/src/git/receipt.rs"
    op: update
  - path: "src-tauri/src/git/receipt_tests.rs"
    op: update
  - path: "src/__tests__/diff_review_since.test.tsx"
    op: create
  - path: "src/__tests__/diff_viewed.test.tsx"
    op: update
  - path: "src/__tests__/receipt_share.test.tsx"
    op: create
  - path: "src/__tests__/verdict_source_chip.test.tsx"
    op: create
  - path: "src/api/race.ts"
    op: update
  - path: "src/contexts/workspaceState.ts"
    op: update
  - path: "src/features/diff/ChangeFileList.tsx"
    op: update
  - path: "src/features/diff/ReceiptButton.tsx"
    op: create
  - path: "src/features/diff/changeGroups.ts"
    op: update
  - path: "src/features/diff/diffSessionStore.ts"
    op: update
  - path: "src/features/diff/receipt.css"
    op: create
  - path: "src/features/diff/receipt.ts"
    op: update
  - path: "src/features/diff/receiptHtml.ts"
    op: create
  - path: "src/features/diff/useDiffKeys.ts"
    op: update
  - path: "src/features/diff/useViewedMarks.ts"
    op: create
  - path: "src/features/oculpm/JournalDetail.tsx"
    op: update
  - path: "src/features/oculpm/JournalRow.tsx"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/__tests__/journal_verified.test.tsx"
    op: update
related: []
tags:
  - "변경"
  - "love-round"
  - "receipt"
  - "mcp-tool"
---
[x] 변경: 내가 본 뒤로와 어디서나 영수증

## 추가 기능
- 변경 화면 「내가 본 뒤로」: 「봤음」 한 파일은 목록 끝 「본 것 N」 한 줄로 접히고, 앱을 다시 켜도 그 뒤 내용이 바뀐 파일만 「본 뒤 바뀜」 으로 다시 펼친다(내용 해시, WorkspaceContext 저장).
- 판정 출처 칩: 검증을 적었지만 돌린 명령이 없으면 「명령 없음」 칩 + 「에이전트의 말뿐이에요」. 합류에서 일지 상세의 같은 칩 중복을 지휘자가 고쳤다.
- 영수증 복사가 오늘 · 일지 상세 · 변경 어디서나 같은 모양, ⇧⌘C(Ctrl+Shift+C). 일지 상세에서는 그 한 건.
- ▾ → 「HTML 파일로 저장…」: 앱 없이 브라우저로 여는 자체완결 한 장(인라인 CSS, 스크립트 없음), 저장 대화상자, 기기를 떠나지 않음. PR 영수증의 제목 · 검증 끝 줄은 비밀 가리기를 지난다.

## 동작 흐름
기존 receipt.ts 를 재사용해 새 형식을 만들지 않았다. 최종 검수(F1 · G2)가 첫 기록 전 · 변경이 없을 때는 영수증 단추를 세우지 않게 맞췄다.

## 검증
vitest diff_review_since + diff_viewed + diff_v2 53 passed, 필터 diff_ · receipt · verdict_source 20파일 184 passed. PR #177 CI 프런트 통과(7ca523f4 이후 journal_verified 포함).