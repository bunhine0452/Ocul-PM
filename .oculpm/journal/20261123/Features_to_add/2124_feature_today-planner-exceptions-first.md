---
schema_version: 1
type: feature
slug: "today-planner-exceptions-first"
status: done
difficulty: medium
created_at: "2026-11-23T21:24:52+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/digest.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/dto.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/project.rs"
    op: update
  - path: "src/__tests__/plan_verdict_v2.test.tsx"
    op: update
  - path: "src/__tests__/today_planner_love.test.tsx"
    op: create
  - path: "src/components/VerdictLine.tsx"
    op: update
  - path: "src/components/verdictLine.css"
    op: update
  - path: "src/features/planner/PlanRail.tsx"
    op: update
  - path: "src/features/planner/planList.ts"
    op: update
  - path: "src/features/planner/usePlanDocument.ts"
    op: update
  - path: "src/features/shell/useNavBadges.ts"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayWork.tsx"
    op: update
  - path: "src/features/today/today.css"
    op: update
  - path: "src/features/today/todayModel.ts"
    op: update
related: []
tags:
  - "오늘"
  - "love-round"
  - "design"
  - "mcp-tool"
---
[x] 오늘: 예외가 먼저 서게 계획 목록을 정렬

## 추가 기능
디자인팀 레인. 탐색에서 하네스로 찍은 42장으로 짚은 것을 고쳤다.
- 오늘 판정 실패 행: 아래 줄에 어느 계획인지가 먼저, 긴 확인 명령은 뒤에서 잘리고 시각은 줄 끝.
- 계획 목록: 확인 실패 · 통과 뒤 바뀜 계획이 맨 위, 그다음 닫을 계획, 무리마다 「먼저 볼 계획 1 · 닫을 계획 4 · 그 밖의 계획 9」 처럼 이름과 수. 계획 화면을 열면 실패한 계획이 먼저 열린다(PlanSummary.closable).
- 「오늘 한 일」 은 종류 이름 칸을 걷어 1280 에서 제목 15개 중 13개가 잘리던 것을 풀었다.
- 먼저 볼 것도 다음 항목도 없으면 「다음에 잡을 계획 항목이 없어요. 계획 보기」 한 줄. 탭 배지와 오늘 카드가 같은 이름 「먼저 볼 것 N」 과 같은 수. 「기록 없음」→「일지 없음」, 「수동 기록」→「직접 쓴 일지」.

## 동작 흐름
「영수증」 규칙 3 · 5(채운 단추 하나 · 접힌 것은 숫자로)를 따랐고, 오늘 「다음」 계산 · 첫 단계 카드 · 기다림 줄은 다른 레인 몫이라 건드리지 않았다.

## 검증
vitest 영향 9파일 74 passed(새 today_planner_love 11). 최종 검수 F2 가 저장소 하네스로 44장을 다시 찍어 채운 단추가 화면당 하나임을 확인(어두운 변경 화면 27 → 1). PR #177 CI 통과.