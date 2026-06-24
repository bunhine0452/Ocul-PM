---
schema_version: 1
type: refactor
slug: n4-shared-plan-write-lock
status: done
difficulty: high
created_at: "2026-06-24T18:30:58+09:00"
session_id: "20260624-m07"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
files_touched:
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src-tauri/src/commands/plan.rs
    op: update
  - path: src-tauri/src/oculpm/reconcile.rs
    op: update
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
related:
  - ref: 20260624/Features_to_add/1709_feature_auto-reconcile.md
    kind: followup
tags: ["refactor", "concurrency", "planner", "oculpm", "post-1.17-round", "N4", "auto-reconcile"]
---

[x] auto-reconcile 후속 ② N4 공유 plan-write 락 (Unit D)

## 동기

auto-reconcile 적대리뷰 should-fix #2: `reconcile_lock` 은 reconcile 끼리만 직렬화했고, 사용자 주도 plan 라이터(plan_apply_edit/set_status/rename/delete/create + plan_ai_refresh)와는 공유 락이 없어 동시 쓰기 시 last-writer-wins 유실 가능. reconcile 측 CAS 로 "자동이 사람 편집을 덮는" 위험 방향만 막았던 것을 **모든 라이터 공유 락**으로 제대로 닫는다(N4 일부).

## 동작 흐름

- `OculpmManager.plan_write_lock(project_id) -> Arc<tokio::Mutex<()>>` — 프로젝트별 lazy 생성 공유 락(managed state라 plan 커맨드·watcher 둘 다 접근).
- plan.rs 6개 쓰기 커맨드: `manager: State<OculpmManager>` 추가 + read-modify-write 구간을 락으로 감쌈. (State 주입이라 frontend bindings 불변.) plan_ai_refresh 는 user-initiated·드물어 LLM 포함 전체를 잡음(별도 CAS 없이 유실 0 보장).
- reconcile_entry: `plan_lock` 인자 추가 — **LLM 호출은 락 밖**(사용자 편집이 네트워크 콜에 안 막힘), 그 후 락 잡고 CAS 재독→write 만 원자적으로. watcher spawn_reconcile 이 manager 에서 같은 락을 받아 전달(reconcile 끼리 dedup 은 기존 try_lock 유지 = 락 2종: dedup + 공유쓰기).

## 검증

- 백엔드 cargo build clean + test 290(신규 1: 같은 프로젝트 동일 Arc·다른 프로젝트 상이·실제 배제). bindings 불변(State 주입). 프런트 게이트 전부 exit 0.

## 메모

- 비재진입(커맨드끼리 상호호출 없음)이라 데드락 위험 낮음. reconcile 은 락을 짧게(LLM 제외)만 잡아 사용자 편집을 막지 않음.
- auto-reconcile 후속 ③ "다중 활성 플랜"(E)만 남음 — 엔트리↔플랜 매칭 전략 결정 필요.
