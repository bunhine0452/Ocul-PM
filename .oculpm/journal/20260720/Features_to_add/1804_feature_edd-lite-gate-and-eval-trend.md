---
schema_version: 1
type: feature
slug: "edd-lite-gate-and-eval-trend"
status: done
difficulty: medium
created_at: "2026-07-20T18:04:04+09:00"
session_id: "mcp-20260720-180404"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/evals.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/commands/retro.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/retro/EvalTrend.tsx"
    op: create
  - path: "src/features/retro/RetroScreenV2.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/__tests__/edd_lite_v2.test.tsx"
    op: create
related: []
tags:
  - "claude-integration"
  - "edd"
  - "planner"
  - "retro"
  - "mcp-tool"
---
[x] PR-CI6 EDD-lite — 플래너 완료 소프트 게이트 + EVALS.md 점수 추이

## 추가 기능

Phase C 첫 PR — 검증(EDD)의 최소 제품화 두 조각.

- **플래너 완료 소프트 게이트**: 항목을 done 으로 바꿀 때 plan-log 에 연결된 검증 일지(`journal_refs`)가 없으면 확인 다이얼로그를 한 번 거친다. "검증 없이 완료" 로 무시 가능(소프트 — 어떤 상태도 강제하지 않음), 취소하면 무변경. 데이터는 기존 `PlanItemDto.journal_refs` 그대로라 백엔드 무변경 — `applyStatus` 단일 진입점 인터셉트.
- **회고 "Eval 추이" 카드**: 프로젝트 루트 `EVALS.md` 를 완료 정의 문서로 인식(`oculpm/evals.rs`), `## 기록` 표(`| 날짜 | 스위트 | N/M | 메모 |` — **CI5 run-evals 스킬이 쓰는 규약과 한 쌍**)를 관대 파싱해 스위트별 최근 8회 미니 추이 + 최신 점수를 렌더. 파일 없으면 커맨드가 None → 섹션 미노출, 파일만 있고 기록이 없으면 run-evals 스킬 안내. 부풀린 데이터(N&gt;M, 0/0)는 신호에서 제외.

## 동작 흐름

1. 회고 진입 → `eval_signals(project_id)` (읽기 전용, 기간 무관 문서 전체) → 신호 패널 아래 추이 카드.
2. 플래너 글리프 클릭(in_progress→done) → journal_refs 비면 게이트 다이얼로그 → 취소=무변경 / "검증 없이 완료"=`plan_apply_edit(set_status)` 진행. 일지 연결 항목은 게이트 없이 즉시.

## 검증

- `cargo test` 377 passed — 신규 evals 4건: 유효 행 파싱·날짜 정렬·스위트 수집, 섹션/메모 결측 관용, 파일 부재 None, 분수·날짜 검증(부풀림 거부).
- `pnpm test` 168 passed — 신규 `edd_lite_v2.test.tsx` 5건: EVALS 없음 미렌더/빈 기록 안내/추이 렌더+axe, 게이트 취소 무변경·무시 진행·일지 연결 시 무게이트. 도중 스토리지 린트가 테스트의 직접 localStorage 접근을 잡아 제거(규율 동작 확인).
- typecheck/lint/build exit 0.