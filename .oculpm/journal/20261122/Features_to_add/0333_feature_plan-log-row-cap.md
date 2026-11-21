---
schema_version: 1
type: feature
slug: "plan-log-row-cap"
status: done
difficulty: low
created_at: "2026-11-22T03:33:00+09:00"
session_id: "manual-20261122-031405"
agent:
  id: "claude-code"
  version: "Fable 5.2"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/PlanLog.tsx"
    op: update
  - path: "src/features/planner/planner.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/plan_log_cap.test.tsx"
    op: create
related: []
tags:
  - "계획"
  - "planner"
  - "volume"
---
[x] 계획: 계획 기록은 펼쳐도 50줄까지만 그린다

## 추가 기능
계획 기록(plan-log)은 접힌 한 줄 「계획 기록 N줄」 로 시작하지만, 펼치면 전부를 한 번에 그렸다. 끝까지 맡긴 긴 실행은 항목마다 잡음 · 판정 · 닫음을 적어 기록이 수백 줄이 된다. 사람이 보려는 것은 대개 최근 몇 줄이다.

- 펼치면 최신 50줄(`LOG_LIMIT`)까지 그리고, 남으면 목록 끝의 「N줄 더 보기」 가 그만큼씩 더 그린다.
- 50줄 이하인 기록은 예전 그대로다. 머리의 「계획 기록 N줄」 은 늘 전부를 센다.

## 동작 흐름
1. `PlanLog` 가 줄 상한을 지역 상태로 든다. 화면이 계획마다 새로 그리므로(`key`) 다른 계획으로 가면 처음 줄 수다.
2. 받은 행(오래된 것이 앞)의 끝에서 상한만큼 잘라 뒤집는다 — 최신이 위.

## 검증
- 400줄 픽스처를 펼쳤을 때: 줄 400 → 50, DOM 요소 4,407 → 559(jsdom 에서 `querySelectorAll("*")`).
- `npx vitest run src/__tests__/plan_log_cap.test.tsx src/__tests__/fix_screens_planner.test.tsx src/__tests__/journal_planner_copy.test.tsx src/__tests__/journal_planner_frame.test.ts src/__tests__/stale_state.test.tsx src/__tests__/plan_fold.test.tsx src/__tests__/i18n_glossary.test.ts src/__tests__/i18n.test.ts` → `Tests  85 passed (85)`
- `npx tsc --noEmit` exit 0
- 설치본에서 눈으로 보지는 않았다.
