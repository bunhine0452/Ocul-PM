---
schema_version: 1
type: feature
slug: planner-optimistic-toggle
status: done
difficulty: low
created_at: "2026-07-06T22:36:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/planner/PlannerScreenV2.tsx
    op: update
  - path: src/__tests__/tools_v2.test.tsx
    op: update
related: []
tags: ["v2-release", "U9", "planner", "optimistic-update"]
---

[x] U9 플래너 상태 토글 낙관적 업데이트 — busy 블로킹·전체 refetch 제거

## 추가 기능

기존: 토글마다 `busy=true → await planApplyEdit → busy=false → refreshPlans()` — 클릭할 때마다 UI 가 왕복 지연만큼 멈칫하고 연속 토글이 막혔다.

변경 (`applyStatus`):
- 글리프를 **즉시 로컬 반영** (detail.items map — phases/counts 는 detail 파생 useMemo 라 자동 추종).
- 성공 시 응답의 정규화된 detail 로 치환(planApplyEdit 이 detail 반환), 진행률 롤업(plans 목록)만 비차단 refetch.
- 실패 시 이전 detail 스냅샷으로 **롤백** + destructive 토스트.
- busy 게이트 제거 (연속 토글 즉각 반응 — 백엔드는 N4 공유 plan-write 락이 직렬화). 동일 상태 재클릭은 no-op. 추가/삭제/이름변경 등 저빈도 뮤테이션은 기존 busy 경로 유지 (스펙 §4 스코프).

## 동작 흐름

글리프 클릭 → 그 프레임에 다음 상태로 표시 → 백그라운드 기록 → (실패 시에만) 원상복구+토스트.

## 검증

- 신규 vitest 2케이스: ① planApplyEdit 영원히 pending 이어도 글리프 즉시 변경(낙관 계약), ② 에러 응답 시 원래 글리프로 롤백. tools_v2 스위트 10/10.
- 게이트: typecheck=0 / test=0 / lint=0 / build=0.
