---
schema_version: 1
type: refactor
slug: "journal-detail-own-events"
status: done
difficulty: low
created_at: "2026-11-22T03:26:00+09:00"
session_id: "manual-20261122-031405"
agent:
  id: "claude-code"
  version: "Fable 5.2"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/oculpm/useOculpmLive.ts"
    op: update
  - path: "src/features/oculpm/JournalDetail.tsx"
    op: update
  - path: "src/__tests__/journal_detail_own_events.test.tsx"
    op: create
related: []
tags:
  - "일지-화면"
  - "journal"
  - "perf"
---
[x] 일지 화면: 상세는 그 일지의 사건에만 다시 읽는다

## 동기
열어 둔 일지 상세는 프로젝트의 어느 일지가 더해지거나 고쳐지든 본문(`getJournalEntry`)과 기록된 diff 전부(`getEntryDiffs`)를 다시 읽었다. 에이전트 여럿이 일지를 쓰는 날에는 읽고 있는 일지와 상관없는 사건마다 IPC 둘이 갔고, diff 가 큰 일지면 그 패치를 통째로 다시 받았다.

## 변경 요약
- 일지 사건 셋은 어느 일지인지를 싣고 온다. `journalEventPath` 가 그 경로를 일지 루트 기준으로 읽는다(요약의 경로 · `.oculpm/journal/…` 접두 · 역슬래시).
- 새 훅 `useJournalEntryEvents` 는 그 일지의 사건만 받는다. 경로를 못 읽은 사건은 예전처럼 다시 읽는다. 창으로 돌아올 때의 다시 읽기는 그대로다.
- `JournalDetail` 이 그 훅을 쓴다. 목록 · 총수 · 사라진 코드의 일지처럼 모든 일지를 봐야 하는 훅은 그대로 `useJournalEvents` 다.
- 늦게 끝난 diff 캡처는 `OculpmJournalPathChanged` 를 `.oculpm/journal/<경로>` 로 쏜다(`watcher/journal.rs`) — 그 사건으로 diff 가 따라오는 것을 시험이 문다.

## 검증
- 다른 일지 사건 10건 뒤 `getJournalEntry` · `getEntryDiffs` 호출: 거르기를 끄고 돌리면 11번씩(처음 1 + 10), 켜면 1번씩.
- `npx vitest run src/__tests__/journal_detail_own_events.test.tsx src/__tests__/journal_detail_layout.test.tsx src/__tests__/fix_screens_journal.test.tsx src/__tests__/journal_verified.test.tsx src/__tests__/journal_planner_copy.test.tsx src/__tests__/stale_state.test.tsx src/__tests__/journal_keyboard.test.tsx` → `Tests  63 passed (63)`
- `npx tsc --noEmit` exit 0
