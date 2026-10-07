---
schema_version: 1
type: bug
slug: "path-guard-blob-dispatch-import"
status: done
difficulty: medium
created_at: "2026-10-08T05:59:27+09:00"
session_id: "20261008-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/blob.rs"
    op: update
  - path: "src-tauri/src/git/gutter.rs"
    op: update
  - path: "src-tauri/src/git/tests.rs"
    op: update
  - path: "src-tauri/src/commands/code/import.rs"
    op: update
  - path: "src-tauri/src/commands/code/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/dispatch.rs"
    op: update
related:
  - ref: "20261007/Bugs/2026_bug_symlink-guard-general-files.md"
    kind: "followup"
  - ref: "20261007/Bugs/0935_bug_symlink-escape-hardening.md"
    kind: "followup"
tags:
  - "security"
  - "path-guard"
  - "symlink"
  - "mcp-tool"
---
[x] [x] HEAD 내용·▶실행 일지 발췌·파일 가져오기가 프로젝트 밖에 닿던 경로 3건 (보안 피드백 3차)

## 발생 원인

외부 보안 피드백 3차가 짚은 세 자리 모두 코드에서 사실이었다.

- **git 블롭 질의** — `show_file_bytes`·`blob_size`·`path_in_head` 가 `root.join(file_path)` 를 거르지 않고 `repo_root_for` 로 **경로에서** 저장소를 풀었다. `../옆-저장소/파일`·절대경로·밖을 가리키는 링크면 그 저장소의 HEAD 를 꺼내 준다. 리뷰는 `code_head_content` 만 짚었지만 이미지 미리보기의 "이전" 쪽(`diff_binary_preview`)과 편집기 거터(`git_line_changes`)도 같은 함수를 썼다.
- **플랜 ▶실행 일지 발췌** (`planner/dispatch.rs`) — plan-log 의 일지 칸은 저장소가 쓰는 값인데 `root.join` 으로 그대로 읽어 프롬프트에 실었다.
- **파일 가져오기** (`code/import.rs`) — 이름 중복 검사가 `exists()` 라 깨진 링크를 빈 자리로 봤고, `fs::copy` 가 그 링크를 따라 프로젝트 밖에 썼다.

## 해결 방법

- 블롭 계층 한 곳(`git::blob::in_root`)이 `path_guard::secure_join` 을 먼저 지난다 — 세 창구가 함께 막힌다. 거터는 거부된 경로를 "새 파일(전부 추가)" 로 읽지 않게 먼저 끊는다.
- 일지 발췌는 `.oculpm/journal/` 안의 `.md` 만, `..` 성분 없이, `secure_join` 으로 연다.
- 가져오기는 이름 검사를 `symlink_metadata` 로, 쓰기를 `create_new`(O_EXCL)·`create_dir` 로 바꿨다 — 이름을 고른 뒤 그 자리에 링크가 생겨도 따라가지 않는다.

## 검증

수정 전 상태에서 새 테스트가 옆 저장소의 커밋 내용(`theirs`)을 받는 것을 확인(빨강) → 수정 후 `blob_queries_stay_inside_the_project_root`·`journal_refs_outside_the_journal_folder_are_not_read`·`import_never_writes_through_a_planted_link` 통과. `cargo test` 전부·clippy·fmt 초록 (PR #74).