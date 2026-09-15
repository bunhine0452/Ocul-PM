---
schema_version: 1
type: bug
slug: "file-guard-nonce-ownership"
status: done
difficulty: medium
created_at: "2026-09-15T21:53:47+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/file_guard.rs"
    op: update
related: []
tags:
  - "concurrency"
  - "file_guard"
  - "astra-feedback"
  - "parallel-session"
  - "mcp-tool"
---
[x] file_guard 가 남의 락을 지울 수 있었다 — nonce 소유 검증·회수는 rename 뒤 확인

## 발생 원인

`FileGuard`(짧은 임계구역용 프로세스 간 문지기)의 구멍 둘 — Astra 리뷰 §12.4 가설을 코드로 확인한 것.

1. **소유 없는 Drop**: `Drop` 이 `remove_file(&self.path)` 를 무조건 했다. 10초 넘게 느렸던 원주인 A(절전·느린 FS·디버거)가 B 에게 회수당한 뒤 놓으면 B 의 락을 경로로 지워서, B 가 아직 안에 있는데 C 가 들어온다.
2. **회수 경쟁**: `is_stale()` 판정과 `remove_file()` 사이에 남이 먼저 회수하고 새 락을 만들었으면 그 **새** 락을 지웠다.

## 해결 방법

병렬 세션 R2 가 worktree 에서 구현, 커밋 `a735b85`.

- 락 파일에 `{"pid","at","nonce"}` 를 적고 `FileGuard` 가 nonce 를 쥔다. `Drop` 은 파일 안의 nonce 가 내 것일 때만 지운다 — 남의 것이면 두고 `warn`, 없으면 `debug`. 잡을 때 stamp 를 못 적으면 만든 파일을 지우고 `GuardError::Io` (nonce 없는 락은 stale 창 내내 모두를 막는다).
- 회수는 `remove_file` 대신 `rename(path, path.stale.<uuid>)` 뒤 옮긴 파일에서 나이를 다시 재고, 정말 오래됐을 때만 삭제. `NotFound` 면 남이 이미 비운 것 → `create_new` 로 진행.
- **설계 정정**: 유닉스 `rename` 은 목적지가 있으면 덮어쓰므로 "되돌려 놓기"를 rename 으로 하면 새 락을 또 덮는다 → `put_back` 은 `hard_link(staged, path)` 로, `AlreadyExists` 면 우리 사본만 지운다. 하드링크 없는 FS(exFAT)는 rename 폴백.
- 공개 API(`GuardPolicy`, `acquire`)·호출자 무변경. 락 JSON 을 읽는 곳은 이 모듈뿐임을 확인.

남은 창(POSIX 에 unlink-if-same-inode 가 없어서 못 닫는 마이크로초 단위)은 `Drop` 문서에 적어 두었다. 종전보다 엄격히 좁다.

## 검증

- `cargo test --lib file_guard` 9/9 (신규 5: drop 이 남의 락 안 지움 · 느린 주인 해제 뒤 셋째가 못 들어옴 · 살아 있던 락 되돌림 · 틈에 생긴 락에 양보 · 이미 비운 경로 진행), `oculpm::cas a2a::leases commands::discussion verdict::ledger acp::recording plan_ops entry_write` 45 통과, `plan_cas_two_process`·`plan_parallel_write` 3+5 통과.
- `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings` 통과. 합류 뒤 전체 게이트는 #merge-gates 에서.