---
schema_version: 1
type: feature
slug: workday-brief
status: done
difficulty: high
created_at: "2026-07-06T23:40:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/oculpm/cache.rs
    op: update
  - path: src-tauri/src/db.rs
    op: update
  - path: src-tauri/src/commands/summary.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/features/today/useTodayBrief.ts
    op: update
  - path: src/features/today/useTodayMonitor.ts
    op: update
  - path: src/features/today/useNextTasks.ts
    op: delete
  - path: src/features/today/TodayScreenV2.tsx
    op: update
  - path: src/features/today/NextTasks.tsx
    op: update
  - path: src/features/oculpm/useJournalDays.ts
    op: update
  - path: src/__tests__/today_v2.test.tsx
    op: update
  - path: src/__tests__/journal_v2.test.tsx
    op: update
  - path: src/lib/bindings.ts
    op: update
related: []
tags: ["v2-release", "U12", "N3", "performance", "ipc"]
---

[x] U12 workday brief 단일 집계 — Today 오픈 IPC 12+N회 → 3회

## 추가 기능

- **`oculpm_workday_brief(project_id, workdays[], bytes_workday?)`** — 서버측 fan-in 커맨드: ① 워크데이 버킷별 일지 요약(기존 list_journal_entries 재사용, ≤62일 캡), ② 지정 워크데이의 bytes 합(신규 `JournalCache::workday_bytes` — oculpm_journal_files SUM 한 방, 기존엔 엔트리당 `get_journal_entry` N회), ③ 활성 플랜 미완 항목(확장된 `OpenPlanItem` — plan_id/item_id/phase 추가, 진행중 우선 정렬), ④ 총 일지 수(신규 `count_entries` — 365일 히트맵 전체 수신 대체).
- **Today 재배선**: `useTodayBrief` 가 brief 1콜로 주간 차트·하이라이트·bytes·"다음 할 일"·총계를 모두 파생. `useNextTasks`(planList+planGet×N) **삭제**, `useTodayMonitor` 의 overviewStats(365) 제거(totalEntries 는 brief 에서 주입). Today 오픈 IPC: **[list×7 + getEntry×N + planList + planGet×N + overviewStats] → [brief + sessions + gitHeadStatusBrief (+커밋그래프용 gitLog 유지)]**.
- **저널 타임라인**: `useJournalDays` 윈도우 로드도 같은 커맨드(14키 1콜) — 기존 14회 IPC 제거. 전체기간/필터 경로는 기존 단일 쿼리 유지.

## 동작 흐름

Today 마운트 → brief 1회 왕복으로 6블록 전부 채움. SQL 비용은 기존과 동일(서버 루프) — 제거된 것은 IPC 왕복·직렬화·스케줄링 오버헤드.

## 검증

- cargo 344 passed (bindings 재생성: WorkdayBrief/WorkdayBucket/OpenPlanItem 확장).
- today_v2/journal_v2 mock 을 brief 로 이전(bytes 는 구 per-entry 하이드레이션과 동일 수치 계약 유지) — 17/17 그린, 전체 vitest 135 그린.
- 게이트: typecheck=0 / test=0 / lint=0 / build=0.
