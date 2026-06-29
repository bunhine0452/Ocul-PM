---
schema_version: 1
type: feature
slug: discussion-pr1-write
status: done
difficulty: medium
created_at: "2026-06-29T12:03:27+09:00"
session_id: "20260629-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/discussion/doc_edit.rs
    op: create
  - path: src-tauri/src/oculpm/discussion/mod.rs
    op: update
  - path: src-tauri/src/commands/discussion.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
related:
  - ./1154_feature_discussion-pr0-backend.md
tags: ["discussion-feature", "PR-DISC-1", "oculpm", "backend"]
---

[x] 문제 해결(Discussion) PR-DISC 1 — 마크다운 SSOT 쓰기 경로

## 추가 기능

앱에서 discussion 문서를 만들고 편집/상태전환/이름변경/삭제하는 쓰기 측. 플래너 plan_edit 패턴을 미러하되, 산문 중심이라 **본문 통째 편집(write_body)** 모델.

- **oculpm/discussion/doc_edit.rs** (순수 마크다운 수술, I/O 없음):
  - `create_discussion_skeleton` — frontmatter + 섹션 골격(문제정의/배경/후보안/토의로그 managed block/결론/다음단계). parse 무경고.
  - `write_body` — 본문(섹션) 교체 + `updated` 재스탬프, frontmatter(특히 `resolution_ref` 중첩 매핑) 보존.
  - `set_status` / `set_title` — frontmatter 필드 set + `updated` 갱신. 공통 `set_fm_field`(없으면 우선순위 위치에 삽입).
- **commands/discussion.rs** 쓰기 커맨드 5종:
  - `discussion_create`(slug 폴더 생성 + 골격), `discussion_write`(본문, closed=open아님 가드), `discussion_set_status`(open/resolved/archived + `_archive/` 폴더 물리 이동/복귀), `discussion_rename`, `discussion_delete`(폴더 단위).
- 원자성 = `atomic_io::write_atomic`. 단일 사용자 가정 → 프로세스 내 동시편집 last-write-wins(별도 락 없음, 플래너 PR-PLN 1과 동일). redact 는 투영(읽기) 측에서 적용.

## 동작 흐름

쓰기 → `find_discussion_path` → 읽기 → doc_edit 순수 변환 → `write_atomic` → (set_status 면 `_archive/` rename) → `DiscussionCache.get` 재투영 반환. 외부 에이전트 파일 직접 편집과 동일 SSOT, watcher 흡수.

## 검증

- `cargo test --lib discussion` — 신규 doc_edit 7건(skeleton 무경고/본문 교체+updated/resolution_ref 보존/status 전환+round-trip/title/삽입/무프론트매터 noop) 포함 19건 green.
- `cargo test` 전체 lib 309 pass(기존 302 + 7), bindings.ts 에 create/write/setStatus/rename/delete 5종 생성 확인.
- 프런트 typecheck 0 / lint 0 / test 121 / build 성공.
