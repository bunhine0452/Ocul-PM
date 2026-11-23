---
schema_version: 1
type: feature
slug: "journal-diff-craft"
status: done
difficulty: medium
created_at: "2026-11-23T21:25:13+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "DESIGN.md"
    op: update
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger.rs"
    op: update
  - path: "src/__tests__/design_ratchets.test.ts"
    op: update
  - path: "src/__tests__/diff_craft.test.tsx"
    op: create
  - path: "src/__tests__/egress_row.test.tsx"
    op: create
  - path: "src/__tests__/journal_detail_chore_tone.test.tsx"
    op: create
  - path: "src/__tests__/journal_first_day.test.tsx"
    op: create
  - path: "src/__tests__/journal_planner_frame.test.ts"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
  - path: "src/features/diff/DiffFileHead.tsx"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/JournalFirstDay.tsx"
    op: create
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/journal.css"
    op: update
  - path: "src/features/settings/EgressRow.tsx"
    op: create
  - path: "src/features/settings/egressDoors.json"
    op: create
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/tokens.css"
    op: update
related: []
tags:
  - "일지"
  - "love-round"
  - "design"
  - "mcp-tool"
---
[x] 일지: 잡일 호박색 걷고 좁은 창을 다듬는다

## 추가 기능
디자인팀 레인. 하네스로 전후를 찍어 고쳤다.
- 일지 상세: 증거를 요구하지 않는 잡일 · 에러 일지에 호박 「명령 없음」 과 「주장일 뿐이에요」 를 달지 않는다(무채색 칩만). 명령이 있으면 머리의 ✓ 하나만.
- 좁은 창(1066px 밑): 목록 칸이 `clamp(232px, 30vw, 320px)` 로 줄어 760 에서 diff 본문이 440 → 528. 일지 검색칸이 좁아지면 기간 칸이 다음 줄로(영어 안내문 잘림 해소).
- 변경 화면: 파일 머리 동사를 일지 상세와 같은 「Claude 에게 보내기」 로, 변경이 없으면 영수증 단추와 ⇧⌘C 를 걷고, 줄 메모 「+」 를 24×24 표적(키보드로도 닿음).
- 빈 작업 일지 화면의 채운 단추를 「터미널에서 첫 작업 맡기기」 로.
- 설정 · 앱의 「기기를 떠나는 것」(업데이트 확인 · 내가 연 링크 · 터미널에서 돌린 것) — egressDoors.json 한 출처를 원장 두 시험이 대조한다.

## 동작 흐름
목록 칸을 줄인 대가로 760 에서 일지 제목이 155px 에서 잘린다(최종 검수 F2 가 맞바꿈으로 기록, 이월).

## 검증
vitest 고친 · 더한 16파일 192 passed, 줄 메모 표적 24px 미만 05-diff 5 → 0 · 20-narrow-diff 15 → 0(하네스 audit). 로컬 `egress_inventory` 7 · `egress_spawn_ledger` 9 passed.