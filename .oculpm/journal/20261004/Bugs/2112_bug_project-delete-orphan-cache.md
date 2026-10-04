---
schema_version: 1
type: bug
slug: "project-delete-orphan-cache"
status: done
difficulty: medium
created_at: "2026-10-04T21:12:24+09:00"
session_id: "20261004-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db/projects.rs"
    op: update
  - path: "src-tauri/src/db/registry.rs"
    op: update
  - path: "src-tauri/migrations/040_purge_orphan_project_cache.sql"
    op: create
  - path: "src-tauri/tests/project_delete_cache.rs"
    op: create
related: []
tags:
  - "db"
  - "migration"
  - "mcp-tool"
---
[x] 프로젝트를 지워도 그 일지·플랜·논의 캐시 약 1만 행이 DB 에 남던 것

## 발생 원인
`.oculpm` 캐시 표 14개(oculpm_journal·_files·_tags·plans·plan_items·…·recall_stats)는 `projects` 에 FK 가 없어 `DELETE FROM projects` 의 CASCADE 를 타지 않았다. 설치본 DB 읽기 전용 실측: 지운 프로젝트 7개의 일지 482·파일 4,318·태그 2,792·플랜 항목 1,175·갱신 1,064 등. 삭제 뒤 VACUUM 도 이 행들은 못 회수했다. id 는 AUTOINCREMENT 라 다른 프로젝트로 새지는 않는다(부피 문제).

## 해결 방법
- `db::PROJECT_CACHE_TABLES` + `delete_project` 가 한 트랜잭션에서 함께 지운다.
- `040_purge_orphan_project_cache.sql` 이 이미 남은 고아를 한 번 걷는다 (레지스트리 등록). 라이브 DB 복사본 dry-run: 일지 2,844 → 2,362, 남은 프로젝트 무손상.
- `tests/project_delete_cache.rs`: 스키마에서 'projects FK·CASCADE 없는 project_id 표' 를 뽑아 목록과 대조 — 새 캐시 표가 생기면 먼저 걸린다. 그리고 지운 프로젝트 행만 지워지는지.

## 검증
위 두 테스트 + db 단위 테스트 22 + 전체 cargo test 초록.