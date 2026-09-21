---
schema_version: 1
type: feature
slug: "velocity-card-weekly-trend"
status: done
difficulty: medium
created_at: "2026-09-22T00:37:07+09:00"
session_id: "mcp-20260922-003707"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Sonnet 5 (구현 세션 Y)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db/velocity.rs"
    op: create
  - path: "src-tauri/src/commands/velocity.rs"
    op: create
  - path: "src/features/today/VelocityCard.tsx"
    op: create
  - path: "src/__tests__/today_velocity_card.test.tsx"
    op: create
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/i18n_english_screens.test.tsx"
    op: update
related: []
tags:
  - "journal-scale"
  - "today"
  - "velocity"
  - "mcp-tool"
---
[x] 속도·추이 카드 — 8주 유형 스택 막대와 플랜 완료 속도로 예상 잔여 주

## 추가 기능

플랜 `journal-scale-round` {#velocity}. 3차 웨이브 세션 Y(Sonnet 5) 구현, 감독자 합류. PR #28.

근거: 최근 5주 주당 51~129건, 플랜 항목 4,046(done 3,420)인데 추이·속도를 보는 화면이 없었다.

- `Db::velocity(project_id, weeks)`: `oculpm_journal` 을 월요일 시작 ISO 주로 묶어 유형별·에이전트별 집계, 빈 주는 0 으로 채워 연속. `oculpm_plan_items`(done/dropped 제외 = 미완) + `oculpm_plan_item_updates`(최근 4주 `to_status='done'` 전이)로 `weekly_done_avg`·`eta_weeks`(avg 0 이면 None). 그 표가 프로젝트 전체에서 비어 있으면 `plan.note` 로 구분(단순 "최근 4주 0건" 과 다른 사실). 주 경계·버킷·ETA 는 순수 함수.
- `oculpm_velocity(project_id, weeks?)` 기본 8, clamp 1~26.
- Today `VelocityCard`: 8주 스택 막대(`var(--t-*)` 유형색, 라이브러리 없이 CSS), hover 수치, 범례, 「플랜 미완 N · 최근 4주 주당 M 완료 · 이 속도면 약 K주」 / ETA None 이면 「완료 속도 데이터가 아직 없어요」. 0건이어도 숨지 않음. `by_agent` 는 API 에만(카드 미사용, 재사용 대비).
- `i18n_english_screens.test` 의 공용 `oculpmApi` 목에 `velocity` 빈 모양 추가 — 안 하면 순회 테스트가 `data.weeks` undefined 로 죽는다(1차 웨이브 `fileHotspots` 와 동형).

## 검증

Rust 3(주 버킷 연속성·ETA Some/None·DB 통합 — `Local::now()` 기준 동적 시드) · vitest 2. clippy `useless_conversion` 2곳 수정. 통합 브랜치 전 게이트 exit 0. 실기기 육안 미실시.