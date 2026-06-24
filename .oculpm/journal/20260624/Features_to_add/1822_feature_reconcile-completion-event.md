---
schema_version: 1
type: feature
slug: reconcile-completion-event
status: done
difficulty: low
created_at: "2026-06-24T18:22:13+09:00"
session_id: "20260624-m06"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
files_touched:
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/lib/bindings.ts
    op: update
related:
  - ref: 20260624/Features_to_add/1709_feature_auto-reconcile.md
    kind: followup
tags: ["feature", "auto-reconcile", "oculpm", "post-1.17-round", "F1"]
---

[x] auto-reconcile 후속 ① 완료 이벤트/토스트 (Unit C)

## 추가 기능

auto-reconcile(F1)이 백그라운드로 계획을 갱신해도 UI 피드백이 0이라 사용자가 변화를 몰랐다(다음 Planner 진입 시에야 `auto:<provider>` 귀속으로 확인). 이제 화해가 **실제로 항목을 바꾸면**(ReconcileOutcome::Applied) Tauri 이벤트를 쏘아 토스트로 알린다. 스킵·노옵은 조용히.

## 동작 흐름

- 신규 이벤트 `OculpmPlanReconciled { project_id, plan_id, applied }`(spec.rs + collect_events!). watcher `spawn_reconcile` 태스크가 Applied 일 때만 emit.
- 프런트 WorkspaceContext 리스너 → `toast.info("AI 가 계획 항목 N개를 자동 갱신했어요")`. plan_id 기준 5초 dedup(버스트 억제).

## 검증

- 백엔드 cargo build clean + test 289. 이벤트 추가로 bindings 재생성. 프런트 typecheck/test/lint/build 전부 exit 0.

## 메모

- Planner 화면 라이브 갱신은 미포함(토스트로 충분, 다음 진입 시 디스크 재투영). auto-reconcile 후속 D(N4 공유락)·E(다중 활성 플랜)는 별도 단위.
