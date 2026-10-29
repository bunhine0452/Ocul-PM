---
schema_version: 1
type: bug
slug: "ui-audit-numbers-agree"
status: done
difficulty: low
created_at: "2026-10-29T18:09:22+09:00"
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
  - path: "src/features/today/TodayWork.tsx"
    op: update
  - path: "src/features/planner/PlanDoc.tsx"
    op: update
  - path: "src/features/planner/PlanLog.tsx"
    op: update
  - path: "src/__tests__/planner_v4.test.tsx"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
related: []
tags:
  - "ui"
  - "today"
  - "planner"
  - "ui-audit"
  - "mcp-tool"
---
[x] 오늘·계획 화면의 수가 서로 안 맞던 것

## 발생 원인

- 오늘 「확인할 것 9」 옆 「나머지 44건은 볼 것이 없어 접었어요」: 9 는 일지·파일·계획 항목을 섞어 센 수, 44 는 일지만 센 수. 더하면 53 인데 오늘 일지는 48건이었다.
- 「오늘 한 일」 묶음 머리 「증거 41 · 없음 4」: 잡일처럼 검증 대상이 아닌 일지 3건을 어디에도 세지 않아 합이 48 이 아니었다.
- 계획 완료 조건 칸: 명령 줄이 없는데 지난 결과가 있으면 「확인 명령이 없어요」 와 「✗ 실패」 가 나란히, 둘 다 없으면 「없어요」 와 「아직 안 돌렸어요」 가 겹쳤다.
- 계획 로그 줄이 「갱신 기록 0줄 · 결정 0」 처럼 0 을 적었다.

## 해결 방법

- 「나머지 N건 접었어요」 를 걷고, 묶음 머리는 예외 수(「검증 없음 N」)만 쓴다.
- JudgeCard 는 한 칸에 한 상태: 결과가 있으면 결과만, 명령도 결과도 없으면 「확인 명령이 아직 없어요」 한 번.
- PlanLog 는 0 인 쪽을 빼고, 둘 다 0 이거나 읽는 중이면 줄을 세우지 않는다(못 읽었을 때 문구는 유지).

## 검증

- 대조군: PlanDoc 만 옛것으로 되돌리면 planner_v4 새 테스트 2개가 × (Tests 2 failed | 11 passed).
- pnpm typecheck 0 · pnpm test 77 files / 940 passed · pnpm lint 0 · pnpm build 0 (커밋 484f9bd6)