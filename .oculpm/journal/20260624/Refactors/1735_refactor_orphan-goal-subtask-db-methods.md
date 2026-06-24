---
schema_version: 1
type: refactor
slug: orphan-goal-subtask-db-methods
status: done
difficulty: low
created_at: "2026-06-24T17:35:04+09:00"
session_id: "20260624-m04"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/db.rs
    op: update
  - path: src-tauri/tests/lite_w6_safety_net.rs
    op: update
related:
  - ref: 20260622/Refactors/1240_refactor_remove-legacy-goal-subtask-commands.md
    kind: followup
tags: ["cleanup", "dead-code", "db", "post-1.17-round"]
---

[x] 고아 goal/subtask db 메서드 5개 제거 (legacy-goal-subtask-removal 후속)

## 동기

planner-unify(S1) 로 살아있는 Plan 이 파일 기반 `.oculpm/planner/*.md` 로 옮겨가고, 그 뒤 레거시 goal/subtask **커맨드** 8개를 제거(v1.14 후속)하면서 일부 `Db` 메서드가 호출처 0인 채 남았다. `pub` 라 dead_code 경고는 안 떴지만 죽은 코드. legacy-goal-subtask-removal 일지의 deferred 후속 항목.

## 변경 요약

- 제거(grep 으로 prod·test 호출처 0 확인): `Db::update_goal` / `delete_goal` / `create_subtask` / `toggle_subtask` / `delete_subtask`.
- `tests/lite_w6_safety_net.rs` `invariant_06`: 유일하게 `delete_goal` 을 쓰던 안전망 테스트를 슬림 — delete 단언 제거, 대신 `list_subtasks` 읽기 경로를 가드(역시 보존 메서드). stale 주석(`commands::planner::*`, 이미 삭제됨) 갱신.
- **보존**: `create_goal`/`list_goals`/`get_goal`/`list_subtasks`(= `plan_migrate_goals` 일회성 가져오기 + greenfield `generate_seed_goals` 가 사용) + goals/subtasks 테이블·migration + `Goal`/`Subtask` 타입.

## 검증

- `cargo build` clean(신규 경고 0) + `cargo test` 284 통과(invariant_06 포함). 커맨드 래퍼가 없는 순수 db 메서드라 lib.rs/bindings 무변경.

## 메모

- 표면 변화 0 → 단독 릴리스 안 함. C2(.md 내보내기)와 묶어 릴리스 예정.
- `dashboard_stats` 도 호출처가 적어 보이나 이번 범위(명시된 5개) 밖이라 보존 — 별도 확인 필요 시 후속.
