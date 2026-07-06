---
schema_version: 1
type: chore
slug: v2-master-plan-docs
status: done
difficulty: low
created_at: "2026-07-06T21:20:30+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: docs/20260706_v2/00-master-plan.md
    op: create
  - path: docs/20260706_v2/01-ux-spec.md
    op: create
  - path: docs/20260706_v2/02-features-spec.md
    op: create
  - path: docs/20260706_v2/03-performance-spec.md
    op: create
  - path: .oculpm/planner/v2-release.md
    op: create
related: []
tags: ["v2-release", "design-doc", "planner", "roadmap"]
---

[x] v2.0.0 대규모 업데이트 설계 문서 세트 + 플래너 등록

## 배경

1.x(1.12~1.20)로 기록·정합성 축이 완성됨. 코드베이스 실사(3방향 병렬 조사: UI/UX 현황·성능/자원·백로그)에서 확인된 기회를 2.0.0 으로 묶는다: ① 키보드 퍼스트 UX(팔레트 누락 3화면·⌘번호 불일치·포커스 트랩 전무), ② "되돌려주기" 기능(C1 스탠드업/PR, 엔티티 점프), ③ 실측 성능 병목 2개(WorkspaceContext 매 렌더 새 value+watcher 이벤트마다 전체 직렬화, Today IPC 12+N 팬아웃) + 구조 개선(FTS5, lazy 분할).

## 한 일

`docs/20260706_v2/` 설계 세트 4종 + 플래너 `v2-release` 등록:
- 00 마스터플랜 — 3축 목표, U1~U13 유닛 표(라운드 3개), 2.0.0 근거(온디스크 스키마 불변·캐시만 마이그레이션), 이월 목록(F6/P2/반응형/폰트), 리스크 완화, 릴리스 절차
- 01 UX 스펙 — navRegistry 단일 소스(순서 불일치 구조적 재발 방지), go-to-anything, Toaster 토큰화+Skeleton, 키보드 diff(j/k·o·`/`), 낙관적 업데이트, AppDialog(포커스 트랩/복원)
- 02 기능 스펙 — generate_summary(standup/pr/weekly, redacted 캐시만 사용, LLM 실패시 결정적 폴백), search_entities 계약, 에이전트 어댑터 6종 표
- 03 성능 스펙 — WorkspaceContext 수술(useSyncExternalStore 스토어 분리), lazy 분할(청크 −40% 목표), FTS5(external-content+트리거, LIKE 폴백), workday brief(IPC 3 이하 목표), 로그 retention

## 검증

설계 문서 .md 만 — 코드 변경 0. 근거 file:line 은 병렬 코드베이스 조사 결과에서 인용 (CommandPalette.tsx:79-98 누락 3화면, useGlobalShortcuts.ts:22-30 순서, WorkspaceContext.tsx:596-598/785-805/828-843, useTodayBrief.ts:163-166, db.rs:469-518 LIKE 풀스캔, ShellV2.tsx:6-15 정적 import, lib.rs:65 로그). 백로그 ID(C1/P1/N3/A1 등)는 docs/20260622_dev-report/03-next-features.md 와 대조.
