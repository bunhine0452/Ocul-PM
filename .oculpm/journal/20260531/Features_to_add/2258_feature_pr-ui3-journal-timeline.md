---
schema_version: 1
type: feature
slug: pr-ui3-journal-timeline
status: done
difficulty: medium
created_at: "2026-05-31T22:58:09+09:00"
updated_at: "2026-05-31T22:58:09+09:00"
session_id: "20260531-m04"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/oculpm/JournalScreenV2.tsx
    op: create
    bytes_added: 7400
    bytes_removed: 0
  - path: src/features/oculpm/JournalCardV2.tsx
    op: create
    bytes_added: 2700
    bytes_removed: 0
  - path: src/features/oculpm/useJournalDays.ts
    op: create
    bytes_added: 3500
    bytes_removed: 0
  - path: src/__tests__/journal_v2.test.tsx
    op: create
    bytes_added: 5600
    bytes_removed: 0
  - path: src/features/shell/ShellV2.tsx
    op: update
    bytes_added: 2600
    bytes_removed: 1200
  - path: src/features/today/TodayScreenV2.tsx
    op: update
    bytes_added: 700
    bytes_removed: 600
  - path: src/styles/screens.css
    op: update
    bytes_added: 2400
    bytes_removed: 0
  - path: src/components/Icons.tsx
    op: update
    bytes_added: 90
    bytes_removed: 0
related:
  - "../Features_to_add/2235_feature_pr-ui2-today-dashboard.md"
tags: ["ui-v2", "final-ui-update", "pr-ui3", "journal", "timeline", "focus-highlight"]
---

## 추가 기능

Final UI Update 라운드 **PR-UI 3 — 작업 일지 timeline**. flag-on 일 때 ShellV2 가 작업 일지 화면에 목업의 day-label timeline 을 마운트. flag-off 의 레거시 TimelineView/JournalEntryCard 는 무변경.

- `useJournalDays.ts` — 최근 14 워크데이를 list 후 day 별 그룹핑 (프론트 집계, Decision F, 백엔드 무변경). entry 있는 날만 newest-first 반환.
- `JournalCardV2.tsx` — 목업 `.jcard` 톤 카드 (trigger badge + agent + time + 파일수 + tags). focused 시 1.6s accent ring + scrollIntoView. 레거시 `JournalEntryCard.tsx` 와 별개 (§0.9).
- `JournalScreenV2.tsx` — Toolbar(검색박스 + scope-chip 6종) + day-label + `.tl` timeline. scope-chip → `WorkspaceContext.journalFilter` 영속. ⌘F → in-page 검색 focus (title+slug+tags). trigger 색 dot.
- ShellV2 — journal 라우팅 + Today→Journal focus 핸드오프(로컬 state) + journal card → diff 핸드오프(`diffActivePath` park).
- screens.css 에 목업 .day-label/.tl/.tl-dot/.jcard/.file-pill/.cycle-flag/.tag 포팅.

## 동작 흐름

- Today 하이라이트/어제 MiniEntry 클릭 → ShellV2 `setJournalFocus(path)` + view="journal" → JournalCardV2 가 focused=true 로 ring.
- scope-chip(전체/기능/버그/리팩토링/에러/잡일) → journalFilter. JournalFilter "bugfix" ↔ EntryType "bug" 는 FILTER_TO_TYPE 로 매핑.
- ⌘F → 검색박스 focus(stopPropagation). 검색은 title+slug+tags substring.
- 카드 클릭 → diffActivePath 설정 + diff 화면 (PR-UI 4 소비).

## 검증

- `pnpm typecheck` 0, `pnpm test` **75 passed | 3 todo** (PR-UI 2 의 69 → +6 journal_v2: 그룹핑/scope필터/검색/diff열기/빈상태/a11y), `pnpm lint` 0, `pnpm build` 0.
- 토큰 격리 유지: 메인 번들 녹색 `#12a06b` 0개 + Journal 클래스(.jcard/.tl-dot/.day-label) 0개 → 전부 ShellV2 청크.
- src-tauri 무변경.

## 메모

- 새 결정 → §0.9 (V2 신규 vs 레거시 재사용 / focus=ShellV2 로컬 state / ⌘N 보류 / diff 핸드오프).
- ⌘N ManualEntry 는 레거시 shadcn 모달이라 보류 — PR-UI 5/6 에서 ui_v2 모달 패턴 정립 후 연결 (DoD 1 항목 보류).
- 다음 PR-UI 4 (변경 diff): LocalDiffView 흡수 + DiffScreen 2-pane + diffActivePath pre-select.
