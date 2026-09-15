---
schema_version: 1
type: refactor
slug: "split-window-rs"
status: done
difficulty: medium
created_at: "2026-09-15T23:01:57+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/window.rs"
    op: delete
  - path: "src-tauri/src/commands/window/mod.rs"
    op: create
  - path: "src-tauri/src/commands/window/registry.rs"
    op: create
  - path: "src-tauri/src/commands/window/events.rs"
    op: create
  - path: "src-tauri/src/commands/window/tabs.rs"
    op: create
  - path: "src-tauri/src/commands/window/drag.rs"
    op: create
  - path: "src-tauri/src/commands/window/focus.rs"
    op: create
  - path: "src-tauri/src/commands/window/lifecycle.rs"
    op: create
  - path: "src-tauri/src/commands/window/terminal_windows.rs"
    op: create
  - path: "src-tauri/src/commands/window/session.rs"
    op: create
  - path: "src-tauri/src/commands/window/watchers.rs"
    op: create
  - path: "src-tauri/src/commands/window/tests.rs"
    op: create
  - path: "src-tauri/src/menu.rs"
    op: update
related: []
tags:
  - "refactor"
  - "file-size-debt"
  - "window"
  - "optimization-round-2"
  - "parallel-session"
  - "mcp-tool"
---
[x] commands/window.rs 3,028줄을 책임별 window/ 11모듈로 — 공개 경로 불변, menu.rs 소스 가드 경로 갱신

## 동기

최적화 원장 §2.3 `{#file-size-debt}` — 가장 큰 파일 `commands/window.rs`(3,028줄). 병렬 세션 W 가 worktree 에서 구현, 커밋 `eae3cc0e`.

## 변경 요약

`window.rs` 삭제 → `commands/window/` 11파일: `mod.rs` 131(창 모델 문서·라벨 규약·크기 상수·`WindowTabs` 관리 상태·재수출) · `registry.rs` 456(`Registry`·`Tab`·`WindowState`·`TearOff` 순수 자료구조) · `events.rs` 197(이벤트/DTO 8종 + snapshot/broadcast/emit_*) · `tabs.rs` 294(open/new/close/activate/reorder) · `drag.rs` 590(detach·drag_over·preview·drop_hint·commit_move·tear-off 5종·strip_under_cursor) · `focus.rs` 87 · `lifecycle.rs` 301(create_window·spawn·adopt·hooks·closed·release_project) · `terminal_windows.rs` 124 · `session.rs` 204(저장/복원) · `watchers.rs` 85(앱 시작 부트스트랩) · `tests.rs` 640(48개 그대로). 각 하위 모듈은 `//!` 머리말 + `use super::*;`(`oculpm/manager/` 관용구).

- 공개 경로 `crate::commands::window::*` 불변 — `lib.rs` 의 `collect_events!` 6종·`collect_commands!` 그대로, `bindings.ts` diff 없음. `pub` 항목 65개 집합 전/후 동일.
- 형제 모듈이 쓰는 `Registry` 필드 4·메서드 22 와 snapshot/broadcast/create_window 류만 `pub(super)`; `mint`·`drop_hint`·`WindowTabs::lock` 등은 private 유지.
- **손댄 파일 1**: `menu.rs` 의 `set_menu_is_reached_only_through_apply` 소스 가드가 `include_str!("commands/window.rs")` 를 하드코딩 → 새 비-테스트 파일 10개 전부 나열해 가드 강도 유지.
- 순수 이동 증명: 원본 라인 범위와 새 파일 본문을 공백 제거 후 비교 **11/11 토큰 동일** — 차이는 `pub(super)` 마커·머리말·rustfmt 가 재줄바꿈한 시그니처 3개(`move_tab`·`carry_whole`·`window_url`)의 trailing comma 뿐.

## 검증

- `cargo test --lib commands::window` **48 passed**(원본 48 과 일치) · `menu::tests` 5 · `export_bindings_typescript` → bindings 무변경 · `cargo build` 경고 0 · `clippy -D warnings`(1차는 menu.rs include_str 경로로 실패 → 수정) · `cargo fmt --check` · `check-file-sizes.mjs` clean.
- window 관련 통합 테스트 없음(`ptyhost_reattach`·`protocol` 은 주석 언급뿐).
- 오케스트레이터 메모: 병렬 세션들이 **스크래치패드 디렉터리를 공유**한다(`split.sh` 가 git 세션 스크립트로 덮임, 실행은 그 전에 끝나 무해). 다음 라운드 브리프에 세션별 접두사를 넣을 것.