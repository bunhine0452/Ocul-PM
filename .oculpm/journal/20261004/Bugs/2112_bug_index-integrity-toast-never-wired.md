---
schema_version: 1
type: bug
slug: "index-integrity-toast-never-wired"
status: done
difficulty: low
created_at: "2026-10-04T21:12:24+09:00"
session_id: "20261004-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/index/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/lifecycle.rs"
    op: update
related:
  - ref: "20260901/Bugs/2042_bug_import-dedupe-timezone-boundary.md"
    kind: "followup"
tags:
  - "watcher"
  - "integrity"
  - "mcp-tool"
---
[x] ndjson 손상 복구 무결성 토스트가 한 번도 뜰 수 없던 것 — IndexWriter 에 앱 핸들이 안 달림

## 발생 원인
`IndexWriter` 는 `init_project` 에서 앱 핸들 없이 만들어져 워처·세션과 `Arc` 로 공유된다. 핸들을 다는 `with_emit_ctx` 는 빌더(`self` 소비)라 공유된 뒤엔 달 수가 없었고, 실제로 호출자가 0 이었다. 그래서 손상된 `file_changes.ndjson` 꼬리를 잘라 백업해도 `OculpmIntegrityWarning` 은 언제나 no-op.

## 해결 방법
`emit_ctx` 를 `OnceLock` 으로, `attach_emit_ctx(&self, …)` 를 두고 `watcher_start_with` 가 핸들이 있을 때 한 번 단다 (먼저 단 것이 이긴다).

## 검증
cargo check/clippy/전체 테스트 초록 (기존 `integrity_warning_emit_path_safe_without_app_handle` 유지). 손상 재현의 실기기 토스트 확인은 미실시.