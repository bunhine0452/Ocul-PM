---
schema_version: 1
type: refactor
slug: query-fanin-vec-partition-git-batch
status: done
created_at: 2026-08-30T16:09:00+09:00
session_id: "manual-20260830-160900"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src-tauri/src/oculpm/cache/query.rs
    op: update
  - path: src-tauri/src/oculpm/cache/mod.rs
    op: update
  - path: src-tauri/src/oculpm/cache/tests.rs
    op: update
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/oculpm/manager/agents_sync.rs
    op: update
  - path: src-tauri/src/oculpm/manager/tests.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/api/oculpm.ts
    op: update
  - path: src/features/today/HonestyAudit.tsx
    op: update
  - path: src/__tests__/honesty_audit.test.tsx
    op: update
  - path: src-tauri/migrations/032_chunk_embeddings_partition.sql
    op: create
  - path: src-tauri/src/db/mod.rs
    op: update
  - path: src-tauri/src/db/code_index.rs
    op: update
  - path: src-tauri/src/db/tests.rs
    op: update
  - path: src-tauri/src/commands/project.rs
    op: update
  - path: src-tauri/src/commands/diff.rs
    op: update
  - path: src-tauri/src/git.rs
    op: update
  - path: src-tauri/src/oculpm/entry_diffs.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
related:
  - .oculpm/journal/20260830/Refactors/1609_refactor_entry-chunk-and-render-churn.md
tags: [performance, sqlite, sqlite-vec, git, polish-round]
---

[x] 워크데이 브리프 단일 `IN` 쿼리 · 정직성 감사 워크데이 1회 · vec0 `project_id PARTITION KEY` + 정리 후 VACUUM · 일지 diff 캡처 git 묶기

## 배경

- `oculpm_workday_brief` 가 날짜마다 `list_entries` 를 돌려 Today(7일) 17회, 일지(14일) 30회의 직렬 커넥션 왕복이었다. 정직성 감사는 세션 수만큼 `compare_layers` IPC 를 날리고 뒤에서 같은 `file_changes.ndjson` 을 세션 수만큼 다시 파싱했다.
- 의미 검색의 KNN 은 vec0 가 **전 프로젝트** 벡터를 훑은 뒤 `files.project_id` 로 걸렀다 — 큰 프로젝트가 있으면 5배 과다 조회(k)로도 내 결과가 밀려났다. 색인을 지워도 페이지는 돌아오지 않았다.
- 일지 하나의 diff 캡처는 `files_touched` 마다 `rev-parse --show-toplevel` + `git diff` 두 프로세스 — 파일 5개면 10개, 커밋된 뒤라면 25~30개.

## 변경

- `JournalCache::list_entries_for_workdays` — `build_list_sql` 이 `workday IN (…)` 을 받고(하나면 `=`), 태그·파일 수 하이드레이션도 한 번. 커맨드가 `workday` 로 버킷을 나눠 요청 순서를 보존한다. Today 17 → 5 왕복, 일지 30 → 4.
- `OculpmManager::compare_workday` + `oculpm_compare_workday` — ndjson 한 번 읽고 세션별로 갈라 `unrecorded`·severity 만 낸다(`WorkdayComparison { sessions: [SessionUnrecorded] }`). `HonestyAudit` 은 IPC 1회. `compare_layers` 는 그대로(세션 정확 필드가 필요한 곳용).
- 마이그레이션 032: `chunk_embeddings` 를 임시 표로 옮겼다가 `project_id INTEGER PARTITION KEY` 로 다시 만든다 — **임베딩 보존**(017 처럼 지우면 전 프로젝트 재색인). vec0 는 SELECT 로 f32 blob 을 그대로 내고 INSERT 도 받는다(테스트 `vec0_rows_copy_between_old_and_partitioned_tables` 가 sqlite-vec 0.1.9 에서 못 박음). `insert_chunks_with_embeddings(project_id, …)`, KNN 은 `ce.project_id = ?`. `clear_project_index`·`delete_project` 커맨드 뒤 `db.compact()`(VACUUM — 트랜잭션 밖).
- `git::diff_patches(root, paths)` — 저장소별로 묶어 `git diff --unified=3 HEAD -- a b c` 한 번, `diff --git` 머리글로 다시 가른다(`split_multi_diff`). `repo_root_for` 에 `primary_repo` 와 같은 30초 TTL 캐시. `capture_entry_diffs` 의 1단계가 이걸 쓰고, 빠진 파일만 스냅샷·히스토리·신규 파일 단계로 내려간다 — 파일 N개 2N → 1~2 프로세스.

## 검증

`cargo test` 939(신규 6: `list_entries_for_workdays_matches_per_day_reads`, `knn_search_stays_inside_the_project_partition`, `vec0_rows_copy_…`, `compare_workday_reports_unrecorded_per_session_in_one_call`, `split_multi_diff` ×2) · `cargo fmt/clippy -D warnings` · 프런트 게이트 전부 exit 0. 실기기: 기존 DB 로 앱을 열어 032 가 임베딩 수를 보존하는지(설정 → 진단 닥터의 청크 수) — 앱 꺼진 뒤 몰아서.

## 한계 / 후속

- 3단계(커밋 히스토리)·4단계(HEAD 존재)는 아직 파일별이다 — `git log --name-only -- a b c` 로 후보 커밋을 한 번에 뽑는 것이 다음.
- `run_git` 에 타임아웃이 없다(예전부터). 네트워크 FS 에서 멈추면 spawn_blocking 워커가 잡힌다.
