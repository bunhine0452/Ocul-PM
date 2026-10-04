---
schema_version: 1
type: bug
slug: "indexer-non-utf8-head"
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
  - path: "src-tauri/src/indexer.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_tasks.rs"
    op: update
related:
  - ref: "20260924/Bugs/0230_bug_port-fs-semantics-lfs.md"
    kind: "followup"
tags:
  - "indexer"
  - "watcher"
  - "logging"
  - "mcp-tool"
---
[x] PDF·비 UTF-8 텍스트가 NUL 탐침을 지나 자동 색인에서 WARN 으로 터지던 것

## 발생 원인
설치본 로그 2026-09-30: `auto-index: reindex skipped … .pdf reason=ReadFailed { "stream did not contain valid UTF-8" }` 가 변경마다 WARN 으로 반복. `looks_binary` 는 머리 1KB 의 NUL 만 봤는데, PDF 는 `%PDF-1.7` + 고바이트 주석 줄로 시작해 NUL 이 없다 → 경로 판정을 통과하고 `read_to_string` 에서 실패.

## 해결 방법
- `looks_binary` 가 머리 1KB 의 UTF-8 유효성도 본다. 탐침 끝에서 잘린 멀티바이트 한 글자(`error_len() == None`)는 봐준다. EUC-KR 텍스트도 여기서 걸린다 — 어차피 String 으로 못 읽는다.
- 머리 뒤에서 깨지는 드문 경우는 `is_vanished` 와 같은 일상 건너뜀(debug)으로.
- 로그의 같은 경로 두 줄은 디바운서 중복(873건 중 5건)이라 경로 락은 두지 않았다.

## 검증
`watcher_tasks::tests::non_utf8_heads_are_not_indexable` (PDF 머리·EUC-KR·경계에서 잘린 한글) 통과. indexer.rs 줄 수 불변(래칫).