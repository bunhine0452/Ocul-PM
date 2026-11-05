---
schema_version: 1
type: bug
slug: "nested-repo-gitignore"
status: done
difficulty: medium
created_at: "2026-11-05T23:43:35+09:00"
session_id: "20261105-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "46e12a9f-7d29-4721-bc44-5366494409bc"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/watcher_queue.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/handle.rs"
    op: update
  - path: "src-tauri/src/baseline.rs"
    op: update
  - path: "src-tauri/src/commands/window/watchers.rs"
    op: update
  - path: "src-tauri/tests/nested_gitignore.rs"
    op: create
related:
  - ref: "20261024/Bugs/2248_bug_linux-inotify-new-dir-backfill.md"
    kind: "followup"
tags:
  - "워처"
  - "watcher"
  - "perf"
  - "mcp-tool"
---
[x] 워처: 하위 저장소 gitignore 도 따른다

## 발생 원인
`ProjectGitignore` 는 루트 `.gitignore` 하나만 읽었다. 프로젝트 폴더 아래에 저장소가 따로 있으면 그 저장소의 규칙이 먹지 않았다. 예: project_naeri 는 루트가 git 이 아니고 `naeri/` 가 저장소다.

- 설치본 DB 실측: `file_snapshots` 에서 `naeri/` 983장 중 976장이 `naeri/.gitignore` 가 거르는 파일이었다. 그중 972장이 `.llm-cache/*.sse` 다.
- 평가를 돌릴 때마다 캐시 쓰기가 워처 이벤트와 스냅샷 DB 쓰기(최대 500KB)가 됐다.

## 해결 방법
- `ProjectGitignore` 가 판정할 경로의 부모 폴더부터 루트까지 각 층의 `.gitignore` 를 본다. 폴더마다 한 번 읽고, 없음도 기억한다.
- git 처럼 깊은 층부터 묻고, 처음 답(무시 · 예외 `!`)을 준 층이 이긴다.
- 워처는 어느 층이든 `.gitignore` 이벤트가 오면 그 폴더 캐시만 잊는다(`invalidate`). 예전의 루트 전용 `reload` 를 대신한다.
- 기동 정리 `baseline::prune` 이 같은 매처를 받아, 이미 쌓인 무시 대상 사본을 걷는다. 프로젝트 config 의 `respect_gitignore` 를 따른다.

## 검증
- `cargo test` 1113 passed. 새 `tests/nested_gitignore.rs` 4건, `prune_drops_snapshots_a_nested_gitignore_excludes` 포함
- `git check-ignore` 로 실측 비율 확인(976/983), clippy -D warnings 0 · fmt 0