---
schema_version: 1
type: bug
slug: "entry-diff-files-touched-outside"
status: done
difficulty: low
created_at: "2026-10-07T20:26:54+09:00"
session_id: "20261007-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/entry_diffs.rs"
    op: update
  - path: "src-tauri/src/oculpm/entry_diffs_tests.rs"
    op: create
related:
  - ref: "20260830/Bugs/1051_bug_backfill-reran-git-on-every-open.md"
    kind: "followup"
tags:
  - "security"
  - "symlink"
  - "external-review"
  - "mcp-tool"
---
[x] diff 캡처가 일지 files_touched 의 절대경로·.. 로 프로젝트 밖 파일을 읽던 것

## 발생 원인

외부 보안 피드백 2차 #2. `capture_entry_diffs` 는 `files_touched[].path` 를 그대로 `root.join` 해 읽었다. `files_touched` 는 에이전트가 적은 글이고 저장소에 실려 온다. 절대경로를 주면 `Path::join` 이 루트를 버리고, 비 git 루트 + `op: create` 면 tier 4(새 파일)가 그 파일을 통째로 「추가된 줄」 로 렌더해 `.oculpm/index/diffs` 사이드카에 담았다 — 변경 모달과 AI 문맥이 읽는 자리다. 리뷰 말대로 내용이 곧장 기기 밖으로 나가지는 않지만, 마스킹 바닥에 안 걸리는 비밀은 AI 문맥을 거쳐 나갈 수 있었다.

## 해결 방법

- 캡처 전에 `path_guard::secure_join_entry` 로 거른다 — 절대경로·`..`·밖을 가리키는 폴더 링크를 지나는 항목은 어느 갈래로도 읽지 않는다.
- 디스크를 읽는 갈래(tier 2 스냅샷·tier 4 새 파일)는 `secure_join` 으로 마지막 구간 링크까지 따라가며 다시 본다. 마지막 구간이 링크인 추적 파일은 git 갈래가 링크 글자로 보여 준다.
- 파일이 800줄 래칫(898줄)에 걸려 테스트를 `entry_diffs_tests.rs` 로 옮겼다.

## 검증

- 새 테스트: 절대경로·`../outside`·링크 폴더 세 꼴을 비 git 루트에서 캡처해 사이드카가 비고 비밀 문자열이 없음을 본다(옛 코드였다면 tier 4 가 읽어 실패).
- `cargo test` 전체 통과. PR #70.