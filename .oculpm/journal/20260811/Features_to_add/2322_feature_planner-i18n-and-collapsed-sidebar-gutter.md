---
schema_version: 1
type: feature
slug: "planner-i18n-and-collapsed-sidebar-gutter"
status: done
difficulty: medium
created_at: "2026-08-11T23:22:57+09:00"
session_id: "mcp-20260811-232257"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/planner/PlanRail.tsx"
    op: update
  - path: "src/features/planner/planList.ts"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "phase2"
  - "ui"
  - "사이드바"
  - "mcp-tool"
---
[x] 플래너 영어화 + 사이드바 접었을 때 창 가장자리 단차 제거

## 추가 기능

플래너 3파일 영어화 — PlannerScreenV2(99건) · PlanRail(17건) · planList(13건). 사전 키 118개. allowlist 96 → 93.

## 사이드바 접힘 단차 (사용자 보고)

사이드바를 접으면 창 가장자리에 빈 띠가 생겨 콘텐츠가 안쪽으로 밀려 보였다.

**발생 원인.** 셸은 콘텐츠를 캔버스 위에 뜬 '시트'로 그린다 — `.app { padding: 10px 10px 10px 0 }` 로 위·오른쪽·아래에만 10px 여백을 주고, 왼쪽은 사이드바가 채우므로 0이다. 그런데 접힘 상태가 `padding-left: 10px` 를 **더하고** 있었다. 사이드바가 빠진 자리에 여백이 새로 생기면서 시트가 사방으로 떠 버린 것이다.

**해결 방법.** 접었을 때는 여백을 0으로 두고 시트가 창을 꽉 채우게 했다. 10px 여백이 '떠 있는 시트'로 읽히는 건 왼쪽에 사이드바가 있기 때문인데, 사이드바가 사라지면 그 여백은 맥락을 잃고 가장자리를 두르는 빈 띠로만 남는다.

여백을 없애면서 시트의 테두리·라운드·그림자도 함께 껐다 — 뒤에 분리할 배경이 없는데 남기면 그 자체가 또 다른 단차로 보인다.

접힘 오버레이(`side-hover-zone`, 좌측 10px)와 macOS 신호등 여백(`.is-mac.sidebar-collapsed .toolbar { padding-left: 84px }`)은 절대 위치·별도 규칙이라 영향받지 않는다.

## 영어화에서 나온 것

**단계 그룹 키를 sentinel 로 분리.** `NO_PHASE = "(기타)"` 가 표시 문자열이면서 동시에 그룹 키였다. 번역하면 언어를 바꿀 때 같은 항목들이 다른 그룹으로 갈라진다. 키를 `"__no_phase__"` 로 고정하고 표시만 `t("plan.noPhase")` 로 그린다.

`t` 섀도잉이 두 번 더 나왔다 — `const t = Date.parse(iso)` (PlannerScreenV2) · `const t = f?.touchedAt` (planList). 둘 다 typecheck 가 잡았다.

`STATUS_META.label` · `RECENCY_BUCKETS.label` 도 `labelKey: I18nKey` 로 — 이번 라운드에서 다섯 번째 반복되는 상수 테이블 패턴이다.

## 검증

게이트 4종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build.

사이드바 단차는 **CSS 변경이라 자동 검증이 없다** — 앱을 띄워 접었다 펴는 눈 검증이 필요하다.

## 남은 일

93파일. OculpmSettings 146 은 이번에 함께 요청받았으나 착수하지 못했다 (다음 차례). 그 외 skillsGallery 112 · SkillsScreenV2 89 · RetroScreenV2 72 · TrayPopover 70 등.