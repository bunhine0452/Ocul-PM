---
schema_version: 1
type: refactor
slug: pr-ui8a-legacy-move
status: done
difficulty: medium
created_at: "2026-06-04T20:15:39+09:00"
updated_at: "2026-06-04T20:15:39+09:00"
session_id: "20260604-m01"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/legacy/today/TodayScreen.tsx
    op: rename
    bytes_added: 0
    bytes_removed: 0
  - path: src/legacy/oculpm/TimelineView.tsx
    op: rename
    bytes_added: 0
    bytes_removed: 0
  - path: src/legacy/planner/PlannerPanel.tsx
    op: rename
    bytes_added: 0
    bytes_removed: 0
  - path: src/legacy/projects/MigrationModal.tsx
    op: rename
    bytes_added: 0
    bytes_removed: 0
  - path: src/__tests__/a11y_screens.test.tsx
    op: update
    bytes_added: 200
    bytes_removed: 700
  - path: scripts/check-no-localstorage.mjs
    op: update
    bytes_added: 400
    bytes_removed: 900
related:
  - "../Refactors/2036_feature_pr-ui8b-dark-purge.md"
tags: ["ui-v2", "pr-ui8", "legacy", "cleanup", "dark-purge"]
---

## 리팩토링

PR-UI 8a — **ui_v2 에서 렌더되지 않는 dead 레거시 화면 클러스터 전체를 `src/legacy/` 로 이동**(빌드 제외). Decision J 의 시각 토큰 purge 중 *기계적* 파트(사용자 8a/8b 분리 결정).

- 이동 27 파일: `today/TodayScreen` · `overview/**`(OverviewScreen·ProjectMetaHeader·widgets 5) · `oculpm`(TimelineView·JournalEntryCard·JournalEntryDetail·CategoryFilterBar·OculpmOnboardingModal·ManualEntryModal·EmptyToday·filters) · `planner`(PlannerPanel·GoalCard·SubtaskList·GoalForm·CalendarView·Dashboard) · `projects`(MigrationModal·LegacyDeleteModal·migrationLogic).
- `check-no-localstorage.mjs` 가 `src/legacy` 까지 스캔하던 것 → walk 제외(tsconfig/vitest 와 일관) + 이동 파일 allowlist 정리.

## 검증

- typecheck 에러는 a11y_screens 테스트 2건(TodayScreen/PlannerPanel)뿐 → live production 코드는 이동 파일을 **하나도** import 안 함 확인(모든 live→dead 참조는 주석/이벤트). 해당 a11y 케이스는 V2 커버리지(today_v2/tools_v2)로 대체.
- `dark:` **62 → 27** (35 제거). 토큰 격리 유지(녹색 main css 0). typecheck/test(88)/lint/build green.

## 메모

- 남은 27 `dark:` = live shadcn 표면(대시보드/오버레이/primitive) → PR-UI 8b 에서 처리.
- 머지 `8f1ceae`, 태그 `pre-cut-PR-UI8a`.
