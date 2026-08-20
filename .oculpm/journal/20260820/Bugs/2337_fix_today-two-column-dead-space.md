---
schema_version: 1
type: fix
slug: "today-two-column-dead-space"
status: done
difficulty: small
created_at: "2026-08-20T23:37:00+09:00"
session_id: "manual-20260820-233700"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/screens.css"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/AgentBreakdown.tsx"
    op: update
  - path: "src/features/today/WeekChart.tsx"
    op: update
  - path: "src/features/today/useTodayBrief.ts"
    op: update
  - path: "src/__tests__/today_v2.test.tsx"
    op: update
tags: ["ui", "today", "layout", "grid", "claude-code"]
---

[x] Today — 왼쪽 열 아래로 드러나던 빈 배경

## 동기

Today 2단 격자에서 「어제 마무리한 작업」 카드가 끝난 자리부터 오른쪽 「다음 할 일」이 끝나는 자리까지 200px 남짓 페이지 배경이 그대로 보였다. 카드가 아니라 **아무것도 아닌 구멍**이라 화면이 미완성으로 읽힌다.

원인은 두 겹이었다.

1. **`.grid-2 { align-items: start }`** — 두 열이 각자 콘텐츠 높이에서 끝난다. 짧은 쪽 아래는 그냥 비는 게 구조상 당연했다.
2. **카드 배분이 한쪽으로 쏠려 있었다.** 왼쪽은 리스트 2장(하이라이트 3줄 + 어제 3줄), 오른쪽은 위젯 3장(주간 차트 + 에이전트별 기여 + 다음 할 일 5줄). 오른쪽이 늘 더 길 수밖에 없는 배치였다.

## 변경 요약

- **에이전트별 기여를 왼쪽 열로.** 「오늘의 하이라이트 → 에이전트별 기여 → 어제 마무리한 작업」. 셋 다 *오늘/어제 실제로 무슨 일이 있었나*를 답하는 카드라 묶음이 더 자연스럽고, 오른쪽은 「이번 주 작업량(흐름) → 다음 할 일(앞으로)」로 성격이 정리된다. 높이로도 균형점에 가장 가까운 카드였다.
- **`.grid-2-fill` — 남는 높이는 마지막 카드가 흡수한다.** 열을 `flex` 스택으로 두고 `.g2col > .card:last-child` 에 `flex: 1`, 그 카드의 `.panel-body` 에도 `flex: 1` 을 준다. 데이터가 어떻게 들어오든(에이전트 1개 vs 5개, 다음 할 일 0개 vs 5개) 두 열이 같은 선에서 끝난다. 재배치가 어긋나는 경우의 안전망.
- **카드 간격을 인라인 `marginBottom` → 열의 `gap: 16px` 으로.** 마지막 카드에 margin 이 남아 있으면 stretch 가 그만큼 어긋난다. `WeekChart`/`AgentBreakdown` 은 Today 전용이라 인라인 margin 을 지웠다.
- **「어제 마무리한 작업」 상한 3 → 5.** 오른쪽 「다음 할 일」과 같은 5로 맞춰, 늘어난 카드가 여백이 아니라 실제 기록으로 채워지게 했다.

## 구조

CSS 는 `.grid-2` 를 건드리지 않고 `.grid-2-fill` 변형으로 얹었다 — `.grid-2` 는 다른 화면도 쓰는 공용 격자라, 세로 stretch 를 전역 기본값으로 바꾸면 짧은 카드가 의도치 않게 늘어난다.

## 검증

- `pnpm test` 1077 통과(신규 2). 열 배치(에이전트가 왼쪽·주간/다음 할 일이 오른쪽)와, CSS 규칙이 실제로 걸리는 조건 — 각 열의 마지막 **직계** 자식이 `.card` 라는 것 — 을 단언한다. 래퍼가 하나 끼는 순간 `:last-child` 가 헛돌기 때문에 눈으로는 못 잡는 회귀다.
- typecheck / test / lint / build 각각 exit 0.
- 실제 CSS(tokens/App/base/shell/primitives/screens)를 인라인한 정적 프리뷰를 브라우저에 띄워 before/after 를 나란히 놓고 **두 열의 하단 좌표 차이**를 쟀다: **241px → 0px**. 스크린샷의 그 구멍이 그대로 재현됐고, 바뀐 규칙에서 사라진다.

## 메모

jsdom 은 레이아웃을 계산하지 않아 "구멍이 사라졌다"를 테스트로 직접 단언할 수는 없다. 그래서 결과(높이) 대신 **원인**(카드 배치 + `:last-child` 가 카드인지)을 고정했다.
