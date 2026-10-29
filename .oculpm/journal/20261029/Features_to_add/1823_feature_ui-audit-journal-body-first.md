---
schema_version: 1
type: feature
slug: "ui-audit-journal-body-first"
status: done
difficulty: medium
created_at: "2026-10-29T18:23:28+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/oculpm/JournalDetail.tsx"
    op: update
  - path: "src/features/oculpm/JournalList.tsx"
    op: update
  - path: "src/features/oculpm/JournalRow.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/journal.css"
    op: update
  - path: "src/features/oculpm/verification.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
  - path: "src/__tests__/journal_verified.test.tsx"
    op: update
related:
  - ref: "20261029/Features_to_add/1817_feature_ui-audit-today-three-parts.md"
    kind: "followup"
tags:
  - "ui"
  - "journal"
  - "ui-audit"
  - "mcp-tool"
---
[x] 일지는 본문부터 — 접힘·중복 걷기, 두 줄 제목, 두 축 필터

## 추가 기능

계획 ui-audit-20261029 4단계. 상세가 사람이 읽을 본문을 「전체 본문」 아래 접고 diff 를 먼저 펼쳤고, 펼치면 요약과 검증이 한 번 더 나왔다. 목록은 제목 48건 중 45건이 한 줄로 잘렸고, 모든 행에 같은 에이전트 이름과 「읽었다」로 읽히는 ✓ 가 붙었다. 「검증 없음」 은 종류 세그먼트에 섞여 종류와 같이 걸 수 없었다.

- 상세: 제목 → 본문(검증 칸만 뺀 그대로) → 검증 상자 → diff → 관련 일지. 머리 요약과 접기, `summaryOf` 를 걷었다. 「파일로 열기」 는 보통 단추로.
- 목록: 제목 두 줄, 에이전트 이름은 둘 이상일 때만, 통과 ✓ 빼고 예외 칩만.
- 필터: 종류 세그먼트 + 「검증 없는 것만」 단추(aria-pressed), 한 줄에.

## 동작 흐름

`withoutVerification(withoutTitle(body))` 가 본문에서 `## 검증` 부터 다음 소제목 전까지를 뺀다. 검증 줄은 `verificationLines` 가 그대로 상자에 싣는다. 필터는 종류가 백엔드 types, 「검증 없는 것만」 이 화면 쪽 `isEvidenceMissing` — 둘을 같이 건다.

## 검증

- 하네스(일지 48건) 1280px DOM 실측: 잘린 제목 45 → 8.
- pnpm typecheck 0 · pnpm test 77 files / 941 passed · pnpm lint 0 · pnpm build 0 (커밋 764c13ae)