---
schema_version: 1
type: chore
slug: fmt-clippy-gates
status: done
created_at: 2026-08-30T11:21:00+09:00
session_id: "manual-20260830-112100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: .github/workflows/ci.yml
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/src/dap/spec.rs
    op: update
  - path: src-tauri/src/dap/session.rs
    op: update
  - path: src-tauri/src/git.rs
    op: update
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src-tauri/src/oculpm/planner/plan_edit.rs
    op: update
  - path: src-tauri/src/oculpm/planner/parse.rs
    op: update
  - path: src-tauri/src/oculpm/mcp/protocol.rs
    op: update
  - path: src-tauri/tests/home_brief.rs
    op: update
related: []
tags: [ci, clippy, rustfmt, audit-round]
---

[x] `cargo fmt` 를 전체에 한 번 적용하고 fmt·clippy(-D warnings)·timeout 을 CI 게이트로 잠갔다

## 왜

감사 실측: `cargo fmt --check` 차이 143/154 파일·1,090 hunk, CI 에 clippy·fmt·timeout·audit 0. 손으로 맞춘 들여쓰기가 파일마다 달라 리뷰 diff 에 스타일 잡음이 섞였고, clippy 는 아무도 돌리지 않아 경고 50건이 쌓여 있었다.

## 무엇

- `cargo fmt` 1회 전체 적용 — 154 파일, +6.4K/−2.5K 줄(스타일만). 이 커밋 뒤로는 CI 의 `cargo fmt --check` 가 막는다(캐시 복원 전에 먼저 도는 가장 싼 게이트).
- clippy 50건 → 0: `--fix` 로 19건, 나머지는 손으로 — `DapState` 에 `derive(Default)`+`#[default]`, `git.rs` 의 `is_some()`+`unwrap()` 을 `if let`, `needless_range_loop` 3곳을 `enumerate().skip()`, `let…else` → `?`, `&PathBuf`/`&mut Vec` → 슬라이스, 중복 바인딩·의미 없는 `drop` 제거, 문서 목록 들여쓰기 6곳. 구조를 바꿔야 풀리는 둘(`too_many_arguments` — 인자 8~9개 Tauri 커맨드, `type_complexity` — LSP 콜백 타입)만 `lib.rs` 상단에서 크레이트 허용. CI 는 `cargo clippy --all-targets --locked -- -D warnings`.
- 잡 timeout: 프런트 20분 · Rust 40분(콜드 실측 10분31초의 세 배 넘김 = 매달림).

## 검증

`cargo clippy --all-targets -- -D warnings` exit 0 · `cargo fmt --check` exit 0 · `cargo test` 868 + 통합 그린 · 프런트 typecheck/lint/test(1450)/build exit 0. 바인딩 무변경.

## 메모

- `cargo fmt` 는 `commands/window.rs` 도 다시 썼다 — 병렬 세션(drag-and-drop-round) 이 그 파일을 편집 중이면 옛 문맥의 Edit 가 한 번 어긋날 수 있다(내용 손실은 없다). 55분 동안 활동이 없어 진행했다.
- `cargo audit`/dependabot 은 이번 범위 밖 — 감사 항목 5 의 나머지.
