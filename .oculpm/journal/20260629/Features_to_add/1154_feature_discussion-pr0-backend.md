---
schema_version: 1
type: feature
slug: discussion-pr0-backend
status: done
difficulty: medium
created_at: "2026-06-29T11:54:12+09:00"
session_id: "20260629-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/migrations/024_oculpm_discussion.sql
    op: create
  - path: src-tauri/src/oculpm/discussion/parse.rs
    op: create
  - path: src-tauri/src/oculpm/discussion/project.rs
    op: create
  - path: src-tauri/src/oculpm/discussion/mod.rs
    op: create
  - path: src-tauri/src/commands/discussion.rs
    op: create
  - path: src-tauri/src/oculpm/paths.rs
    op: update
  - path: src-tauri/src/oculpm/mod.rs
    op: update
  - path: src-tauri/src/commands/mod.rs
    op: update
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/src/db.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
related:
  - ../Chores/1140_chore_discussion-feature-design-docs.md
tags: ["discussion-feature", "PR-DISC-0", "oculpm", "backend"]
---

[x] 문제 해결(Discussion) PR-DISC 0 — 백엔드 기반 (스키마·파서·투영·watcher·읽기 커맨드)

## 추가 기능

`.oculpm/discussion/<slug>/discussion.md` SSOT 를 읽어 SQLite 캐시로 투영하고 프런트에 노출하는 읽기 측 기반. 플래너(016/parse/project)를 정확히 미러.

- **migration 024** — `oculpm_discussions` / `oculpm_discussion_log` / `oculpm_discussion_attachments` 3테이블 (재구축 가능 캐시). db.rs MIGRATIONS 에 등록.
- **paths.rs** — `discussion_root`/`discussion_dir`/`discussion_path`/`discussion_attachments_dir` (폴더-per-discussion).
- **oculpm/discussion/parse.rs** — `discussion.md → ParsedDiscussion` 관용 파서: frontmatter(status open/resolved/archived, tags, resolution_ref), 섹션(문제정의/배경/후보안 `### {#id}`/결론/다음단계 `- [ ] {#id}`), 토의 로그 managed block(`oculpm:discussion-log`). 깨진 입력 무패닉 + warnings.
- **oculpm/discussion/project.rs** — `DiscussionCache` 투영(reproject-on-read) + DTO + 첨부 사이드카 dir 스캔 + `_archive/` 포함 로드 + redact 적용.
- **commands/discussion.rs** — `discussion_list` / `discussion_get` (+ lib.rs collect_commands 등록 → bindings.ts 재생성).
- **watcher.rs** — `.oculpm/discussion/**` 분기(플래너처럼 코드변경 ndjson 오염 방지, 투영은 on-read).

## 동작 흐름

`discussion_list/get` → `discussion_root_of(project)` → `DiscussionCache::reproject_all`(디스크 전체 파싱 → 3테이블 DELETE+INSERT) → DTO 반환. 마크다운이 진실, SQLite 는 파생. watcher 는 단락 처리(라이브-push 는 PR-DISC 3 이월).

## 검증

- `cargo test --lib discussion` — parse 10건(전체 파싱/resolution_ref/title fallback/옵션 id 생성/wrap/중복 dedup/무프론트매터/unknown status/fuzz) + project 2건(round-trip list/get·첨부, `_archive` 리스팅) 전부 green.
- `cargo test` 전체 302 lib pass (기존 290 + 신규 12), 통합 스위트 green, bindings.ts 재생성(discussionList/discussionGet + DTO 확인).
- 프런트 typecheck 0 / lint 0 / test 121 / build 성공.
