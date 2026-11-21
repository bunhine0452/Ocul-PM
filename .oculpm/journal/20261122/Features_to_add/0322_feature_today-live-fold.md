---
schema_version: 1
type: feature
slug: "today-live-fold"
status: done
difficulty: low
created_at: "2026-11-22T03:22:00+09:00"
session_id: "manual-20261122-031405"
agent:
  id: "claude-code"
  version: "Fable 5.2"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/TodaySide.tsx"
    op: update
  - path: "src/features/today/today.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/today_live_fold.test.tsx"
    op: create
related: []
tags:
  - "오늘"
  - "today"
  - "volume"
---
[x] 오늘: 세션이 많으면 조용한 것만 줄로 선다

## 추가 기능
「지금 일하는 중」 은 열린 작업 세션마다 한 줄이었다. 세션 40개가 도는 날 40줄이 섰고, 30분 넘게 조용한 세션(볼 것)이 그 사이에 흩어져 묻혔다. 잘 돌고 있는 세션은 예외가 아니다.

- 세션이 다섯(`LIVE_LIMIT`) 이하면 예전처럼 다 보인다. 조용한 것이 앞에, 가장 오래 조용한 것부터 선다.
- 넘으면 조용한 세션만(다섯까지) 줄로 서고 나머지는 접힌 한 줄 「그 밖에 일하는 중 N」 이 수로 말한다. 누르면 그 자리에서 펴진다.
- 조용한 세션이 없으면 그 한 줄이 「30분 넘게 조용한 세션은 없어요 N」 이다.
- 접힌 쪽에 조용한 세션이 남으면 그 수를 경고색으로 적는다. 접혀서 예외가 사라지지 않는다.

## 동작 흐름
1. `LiveCard` 가 세션을 조용한 것 먼저, 그 안에서는 오래 조용한 순으로 세운다. 나머지는 받은 차례 그대로다.
2. 상한을 넘으면 조용한 세션을 상한까지 줄로 그리고, 나머지를 `Disclosure`(일지 · 계획과 같은 접기 손잡이) 안에 둔다.
3. 머리의 수는 늘 열린 세션 전부다.

## 검증
- 세션 40개 · 조용한 셋 픽스처: 줄 40 → 3 + 접힌 한 줄. 고치기 전 같은 픽스처는 `.tdy-sess` 40줄이었다.
- `npx vitest run src/__tests__/today_live_fold.test.tsx src/__tests__/today_v4.test.tsx src/__tests__/today_actions.test.tsx src/__tests__/fix_screens_rules.test.tsx` → `Tests  60 passed (60)`
- 설치본에서 눈으로 보지는 않았다. 좁은 창 모양도 시험 환경(jsdom)에서는 재지 못한다.
