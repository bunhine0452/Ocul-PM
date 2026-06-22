---
schema_version: 1
type: refactor
slug: remove-legacy-goal-subtask-commands
status: done
difficulty: low
created_at: "2026-06-22T12:40:00+09:00"
session_id: "20260622-m09"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/commands/planner.rs
    op: delete
  - path: src-tauri/src/commands/mod.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
related:
  - "20260622/Refactors/1000_refactor_planner-unify.md"
tags: ["refactor", "dead-code", "legacy-removal", "oculpm", "dev-report-followup", "planner-unify-followup"]
---

[x] 죽은 레거시 goal/subtask 백엔드 커맨드 8개 제거 (planner-unify 후속)

## 동기

직전 planner-unify(S1)로 Today·AI챗·그린필드 세 소비처가 모두 파일 기반 plan 으로 떠나면서, 레거시 SQLite goal/subtask CRUD 커맨드 8개(`goal_create/list/update/delete`, `subtask_create/list/toggle/delete`)는 호출처가 0건인 순수 죽은 코드가 됐다. 이를 제거해 `commands/planner.rs` 파일 자체를 없앤다.

## 사전 감사 (다중 에이전트 워크플로)

삭제 전 13개 에이전트 워크플로(discover→적대적 verify→synthesize)로 정밀 감사:
- **프런트 active blocker 0건** — 모든 참조는 생성된 bindings.ts, 테스트 Proxy mock 문자열, 주석뿐.
- **백엔드 내부 호출처 0건** — `commands::planner::*` 직접 호출 없음.
- **적대적 검증 8건 전부 "삭제 안전"**(refute 실패) — blocked 0.
- **인벤토리가 놓친 것**을 verify 가 포착: `commands/mod.rs` 의 `pub mod planner;` + `pub use planner::*;` 도 제거해야 빌드 성공.

## 변경 요약

- `src-tauri/src/commands/planner.rs` 전체 삭제(8개 커맨드뿐인 파일).
- `commands/mod.rs`: `pub mod planner;` / `pub use planner::*;` 제거.
- `lib.rs`: `use` 블록 + `collect_commands![]` 에서 goal/subtask 8개 등록 제거(`db_health,`·`index_project,`·plan_* 계열은 보존).
- `cargo test` 로 `bindings.ts` 재생성 → goal/subtask 커맨드 바인딩 8개 + 미사용 `Subtask` 타입 자동 드롭.

## 보존 (do-not-touch)

`goals`/`subtasks` 테이블, 마이그레이션 `001`/`003`, `plan_migrate_goals`(plan.rs, 직접 db 읽기), `migrate.rs`, `Db::list_goals`/`list_subtasks`/`create_goal`(plan_migrate_goals·overview·greenfield 가 여전히 사용), `Goal` 구조체·타입(generateSeedGoals 가 `Goal[]` 반환). `Subtask` 타입은 커맨드 경계로 반환되지 않게 돼 specta 가 드롭했고, 프런트 참조 0건이라 무해.

## 검증

typecheck/test/lint/build 전부 exit 0(125 통과). cargo build(경고 0)·cargo test 통과. bindings diff = 순삭 16줄(0 추가).

## 메모

- **후속(deferred)**: `Db::update_goal/delete_goal/create_subtask/toggle_subtask/delete_subtask` 5개 db 메서드는 이제 호출처 0이지만 `pub` 라 dead_code 경고 없음. 단 `delete_goal`·`get_goal` 은 `tests/lite_w6_safety_net.rs` 가 사용 중 → 제거하려면 그 안전망 테스트도 함께 손봐야 함. db 계층 정리는 별도 라운드로 분리.
