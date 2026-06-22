---
schema_version: 1
type: feature
slug: journal-query-full-history
status: done
difficulty: medium
created_at: "2026-06-22T09:30:00+09:00"
session_id: "20260622-m07"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/oculpm/useJournalDays.ts
    op: update
  - path: src/features/oculpm/JournalScreenV2.tsx
    op: update
related: []
tags: ["feature", "journal-query", "oculpm", "dev-report-followup", "F3"]
---

[x] 백엔드 기반 저널 쿼리 + 전체 기간 검색 (F3 — 14일 한계 제거)

## 추가 기능

작업 일지 화면이 하드코딩 14일(`useJournalDays` 14콜)만 받아 그 인메모리 윈도우 안에서만 검색·필터됐다 — 14일보다 오래된 일지는 검색으로도 못 닿음. 백엔드 `EntryFilters`+`list_entries`(전체기간·필터 분기)는 **이미 완성**돼 있는데 프런트가 `filters` 를 안 넘기던 격차를 연결했다.

## 동작 흐름

- `useJournalDays`: **all-period 모드** 추가 — `allPeriod` 일 때 `listJournalEntries(projectId, null, filters)` 1콜로 전체 기간을 받아 workday 별 그룹핑. 아니면 기존 14일 윈도우(빠른 초기 로드). `filtersKey`(JSON 직렬화)로 effect 안정화.
- `JournalScreenV2`: 타입칩 + 검색 + 신규 **미완료/검증됨 토글칩** 중 하나라도 켜지면 `allPeriod` → 백엔드 `EntryFilters`(types/verified_only/unfinished_only/search) 로 **전체 기록**을 쿼리. 검색은 300ms 디바운스 후 백엔드로(인메모리 필터는 즉시 narrowing 유지). 빈 윈도우엔 **"이전 기록 더 보기 (전체 기간)"** 버튼으로 전체 로드.
- 필터 결과 0건이면 "조건에 맞는 일지가 없어요 (전체 기간 검색됨)" — 진짜 빈 프로젝트("아직 일지가 없어요"+백필)와 구분.

## 검증

- 백엔드 무변경(filters 경로 기존). 프런트 typecheck/test/lint/build 전부 exit 0(125 통과).

## 메모

- v1.13.0 으로 배포.
- MVP 범위: 타입·검색·미완료·검증됨 + 전체로드. **후속(폴리시)**: 에이전트/난이도 칩(`observed_agent_ids`/`difficulty_mix` 소스), IntersectionObserver 자동 무한스크롤(현재 "더 보기" 버튼), 필터의 `WorkspaceContext` 영속(현재 로컬 state — localStorage 스키마 버전 회피). 대용량 히스토리 가상화는 보고서 N3 별도 항목.
