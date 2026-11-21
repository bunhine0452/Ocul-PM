---
schema_version: 1
type: feature
slug: "today-work-row-cap"
status: done
difficulty: low
created_at: "2026-11-22T03:24:00+09:00"
session_id: "manual-20261122-031405"
agent:
  id: "claude-code"
  version: "Fable 5.2"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/TodayWork.tsx"
    op: update
  - path: "src/__tests__/today_work_cap.test.tsx"
    op: create
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
related: []
tags:
  - "오늘"
  - "today"
  - "volume"
---
[x] 오늘: 편 목록도 30줄까지만 그린다

## 추가 기능
「오늘 한 일」 은 묶음이 접혀 서지만, 묶음을 펴거나 「시간순」 을 고르면 그날 일지 전부를 한 번에 그렸다. 하루 300건인 날 「시간순」 한 번이 300줄이었다. 화면의 크기가 사람이 볼 것이 아니라 에이전트가 한 양에 비례했다.

- 편 목록 하나는 한 번에 30줄(`WORK_LIMIT`)까지 그린다. 남으면 목록 끝의 「N건 더 보기」 가 그만큼씩 더 그린다.
- 30건 이하인 목록은 예전 그대로다(손잡이 없음). 머리의 수는 늘 전부다.
- 접었다 펴거나 보는 방식을 바꾸면 처음 줄 수로 돌아간다.
- 손잡이를 키보드로 누르면 포커스가 새로 그린 첫 줄로 간다. 마지막 묶음에서 손잡이가 사라져도 포커스가 body 로 떨어지지 않는다.

## 동작 흐름
1. `TodayWork` 의 목록 그리기를 `EntryList` 로 뺐다. 줄 상한은 그 목록의 지역 상태다.
2. 「시간순」 과 편 묶음이 같은 `EntryList` 를 쓴다.
3. 손잡이의 글은 일지 화면의 것과 같은 키(`journal.rowMore`)다.

## 검증
- 300건 픽스처에서 「시간순」: 줄 300 → 30, DOM 요소 3,009 → 310(jsdom 에서 `querySelectorAll("*")`), 그리는 시간 64ms → 18ms(jsdom, 한 번씩 잼 — 실제 웹뷰의 수가 아니다).
- `npx vitest run src/__tests__/today_work_cap.test.tsx src/__tests__/today_v4.test.tsx src/__tests__/fix_screens_today.test.tsx src/__tests__/today_receipt_rules.test.ts` → `Tests  40 passed (40)`
- `today_v4.test.tsx` 의 하루 60건 시험은 「시간순은 전부 한 줄씩(60)」 에서 「30줄, 더 보기를 누르면 60」 으로 고쳤다.

## 메모
- 「N건 더」 를 일지 화면으로 보내지 않고 제자리에서 더 그린다. 「검증 없이 끝난 일지」 의 「N건 더」 는 일지 화면으로 가지만(G-11), 계획 묶음은 일지 화면에 같은 거르기가 없어 보낼 곳이 없다.
- 설치본에서 눈으로 보지는 않았다.
