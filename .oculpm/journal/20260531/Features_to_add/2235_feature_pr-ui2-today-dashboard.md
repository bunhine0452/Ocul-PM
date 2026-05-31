---
schema_version: 1
type: feature
slug: pr-ui2-today-dashboard
status: done
difficulty: high
created_at: "2026-05-31T22:35:54+09:00"
updated_at: "2026-05-31T22:35:54+09:00"
session_id: "20260531-m03"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/today/TodayScreenV2.tsx
    op: create
    bytes_added: 8500
    bytes_removed: 0
  - path: src/features/today/useTodayBrief.ts
    op: create
    bytes_added: 6900
    bytes_removed: 0
  - path: src/features/today/StatCard.tsx
    op: create
    bytes_added: 1000
    bytes_removed: 0
  - path: src/features/today/MiniEntry.tsx
    op: create
    bytes_added: 1600
    bytes_removed: 0
  - path: src/features/today/WeekChart.tsx
    op: create
    bytes_added: 1100
    bytes_removed: 0
  - path: src/features/today/AgentBreakdown.tsx
    op: create
    bytes_added: 1700
    bytes_removed: 0
  - path: src/features/today/NextTasks.tsx
    op: create
    bytes_added: 1100
    bytes_removed: 0
  - path: src/features/today/agentColor.ts
    op: create
    bytes_added: 1300
    bytes_removed: 0
  - path: src/features/oculpm/triggerMeta.tsx
    op: create
    bytes_added: 1700
    bytes_removed: 0
  - path: src/__tests__/today_v2.test.tsx
    op: create
    bytes_added: 6500
    bytes_removed: 0
  - path: src/features/shell/ShellV2.tsx
    op: update
    bytes_added: 2400
    bytes_removed: 900
  - path: src/styles/screens.css
    op: update
    bytes_added: 5200
    bytes_removed: 200
  - path: src/components/Icons.tsx
    op: update
    bytes_added: 350
    bytes_removed: 0
related:
  - "../Features_to_add/1826_feature_pr-ui1-sidebar-shell-theme.md"
tags: ["ui-v2", "final-ui-update", "pr-ui2", "today", "dashboard", "frontend-aggregation"]
---

## 추가 기능

Final UI Update 라운드 **PR-UI 2 — Today 6-블록 대시보드**. flag-on(ui_v2)일 때 ShellV2 가 Today 화면에 목업의 6블록 대시보드(hero · 4 stat · 하이라이트 · 어제 마무리 · 주간 차트 · 에이전트별 기여 · 다음 할 일)를 마운트. flag-off 의 레거시 `TodayScreen.tsx` 는 무변경.

- `useTodayBrief.ts` — Today brief 데이터 훅. **백엔드 무변경** (Decision F): 신규 command 대신 기존 `oculpm_list_journal_entries` 로 최근 7 워크데이를 list 후 프론트에서 4 stat + 주간차트 + 하이라이트 집계. 라인 수(+/-)만 Summary 에 없어 오늘 entry 만 `getJournalEntry` hydrate.
- 6 컴포넌트: StatCard / MiniEntry / WeekChart / AgentBreakdown / NextTasks + 보조(agentColor 데이터색, triggerMeta trigger 메타).
- `ShellV2` 를 화면 라우터로 리팩터 — 각 화면이 자체 Toolbar 렌더. Today 만 V2, 나머지 placeholder.
- screens.css 에 목업의 .today-/.stat-/.week-/.agent-/.mini-entry/.next- 포팅 (+ skeleton).

## 동작 흐름

- ShellV2 가 `uiV2View === "today"` + projectId 있으면 `<TodayScreenV2>`. workday = workdayKey ?? oculpmStatus.current_workday.
- stat: 작업수=entries.length, 파일수=Σfiles_count, 에러사이클=type==="error" 수, 에이전트수=distinct agent_id.
- MiniEntry/오늘변경검토/전체일지/코드검색/Planner 클릭 → 각 uiV2View 로 onNavigate.
- 빈 날 → empty-hint. 에러 → 재시도 카드.

## 검증

- `pnpm typecheck` 0, `pnpm test` **71 passed | 3 todo** (PR-UI 1 의 63 → +8 today_v2: stat 집계 2 + nav 3 + empty 1 + a11y 1 + ...), `pnpm lint` 0, `pnpm build` 0.
- **토큰 격리 유지**: 메인 번들 css 녹색 `#12a06b` 0개 + Today 클래스(.stat/.today-hero/.week-bar/.mini-entry) 0개. 전부 ShellV2 lazy 청크(12.16KB)에 격리.
- src-tauri 무변경 확인 (백엔드 0 변경).
- axe-core: icon+text 버튼 3개(search-box/모두보기/Planner)에 aria-label 추가로 button-name 위반 0.

## 메모

- 새 결정 (Decision F: 프론트 집계 백엔드 무변경) + uiV2View 라우팅 / NextTasks 빈상태 / trigger 명명 → §0.8 잠금.
- stat "변경된 파일" sub 는 byte delta("+N −N 바이트") — 목업의 "라인"은 백엔드가 라인수 미제공이라 byte 로. PR-UI 4(diff) 에서 라인 단위 재검토 가능.
- MiniEntry focus highlight 는 PR-UI 3(JournalScreen)에서 route.params.focus 로 완성.
- 다음 PR-UI 3 (작업 일지 timeline): JournalScreen + scope-chip 6종 + focus highlight + ⌘F.
