---
schema_version: 1
type: refactor
slug: "drop-redundant-indexes"
status: done
difficulty: verylow
created_at: "2026-11-05T23:43:36+09:00"
session_id: "20261105-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "46e12a9f-7d29-4721-bc44-5366494409bc"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/migrations/045_drop_redundant_indexes.sql"
    op: create
  - path: "src-tauri/src/db/registry.rs"
    op: update
related: []
tags:
  - "db"
  - "perf"
  - "mcp-tool"
---
[x] DB: 하는 일 없는 색인 셋을 걷는다

## 동기
설치본 DB 사본을 dbstat 으로 쟀다. 색인 셋이 같은 표의 PK · UNIQUE 색인 앞부분과 똑같았다.

- `idx_oculpm_journal_files_lookup` 1,708KB
- `idx_oculpm_journal_tags_lookup` 1,032KB
- `idx_file_snapshots_project`

읽기에 쓰이지 않고, 일지 캐시를 다시 쓸 때마다 고쳐 쓸 거리만 늘렸다.

## 변경 요약
- 마이그레이션 045 가 셋을 `DROP INDEX IF EXISTS` 하고, `MIGRATIONS` 표에 등록한다. 세 이름은 다시 쓰지 않는다.
- 태그 검색용 `idx_oculpm_journal_tags_search` 는 남긴다.

## 검증
- DB 사본에 적용한 뒤 EXPLAIN QUERY PLAN 을 봤다. (project_id, relative_path) 조회 · 프로젝트별 삭제가 PK 색인을 쓴다. VACUUM 뒤 38.1MB → 35.1MB
- cargo test 1113 passed (`migration_registry_matches_disk` 포함)