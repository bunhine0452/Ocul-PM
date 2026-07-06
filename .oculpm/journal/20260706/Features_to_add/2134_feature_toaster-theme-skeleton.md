---
schema_version: 1
type: feature
slug: toaster-theme-skeleton
status: done
difficulty: low
created_at: "2026-07-06T21:34:30+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/components/ui/Skeleton.tsx
    op: create
  - path: src/components/ui/Toaster.tsx
    op: update
  - path: src/styles/screens.css
    op: update
  - path: src/features/today/TodayScreenV2.tsx
    op: update
  - path: src/features/oculpm/JournalScreenV2.tsx
    op: update
  - path: src/features/planner/PlannerScreenV2.tsx
    op: update
related: []
tags: ["v2-release", "U2", "toast", "skeleton", "loading", "theme"]
---

[x] U2 Toaster 테마 토큰화 + 콘텐츠 형태 Skeleton 로딩 (Today·일지·플래너)

## 추가 기능

- **Toaster 라이트 모드 수정**: `bg-zinc-900`/`amber-950`/`red-950` 다크 하드코딩 제거 → `bg-card border-border text-foreground` 표면 토큰 + 종류별 틴트 보더/아이콘(emerald·amber·red). 라이트/다크/프리셋 전 테마에서 주변 UI 와 일관.
- **공용 `<Skeleton>`/`<SkeletonList>`** (`components/ui/Skeleton.tsx`): 정의만 있고 미사용이던 `.skel` shimmer(screens.css)를 승격. `prefers-reduced-motion` 시 shimmer 정지 규칙 추가. 역할 구분 주석: 모양 예측 가능한 목록/카드=Skeleton, 단발 작업=OculSpinner.
- 적용 3화면: 일지 타임라인(스피너→행 4개), 플래너 목록(행 3)+상세(행 6), Today 히어로 인사말(텍스트→인라인 라인 스켈레톤).

## 동작 흐름

로딩 진입 시 콘텐츠와 같은 자리·비슷한 크기의 회색 면이 shimmer — 로드 완료 시 실제 콘텐츠로 치환되어 레이아웃 점프 없이 전환. role="status" aria-label 로 스크린리더에 로딩 알림.

## 검증

게이트: typecheck ✓ / vitest 129 ✓ / lint ✓ / build ✓. 수동 확인 항목(도그푸딩 시): 라이트 모드에서 토스트가 밝은 카드로 렌더, reduced-motion 설정 시 shimmer 정지.
