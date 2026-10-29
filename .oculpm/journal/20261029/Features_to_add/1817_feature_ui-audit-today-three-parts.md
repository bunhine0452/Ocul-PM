---
schema_version: 1
type: feature
slug: "ui-audit-today-three-parts"
status: done
difficulty: medium
created_at: "2026-10-29T18:17:33+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/TodaySide.tsx"
    op: update
  - path: "src/features/today/TodayWork.tsx"
    op: update
  - path: "src/features/today/today.css"
    op: update
  - path: "src/features/today/todayModel.ts"
    op: update
  - path: "src/features/today/useTodayExceptions.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
related:
  - ref: "20261029/Bugs/1809_bug_ui-audit-numbers-agree.md"
    kind: "followup"
tags:
  - "ui"
  - "today"
  - "ui-audit"
  - "mcp-tool"
---
[x] 오늘을 세 자리로 — 먼저 볼 것·검증 없는 일지·내 차례

## 추가 기능

계획 ui-audit-20261029 3단계. 오늘 화면이 실패한 확인 명령, 몇 주짜리 사람 몫(테스터 모집), 읽음 표시만 남은 일지를 한 목록에 같은 무게로 세웠다(딱지 9 · 버튼 10, 그중 「확인함」 4).

- 먼저 볼 것: 실패 · 일지 없는 변경 · 일지 없이 끝난 대화 · 막힘 · 플러그인 새 판만. 윗줄 「오늘」 배지도 이 수.
- 검증 없이 끝난 일지: 한 묶음, 딱지 없음, 「모두 읽음」 하나(`setJournalVerifiedBulk`). 행의 읽음은 hover/포커스에만 보인다.
- 내 차례: 「계획 N곳에 내 차례 M건 · 계획에서 보기」 한 줄.
- 되풀이 걷기: 확인 명령 행의 에이전트 이름 빼기, 일지 행의 에이전트 이름은 둘 이상일 때만. 다음 제목은 두 줄.
- 오늘 한 일: 8건 넘으면 묶음 머리만. 검증 없는 일지를 다시 펼치던 「볼 것만」 접힘과 「나머지 N건 보기」 를 걷었다.

## 동작 흐름

`splitExceptions(exceptions)` → `{ first, unread, mine, rows }`. `rows = first ++ unread` 가 j/k 순서라 두 칸을 건너 이어진다. Enter 는 행의 첫 버튼, v 는 일지 행에서만 읽음, r 은 다음을 터미널에서.

## 검증

- 하네스(일지 48건)로 첫 화면을 DOM 으로 셈: 딱지 2, 동작 버튼 출력 보기 · 변경 보기 · 모두 읽음 · 터미널에서 실행 4개 + 링크 1.
- pnpm typecheck 0 · pnpm test 77 files / 941 passed · pnpm lint 0 · pnpm build 0 (커밋 92dde2b0)