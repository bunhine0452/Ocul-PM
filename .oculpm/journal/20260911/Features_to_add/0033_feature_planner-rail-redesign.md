---
schema_version: 1
type: feature
slug: "planner-rail-redesign"
status: done
difficulty: medium
created_at: "2026-09-11T00:33:38+09:00"
session_id: "20260911-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "ce6e3504-bf40-48a3-95c2-7760471489a8"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/PlanRailMenu.tsx"
    op: create
  - path: "src/features/planner/PlanRail.tsx"
    op: update
  - path: "src/features/planner/PlanRailDock.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/__tests__/tools_v2.test.tsx"
    op: update
  - path: "src/__tests__/plan_hover_card.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "planner"
  - "design"
  - "ui_v2"
  - "mcp-tool"
---
[x] 플래너 계획 레일 — 툴바 아이콘 둘·셀렉트 둘을 메뉴 하나로, 행은 진행 파이

## 추가 기능

사용자 요청 「이 사이드바 디자인도 완전 업그레이드 해줘. 저기 위에 아이콘 두개있는것도 이상해」. 진단: 툴바의 패널 아이콘 둘(접기·좌우 이동)은 같은 도형이라 구별이 안 됐고, 레일 머리엔 네이티브 `<select>` 둘(정렬·묶기)이 늘 서 있었고, 행은 「11/11 · 3일 전 · 34px 막대」로 분수가 진척을 말하고 있었다.

- **옵션 메뉴 하나** (`PlanRailMenu.tsx`) — 정렬 4·묶기 4 는 `menuitemradio`, 좌우 이동·접기는 `menuitem`. 넷 다 가끔 바꾸는 설정이라 ⋯ 하나로 접었다. 툴바 `leading` 아이콘 둘은 제거.
- **레일 머리** = `[검색(sm) | ⋯]` 한 줄. 계획이 여섯 미만이면 검색 자리에 「계획 N」 이름표.
- **접힌 레일의 띠** (`PlanRailTab`, `PlanRailDock.tsx`) — 세로 라벨 「계획 N」 + 셰브론. 되살리는 손잡이는 접힌 자리에 선다(코드 사이드바·터미널 도크와 같은 원칙).
- **행** = `[진행 파이 | 제목 2줄 / N 남음 · 언제]`. 파이는 `.pmark` 와 같은 16px 원에 `conic-gradient` 로 채움 각도 = 진척, 완료는 꽉 찬 원, 보관은 점선 원, 선택된 행만 액센트. 분수와 막대는 제거. 제목은 ellipsis 대신 2줄 클램프(`overflow-wrap: break-word`).
- **섹션 머리** — 건수 알약 → 모노 숫자, 절 간격 축소, 토글에 hover 면.

## 동작 흐름

데이터·훅·영속 상태(`plannerRailSide`·`plannerRailCollapsed`·`plannerSort`·`plannerGroup`) 무변경. `PlanRail` 에 `onSideToggle`·`onCollapse` prop 이 늘었다. 테스트: 좌우 이동 케이스는 메뉴를 먼저 열도록 갱신, hover 카드 픽스처에 prop 둘 추가.

## 검증

- typecheck · vitest 2623 · build 초록. design 게이트는 제 변경분 0(붉은 1건은 다른 세션의 미추적 `code-frame.css`).
- DOM 덤프 + 실제 CSS 하네스로 라이트/다크 · 메뉴 열림 · 접힌 띠 확인. 첫 컷에서 `overflow-wrap: anywhere` 가 `(2026-` 를 토큰 중간에서 끊고 절 간격이 과해 두 건 조정.