---
schema_version: 1
type: bug
slug: diff-empty-after-commit
status: done
difficulty: medium
created_at: "2026-06-20T22:40:00+09:00"
updated_at: "2026-06-20T22:40:00+09:00"
session_id: "20260620-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/git.rs
    op: update
    bytes_added: 3081
    bytes_removed: 0
  - path: src-tauri/src/commands/diff.rs
    op: update
    bytes_added: 1847
    bytes_removed: 0
  - path: src-tauri/src/lib.rs
    op: update
    bytes_added: 161
    bytes_removed: 101
  - path: src/features/diff/DiffScreenV2.tsx
    op: update
    bytes_added: 4170
    bytes_removed: 618
related:
  - 20260620/Features_to_add/2230_feature_journal-agent-model-info.md
tags: ["diff", "git", "watcher", "dogfooding-finding"]
---

[x] 변경 diff 화면이 커밋 후 비어버리는 문제 — 직전 커밋 변경을 fallback 표시

## 발생 원인

- "변경 diff" 화면의 파일 목록은 **오직 `git status`(미커밋 변경)** + 라이브 watcher 버퍼에서 온다(`git::uncommitted_changes`).
- 따라서 작업 내용을 **커밋하면 working tree 가 깨끗해져** 목록이 비고 "변경 없음" 으로 보인다. 반면 작업 일지 diff 는 작성 시점에 `.oculpm/index/diffs/` 사이드카로 영구 저장되므로 커밋 여부와 무관하게 잘 보인다 — 이 비대칭이 "일지는 되는데 변경 diff 는 안 됨" 의 정체.
- 사용자가 의심한 "재인덱싱 때문" 은 아님: 재인덱싱은 `git status` 를 건드리지 않으므로 목록을 비울 수 없다.

## 해결 방법

- working tree 가 깨끗하면 **직전 커밋(`HEAD~1..HEAD`)의 변경**을 자동 fallback 으로 보여준다(루트 커밋이면 empty-tree 기준 → 전체 추가로 표시).
- 백엔드: `git::last_commit_changes`(sha/subject + `git diff --name-status -z` 파싱, nested-repo 인지) + `git_last_commit_changes` 커맨드 추가. `compute_diff` 에 `baseline: Option<String>` 추가 — `"last_commit"` 이면 `HEAD~1..HEAD` 패치(스냅샷 fallback 없음).
- 프런트엔드: `baseline` 상태("working"/"last_commit"). 미커밋 변경이 있으면 working, 없으면 자동으로 직전 커밋으로 전환. 툴바에 `미커밋 / 직전 커밋` 토글 + 커밋 sha·제목 표시, 빈 상태/푸터 문구를 baseline 에 맞게 갱신.

## 검증

- `cargo test` 289 passed / 0 failed (`is_recoverable_git_failure` 재사용으로 단일 커밋 repo 도 empty-tree fallback).
- `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` 전부 exit 0.
- 수동 시나리오: working tree clean 인 현재 저장소 → 직전 커밋 변경이 목록에 뜨고, 토글로 미커밋/직전 커밋 전환 확인.

## 메모

- 향후: "기본 브랜치(main) 대비" baseline 모드를 추가하면 feature 브랜치 검토에 유용(이번엔 직전 커밋만).
