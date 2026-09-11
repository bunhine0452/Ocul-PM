---
schema_version: 1
type: bug
slug: changelog-export-param-mismatch
status: done
difficulty: medium
created_at: "2026-05-22T20:55:00+09:00"
updated_at: "2026-05-22T21:08:14+09:00"
session_id: "20260522-001"
agent:
  id: claude-code
  version: "opus-4.7"
  session: "cb342a36-cd70-496a-a17b-ae516eb30c04"
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db.rs"
    op: update
    bytes_added: 42
    bytes_removed: 18
related:
  - ref: "20260522/Bugs/2050_bug_diff.md"
    kind: followup
tags: ["changelog", "sqlite"]
---
[x] Changelog Export 파라미터 불일치

## 발생 원인
대충 SQL 빌더가 분기 안 함.

## 해결 방법
분기 추가.
