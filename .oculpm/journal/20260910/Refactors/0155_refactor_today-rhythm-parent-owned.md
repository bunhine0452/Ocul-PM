---
schema_version: 1
type: refactor
slug: "today-rhythm-parent-owned"
status: done
difficulty: low
created_at: "2026-09-10T01:55:54+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/screens.css"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/CoreModelSeededCard.tsx"
    op: update
  - path: "src/features/today/FirstRunCard.tsx"
    op: update
  - path: "src/features/today/PluginSetupCard.tsx"
    op: update
  - path: "src/features/today/WhatsNewCard.tsx"
    op: update
  - path: "src/features/today/DiscussionPending.tsx"
    op: update
  - path: "src/features/today/PlanUpdates.tsx"
    op: update
  - path: "src/features/today/TodayActivity.tsx"
    op: update
  - path: "src/features/today/TodayMonitor.tsx"
    op: update
  - path: "src/features/today/TodayGitGraph.tsx"
    op: update
  - path: "src/features/today/HonestyAudit.tsx"
    op: update
  - path: "src/features/today/JournalMissingCard.tsx"
    op: update
  - path: "src/__tests__/design_ratchets.test.ts"
    op: update
related: []
tags:
  - "design"
  - "layout"
  - "mcp-tool"
---
[x] 조건부로 사라지는 자식들이 저마다 간격을 들고 있었다 — 그리고 「표면 3겹」은 없었다

## 동기

`{#layout-today}` — ⌘1 기본 착지 화면을 카드 대시보드에서 섹션으로.

## 실측이 항목을 반으로 갈랐다

항목은 두 가지를 주장했다.

**① "세로 리듬을 각 컴포넌트가 인라인으로 따로 갖는다" — 맞다.** 최상위 자식들이 저마다 `marginTop: 16` · `12` · `marginBottom: 16` · 없음을 들고 있었다. 이게 왜 나쁜지는 이 화면의 성질에 있다 — **자식 대부분이 조건부**다(`WhatsNewCard`·`FirstRunCard`·`PluginSetupCard`·`DiscussionPending`·`PlanUpdates`·`HonestyAudit`·`JournalMissingCard` 전부 상황에 따라 `null`). 간격을 자식이 들면 **무엇이 뜨느냐에 따라 리듬이 매번 달라진다**. 첫 실행에는 16 이 세 번 겹치고, 익은 프로젝트에서는 12 와 16 이 번갈아 나온다.

**② "표면도 3겹(시트→카드→카드)" — 아니다.** Today 의 카드를 전부 열어 봤는데 **카드 안의 카드가 없다**. 전부 `.page` 바로 아래 형제이고, `.stat`(StatCard)도 `.stat-row` 안의 직접 자식이다. `TodayGitGraph` 가 `card` 를 두 번 쓰는 건 같은 return 의 두 분기(저장소 아님 / 정상)이지 중첩이 아니다.

그래서 "카드는 행동을 요구하는 것에만 남기고" 는 하지 않았다 — **없는 문제를 고치는 일**이 되고, 어느 카드가 면을 가질 자격이 있는지는 근거 없이 내가 정하는 판단이 된다.

## 변경 요약

리듬을 부모가 가져갔다. `.today-page { display: flex; flex-direction: column; gap: var(--space-6) }` — 16px 은 걷어낸 인라인 값의 최빈값이다.

자식 열한 곳에서 인라인 세로 여백을 지웠다: `ErrorCard`(TodayScreenV2) · `CoreModelSeededCard` · `FirstRunCard` · `PluginSetupCard` · `WhatsNewCard` · `DiscussionPending` · `PlanUpdates` · `TodayActivity` · `TodayMonitor` · `TodayGitGraph`(2) · `HonestyAudit`(2) · `JournalMissingCard`(2). `.stat-row` 의 `margin-bottom` 도 뺐다.

**`null` 을 반환한 자식은 gap 을 만들지 않는다** — 그래서 조건부 자식이 아무리 많아도 리듬이 하나로 유지된다. 이게 부모가 쥐어야 하는 이유다.

카드 **안쪽** 여백은 그대로 뒀다(`WeekChart` 의 `.section-title` 등) — 그건 그 카드의 것이지 화면의 리듬이 아니다.

## 계약

- 부모가 gap 을 소유한다.
- Today 자식이 16px 이상의 세로 여백을 인라인으로 들지 않는다. (카드 안쪽의 작은 값은 안 본다.)

## 검증

`PlanUpdates` 에 `marginTop: 16` 을 되살려 실패시키고(`인라인 세로 리듬: features/today/PlanUpdates.tsx:57`) 되돌린 뒤 `git diff` 로 복구를 확인했다.

4게이트 각각 exit 0: typecheck · lint(경고 9, 기준선) · test 198파일/2587 · build.

**눈으로 볼 것:** Today 를 **두 상태**로 봐 주세요 — 카드가 많이 뜨는 상태(첫 실행·누락 있음)와 조용한 상태. 예전에는 이 둘의 리듬이 달랐고, 지금은 같아야 합니다.