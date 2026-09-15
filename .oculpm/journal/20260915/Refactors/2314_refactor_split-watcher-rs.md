---
schema_version: 1
type: refactor
slug: "split-watcher-rs"
status: done
difficulty: medium
created_at: "2026-09-15T23:14:14+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: delete
  - path: "src-tauri/src/oculpm/watcher/mod.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher/handle.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher/hooks.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher/journal.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher/adapters.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher/emit.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher/classify.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher/tests.rs"
    op: create
related: []
tags:
  - "refactor"
  - "file-size-debt"
  - "watcher"
  - "optimization-round-2"
  - "parallel-session"
  - "mcp-tool"
---
[x] oculpm/watcher.rs 2,161줄을 책임별 watcher/ 8모듈로 — 공개 경로 불변, watcher_queue 는 그대로

## 동기

최적화 원장 §2.3 `{#file-size-debt}` 상위 7 중 `oculpm/watcher.rs`(2,161줄, fs 워처 핵심). 병렬 세션 WT 가 worktree 에서 구현, 커밋 `a0f6d9d7`.

## 변경 요약

`watcher.rs` 삭제 → `oculpm/watcher/` 8파일: `mod.rs` 295(문서 헤더·모듈 지도·`ProjectWatcher` start/stop/abort/status·`watcher_queue`/`supervisor` 가 쓰는 `is_rules_path`·`is_self_suppressed` 재수출) · `handle.rs` 520(`WatcherInner`·`WatcherSink`·`resync_after_drops`·1~10단계 `handle_event`·should_track/is_forbidden/classify·통계) · `hooks.rs` 172(Claude 훅 인박스·일지 초안) · `journal.rs` 357(캐시 무효화·entry diffs·라인 수·플랜 화해·JournalAdded/Updated) · `adapters.rs` 94(캐스케이드 resync·drift) · `emit.rs` 79 · `classify.rs` 207(순수 술어) · `tests.rs` 539(16개 그대로). 전부 ≤800.

- `lib.rs`·`bindings.ts` 무변경. `watcher_queue.rs` 는 접지 않음.
- 이동 외 수정 하나: `is_directory_event` 위에 잘못 붙어 있던 doc 주석을 `is_agent_state_path` 로 되돌림.

## 검증

- `cargo test --lib oculpm::watcher` 16 · `--test watcher_backpressure` 14 · `oculpm_lock_scope` 8 · `egress_inventory` 11 · `lite_w6_safety_net` 6 · `oculpm::supervisor` 12 통과. `export_bindings_typescript` 무변경. `cargo fmt --check`·`clippy -D warnings`·`check-file-sizes.mjs` clean.
- 이어서 같은 세션이 #scheduling-telemetry 구현(별도 일지).