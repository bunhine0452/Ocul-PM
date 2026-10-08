---
schema_version: 1
type: bug
slug: "index-boot-reconcile-secret-files"
status: done
difficulty: medium
created_at: "2026-10-08T19:06:36+09:00"
session_id: "20261008-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/project/reconcile.rs"
    op: create
  - path: "src-tauri/src/commands/window/watchers.rs"
    op: update
  - path: "src-tauri/src/indexer.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src-tauri/src/oculpm/history.rs"
    op: update
related:
  - ref: "20261007/Bugs/2026_bug_symlink-guard-general-files.md"
    kind: "followup"
tags:
  - "indexing"
  - "security"
  - "performance"
  - "mcp-tool"
---
[x] 기동 때 색인을 디스크와 맞추고, 비밀 파일은 .gitignore 와 무관하게 색인하지 않는다

## 발생 원인
- **유령 행**: `index_project` 의 화해는 걷기 결과와 대조하지만, 그 색인은 처음(청크 0, `ProjectTab.tsx`)과 수동 재색인에서만 돈다. 앱이 꺼진 사이 지워진 파일은 워처의 Delete 를 못 받아 영영 남았다. 13.1만 청크 중 1.47만(11%)이 그랬고, 사라진 `ioreum-base` 폴더 하나가 8.4k 였다. 로그상 9/24 이후 화해는 0회였다.
- **비밀 파일**: indexer 는 `.env` 를 `.gitignore` 에만 기대 걸렀다. 로컬 히스토리의 `.env` 규칙은 색인 경로의 스냅샷(`project.rs` `upsert_file_snapshot`)이 지나지 않았다. 실제로 `.env.example` 이 스냅샷에 있었다.

## 해결 방법
- `commands/project/reconcile.rs`: 색인된 경로마다 stat 만 하고, 사라진 것과 지금 규칙으로는 색인하지 않을 자리(벤더 · 캐시 폴더, 잠금 파일, 비밀 파일)를 지운다. 걷기 · 재임베딩 · gitignore 판정은 없다. `start_background_watchers` 가 워처를 켜기 직전에 프로젝트마다 부른다.
- `redact::is_secret_file_name`: .env · .env.* · .npmrc · .pypirc · .netrc · .git-credentials · credentials.json · id_* · *.pem/.key/.p12/.pfx/.jks/.keystore. `indexer::is_skipped_name`(걷기와 워처 증분 둘 다 지난다)과 `history::should_capture` 가 이 판정 하나를 쓴다. `indexer.rs`(1055줄 래칫)는 기존 줄만 고쳐 순증 0이다.

## 검증
cargo `reconcile`(stale 판정 + DB 행 삭제) · `secret_file_names` · history 19 · indexer/watcher/code/project 96 통과. 기동 로그의 「기동 화해」 줄과 유령 행 감소는 다음 설치본에서 확인한다.