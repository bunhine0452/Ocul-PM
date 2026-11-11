---
schema_version: 1
type: refactor
slug: "sqlite-vec-only-before-043"
status: done
difficulty: low
created_at: "2026-11-11T21:40:00+09:00"
session_id: "manual-20261111-214000"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db/mod.rs"
    op: update
  - path: "src-tauri/src/db/tests.rs"
    op: update
related: []
tags:
  - "db"
  - "기동"
---
[x] DB: sqlite-vec 는 043 전 DB 에만 건다

## 변경 전 상태
`Db::open` 이 기동마다 sqlite-vec 를 SQLite 자동 확장으로 걸었다. vec0 표는 4.0 의 043(`043_drop_code_index.sql`)이 지웠고, 그 DROP 때문에만 남아 있던 등록이다 — 043 까지 올라간 DB 는 vec0 를 다시 만날 일이 없다.

## 변경 후 상태
`needs_sqlite_vec(path)` 가 읽기 전용 연결로 `PRAGMA user_version` 을 보고 43 미만(파일 없음 = 새 설치 포함 — 002 가 vec0 를 만든다)일 때만 건다. 못 읽으면 예전처럼 건다(걸어서 손해는 없고, 빠뜨리면 043 의 DROP 이 실패한다). `LAST_VEC0_MIGRATION = 43` 이 실제로 vec0 를 지우는 마이그레이션을 가리키는지 테스트가 본다. 기동 순서는 그대로다.

## 검증
- `cargo test --lib sqlite_vec_is_registered_only_before_043` · `migration_043_drops_the_code_index_but_keeps_baselines` → ok
- 전체 `cargo test --no-fail-fast` → 1117 passed · 0 failed
