---
schema_version: 1
type: refactor
slug: "split-code-rs"
status: done
difficulty: medium
created_at: "2026-09-15T23:03:33+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/code.rs"
    op: delete
  - path: "src-tauri/src/commands/code/mod.rs"
    op: create
  - path: "src-tauri/src/commands/code/tree.rs"
    op: create
  - path: "src-tauri/src/commands/code/read_write.rs"
    op: create
  - path: "src-tauri/src/commands/code/import.rs"
    op: create
  - path: "src-tauri/src/commands/code/mutate.rs"
    op: create
  - path: "src-tauri/src/commands/code/compare.rs"
    op: create
  - path: "src-tauri/src/commands/code/search.rs"
    op: create
  - path: "src-tauri/src/commands/code/guards.rs"
    op: create
  - path: "src-tauri/src/commands/code/tests.rs"
    op: create
related: []
tags:
  - "refactor"
  - "file-size-debt"
  - "code"
  - "optimization-round-2"
  - "parallel-session"
  - "mcp-tool"
---
[x] commands/code.rs 2,251줄을 책임별 code/ 9모듈로 — 글롭 재수출로 가시성 그대로, bindings 0줄

## 동기

최적화 원장 §2.3 `{#file-size-debt}` 상위 7 중 `commands/code.rs`(2,251줄, 코드 화면 커맨드 면). 병렬 세션 C 가 worktree 에서 구현, 커밋 `c583b727`.

## 변경 요약

`code.rs` 삭제 → `commands/code/` 9파일: `mod.rs` 49(원본 헤더·선언·글롭 재수출·`project_root`) · `tree.rs` 275(code_tree/code_dir·정렬·상한) · `read_write.rs` 237(read/asset/write·binary 판정·`WRITE_LOCK`) · `import.rs` 264(import/clipboard·Budget·재귀 복사·macOS 페이스트보드) · `mutate.rs` 189(create/mkdir/rename/delete→휴지통) · `compare.rs` 47(file_entries/head_content — CodePane 인라인 비교) · `search.rs` 441(전역 검색·치환·UTF-16 좌표) · `guards.rs` 100(`canonical_within_root`·`normalize_rel`·`resolve_for_mutation`) · `tests.rs` 770(39개 그대로, 4칸 dedent 만). 전부 ≤800.

- **재수출은 글롭**(`pub use tree::*` … `pub(crate) use guards::*`): `commands` 가 `lib.rs` 의 private mod 라 크레이트 안에서 아무도 안 부르는 타입을 항목별 `pub use` 하면 `-D unused_imports` 에 걸린다. 글롭은 각 항목을 원래 가시성 그대로 실어 나른다(`commands/mod.rs`·`mcp/tools/mod.rs` 관용구).
- `lib.rs`·`bindings.ts` 무변경(`export_bindings_typescript` 재생성 diff 0줄). 유일한 외부 import 인 `code_history.rs` 무접촉.
- 정렬 줄 diff: `pub(super)` 접두·`pub use` 줄·rustfmt 재줄바꿈 2건 외 동일. 비-커맨드 항목의 rustdoc 링크 3개(`[secure_join]`)는 경로를 명시해 렌더 동일; 커맨드 doc 은 bindings.ts JSDoc 으로 나가므로 원문 유지. 섹션 구분선 3개는 모듈 헤더로 대체.

## 검증

- `cargo test --lib commands::code` **39/39**(원본과 동일) · `export_bindings_typescript` 0줄 · `egress_inventory` 11/11(트리 스캔, code 는 아웃바운드 없음) · `cargo fmt --check`·`clippy -D warnings`·`check-file-sizes.mjs` 통과. `src-tauri/tests/` 에 code_* 참조 없음.
- 남은 것: `tests.rs` 770 은 여유 30줄 — 다음 테스트 추가 때 `code/tests/` 로 주제별 분할.