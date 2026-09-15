---
schema_version: 1
type: refactor
slug: "split-git-rs"
status: done
difficulty: medium
created_at: "2026-09-15T22:56:49+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git.rs"
    op: delete
  - path: "src-tauri/src/git/mod.rs"
    op: create
  - path: "src-tauri/src/git/repo.rs"
    op: create
  - path: "src-tauri/src/git/history.rs"
    op: create
  - path: "src-tauri/src/git/changelog.rs"
    op: create
  - path: "src-tauri/src/git/status.rs"
    op: create
  - path: "src-tauri/src/git/changes.rs"
    op: create
  - path: "src-tauri/src/git/diff.rs"
    op: create
  - path: "src-tauri/src/git/blob.rs"
    op: create
  - path: "src-tauri/src/git/gutter.rs"
    op: create
  - path: "src-tauri/src/git/tests.rs"
    op: create
related: []
tags:
  - "refactor"
  - "file-size-debt"
  - "git"
  - "optimization-round-2"
  - "parallel-session"
  - "mcp-tool"
---
[x] git.rs 1,580줄을 책임별 모듈 git/ 로 — 공개 경로 불변, 다중집합 diff 로 순수 이동 증명

## 동기

최적화 원장 §2.3 `{#file-size-debt}` — 래칫은 악화만 막아 잔고가 스스로 줄지 않는다. 상위 7 중 `git.rs`(1,580줄). 병렬 세션 G 가 worktree 에서 구현, 커밋 `fc28e904`.

## 변경 요약

`git.rs` 삭제 → `git/` 10파일(기존 `nesting.rs` 무변경): `mod.rs` 51(책임표·`pub use` 재수출) · `repo.rs` 196(primary_repo·repo_root_for 캐시·run_git·discover_repos) · `history.rs` 243(log·graph·backfill) · `changelog.rs` 202(tags·log_range·read_changelog) · `status.rs` 154 · `changes.rs` 157(uncommitted·last_commit·range) · `diff.rs` 250(diff_patch·render·truncate) · `blob.rs` 63 · `gutter.rs` 147(line_changes) · `tests.rs` 232(15 테스트 그대로). 전부 ≤800.

- 공개 경로 `crate::git::*` 불변 — `lib.rs`·`bindings.ts` 무변경.
- 가시성 변경은 `fn`→`pub(super) fn` 5개(run_git·repo_relative·discover_repos·is_repo·porcelain_op)뿐. `split_multi_diff` 는 `pub(crate)` 로 두고 재수출하지 않음(재수출 시 비테스트 빌드 unused-import → clippy 실패, 크레이트 밖 사용처 0).
- **순수 이동 증명**: 원본과 새 파일들의 비어 있지 않은 줄을 다중집합으로 diff — 차이는 `//!` 헤더·`mod`/`use`/`pub use` 줄·위 가시성 5건뿐. 본문·시그니처·derive·doc 한 줄도 안 바뀜.

## 검증

- `cargo test --lib git::` 21(15+nesting 6) · `--test local_diff` 7 · `--test nested_repo_paths` 2 · `egress_inventory git_stays_local_only`(Command::new("git") 스캐너가 새 파일을 잡음) 통과.
- `export_bindings_typescript` → bindings.ts diff 0줄. `cargo fmt --check`·`clippy -D warnings`·`check-file-sizes.mjs` 통과.
- 합류 주의: 다른 세션이 `git.rs` 를 건드리면 삭제 파일과 충돌 — 이 라운드엔 없음.