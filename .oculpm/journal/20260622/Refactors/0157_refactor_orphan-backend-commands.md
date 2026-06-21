---
schema_version: 1
type: refactor
slug: orphan-backend-commands
status: done
difficulty: medium
created_at: "2026-06-22T01:57:00+09:00"
updated_at: "2026-06-22T01:57:00+09:00"
session_id: "20260622-m02"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/lib.rs
    op: update
    bytes_added: 0
    bytes_removed: 900
  - path: src-tauri/src/commands/window.rs
    op: update
    bytes_added: 0
    bytes_removed: 1500
  - path: src-tauri/src/commands/git.rs
    op: update
    bytes_added: 0
    bytes_removed: 1400
  - path: src-tauri/src/commands/planner.rs
    op: update
    bytes_added: 0
    bytes_removed: 350
  - path: src-tauri/src/commands/project.rs
    op: update
    bytes_added: 0
    bytes_removed: 3400
  - path: src-tauri/src/commands/oculpm.rs
    op: update
    bytes_added: 0
    bytes_removed: 1300
  - path: src-tauri/src/commands/project_tree.rs
    op: delete
    bytes_added: 0
    bytes_removed: 0
  - path: src-tauri/src/commands/mod.rs
    op: update
    bytes_added: 0
    bytes_removed: 60
  - path: src-tauri/src/github.rs
    op: update
    bytes_added: 0
    bytes_removed: 1600
  - path: src/api/oculpm.ts
    op: update
    bytes_added: 0
    bytes_removed: 700
  - path: src/features/code/fileTreeNav.ts
    op: update
    bytes_added: 480
    bytes_removed: 60
  - path: src/__tests__/lite_w6_safety_net.test.ts
    op: update
    bytes_added: 60
    bytes_removed: 80
  - path: src/__tests__/today_v2.test.tsx
    op: update
    bytes_added: 0
    bytes_removed: 320
related:
  - ./0138_refactor_legacy-dead-code-removal.md
tags: ["dead-code", "tauri-commands", "cleanup", "dev-report", "bindings"]
---

[x] 고아 백엔드 커맨드 22개 제거 (보고서 §3-A)

## 동기

`docs/20260622_dev-report/01-code-cleanup.md §3-A` 의 "삭제" 분류 — `lib.rs collect_commands!` 에 등록돼 `bindings.ts` 에 생성되지만 활성 프런트 호출처가 0인 `#[tauri::command]` 들. 직전 legacy 삭제로 이들의 유일한 호출처(legacy UI)가 사라져, 이제 진짜 고아임을 깔끔히 검증할 수 있게 됐다.

## 변경 요약

- **재검증 우선**: legacy 삭제 후 각 후보의 camelCase 식별자를 `src/`(생성된 `bindings.ts` 제외)에서 grep → 22개 모두 호출처 0 확인. 감사 보고서가 충돌했던 `read_changelog`(마크다운 CHANGELOG 커맨드 vs `git::read_changelog` 함수)도 직접 grep 으로 고아 확정.
- **제거한 커맨드 22개**: 윈도우 4(minimize/maximize/close/open_ai_window), `get_dependency_graph`, M6 AI-assist 3(detect_file_changes/list_file_changes/generate_edit_prompt), 파일 3(list_project_files/list_project_tree/write_project_file), planner 2(goal_get/dashboard_stats), git/GitHub 5(git_remotes/git_tags/git_log_range/read_changelog/github_releases), oculpm 4(get_current_session/get_index_snapshot/watcher_status/observed_agent_ids).
- **연쇄 정리**: `commands/window.rs`·`git.rs` 핸들러만 제거(개발툴·터미널·verify 등 라이브 유지), `github.rs` 의 `list_releases`+`GithubRelease`/`ReleaseRaw`/`AuthorRaw` 제거(비공개 모듈 → 경고 회피), `project_tree.rs` 파일째 삭제(트리 빌더는 그 커맨드 전용이었음) + `mod.rs` 등록 해제, `oculpm.rs` 의 미사용 import(Snapshot/SnapshotKind/WatcherStatus) 정리, `project.rs` 의 `FileChange` import 정리.
- **타입 디커플**: `list_project_tree` 제거로 `ProjectTreeNode` 가 bindings 에서 사라지므로, 그 유일 소비자인 `fileTreeNav.ts` 에 타입을 로컬 정의하고 안전망 테스트를 재배선. `dashboard_stats` 제거에 맞춰 `today_v2.test.tsx` 의 미사용 mock 행 제거. 죽은 `oculpmApi` 래퍼 3개(getCurrentSession/getIndexSnapshot/watcherStatus) 제거.
- `cargo test` 로 `bindings.ts` 재생성(커맨드 22개 + 고아 타입 ProjectTreeNode/Snapshot/SnapshotKind/WatcherStatus/GithubRelease/DependencyGraph/GitRemote/GitTag/ChangelogFile/DashboardStats 드롭).
- 순 **−795줄**(생성 bindings 제외) + bindings.ts −186줄.

## 검증

`cargo build`(경고 0) · `cargo test`(284 passed) · `pnpm typecheck` 0 · `pnpm test`(125 passed) · `pnpm lint` 0 · `pnpm build` 0 — 커밋 전 게이트 전부 직접 확인.

## 메모

- 보류(별도 결정): §3-B "재활성화 후보"(compare_layers·set_journal_verified·generate_seed_goals·overview 파이프라인 등)는 기능으로 살릴 후보라 유지. §3-C 마이그레이션 shim 은퇴는 버전 게이트 결정 필요.
- 일부 이제-죽은 `pub` 헬퍼(git.rs 의 remotes/tags/log_range/read_changelog + 구조체, db.rs 의 get_goal/dashboard_stats/get_dependency_graph/list_project_files 메서드)는 `pub mod`/공개 API 라 컴파일 경고가 없어 후속 정리로 남김.
