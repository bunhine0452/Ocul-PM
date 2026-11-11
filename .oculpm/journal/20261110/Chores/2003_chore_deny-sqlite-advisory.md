---
schema_version: 1
type: chore
slug: "deny-sqlite-advisory"
status: done
difficulty: low
created_at: "2026-11-10T20:03:51+09:00"
session_id: "manual-20261110-200351"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "deny.toml"
    op: update
  - path: "src-tauri/src/commands/window/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/file_guard.rs"
    op: update
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/terminal_tests.rs"
    op: update
related:
  - ref: "20261110/Bugs/1948_bug_windows-rust-ci-red-tests.md"
    kind: "context"
tags:
  - "의존성"
  - "ci"
  - "security"
---
[x] 의존성: SQLite 공지를 사유와 함께 잠재운다

v4.9.1 커밋을 main 에 밀자 CI 가 둘로 붉었다.

- `cargo fmt --check`: 이번에 쓴 Rust 넷이 rustfmt 모양이 아니었다. 로컬 게이트(§0)에는 fmt 가 없어 못 봤다. `cargo fmt` 로 고쳤고, 바뀐 것은 그 넷뿐이었다.
- cargo-deny: 새 공지 **RUSTSEC-2026-0459**(libsqlite3-sys 0.38.2 · 번들 SQLite 3.53.x · CVE-2026-119375). 페이지 크기가 다른 `-wal` 과 DB 를 함께 열면 초기화 안 된 페이지 캐시가 읽힌다. v4.9.0 뒤에 나온 공지라 main 의 어느 커밋이든 붉다.

닿는지 봤다. 앱 · oculpm-mcp 가 여는 SQLite 는 앱 데이터 폴더의 `ocul-pm.db` 하나뿐이다(db/startup.rs · commands/config.rs · journal_search/cache.rs). 저장소나 프로젝트 안의 `.db` 는 열지 않아, 남의 저장소를 열어도 조작된 DB · WAL 짝을 건넬 길이 없다.

고친 판은 rusqlite 0.41(SQLite 3.54)인데, tokio-rusqlite 최신 0.8.0 이 rusqlite ^0.40.1 을 물어 못 올린다. deny.toml 의 정책(사유 + 해제 조건)대로 잠재웠다. 사용자 결정이다 — 자동 모드 검사기가 이 동작을 「CI 우회」 로 막아 사용자에게 물었다. 해제 조건은 tech-backlog `#rusqlite-041` 에 남겼다.

## 검증
- `cargo fmt --check` → 출력 없음(통과). `cargo test --lib --no-run` → 빌드됨
- cargo-deny 는 로컬에 없어 CI(b70b4a23) 결과로 본다 — 플랜 로그 판정 줄.
