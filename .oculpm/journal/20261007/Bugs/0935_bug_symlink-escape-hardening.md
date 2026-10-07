---
schema_version: 1
type: bug
slug: "symlink-escape-hardening"
status: done
difficulty: medium
created_at: "2026-10-07T09:35:31+09:00"
session_id: "20261007-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/code/read_write.rs"
    op: update
  - path: "src-tauri/src/oculpm/atomic_io.rs"
    op: update
  - path: "src-tauri/src/oculpm/atomic_io_ndjson.rs"
    op: create
  - path: "src-tauri/src/oculpm/paths.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/lifecycle.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/search.rs"
    op: update
  - path: "src-tauri/src/oculpm/error.rs"
    op: update
  - path: "src-tauri/src/app_error.rs"
    op: update
  - path: "plugin/oculpm/hooks/hooks.json"
    op: update
  - path: "plugin/oculpm-codex/hooks/hooks.json"
    op: update
related:
  - ref: "20261004/Bugs/2112_bug_index-integrity-toast-never-wired.md"
    kind: "followup"
tags:
  - "security"
  - "symlink"
  - "external-review"
  - "mcp-tool"
---
[x] 저장소에 심은 심볼릭 링크가 저장·기록을 프로젝트 밖으로 돌리던 경로들

## 발생 원인

외부 보안 피드백 #4: 에디터 저장(`write_with_lock`)이 임시 파일을 고정 이름 `.{파일명}.oculpm-save-tmp` 로 `fs::write` 했다. 경로 가드(`canonical_within_root`)는 대상 파일만 보고 임시 파일은 보지 않았으므로, 저장소가 그 이름의 링크를 미리 넣어 두면 저장 내용이 링크 대상(프로젝트 밖)에 쓰였다. 리뷰가 놓친 부분도 있다 — 이어지는 `rename` 이 원본 자리에 그 링크를 앉혀, 저장 뒤 원본이 링크가 됐다. 이 함수는 전역 치환·히스토리 되돌리기도 같이 쓴다.

같은 부류를 더 찾았다:
- `append_ndjson` 이 `append+create` 로 열어 링크를 따라갔다.
- 앱 쪽 `resolve_entry_path`(모바일 브리지도 쓰는 일지 읽기·고치기 경로)는 어휘 검사만 하고 링크는 전혀 안 봤다. MCP `journal_read` 는 마지막 구간만 봤다 (리뷰 2 지적).
- `.oculpm/` 안의 링크(`journal → 밖`)를 앱 init 은 아예 보지 않았다. MCP 서버는 `.oculpm` 자신만 봤다.
- 플러그인 훅의 셸 `>>` 도 링크를 따라갔다.

## 해결 방법

- 저장 임시 파일: 저장마다 UUID 이름 + `create_new`(O_EXCL). 권한은 연 핸들에 건다.
- `append_ndjson`: 유닉스 O_NOFOLLOW + 열기 전 lstat. 파일 크기 래칫 때문에 `atomic_io_ndjson.rs` 로 옮겼다 (경로 불변).
- `paths::first_symlink_under` — 항목 종류만 보는 전수 검사(이 저장소 `.oculpm/` 1만 6천 항목에 44ms). 앱 init 은 아무것도 읽거나 쓰기 전에 거부한다(`SymlinkInOculpm` → `oculpm_symlink`, ko/en 문구). MCP 서버는 `index/` 를 뺀 범위를 매 호출 검사한다. `oculpm_init` 이 오류를 문자열로 접어 코드를 잃던 것도 고쳤다.
- `paths::resolves_within` — 끝까지 풀어 루트 안인지 보고 마지막 구간 링크도 거부. `resolve_entry_path`·`journal_read` 에 적용.
- 훅(Claude·Codex 양 판): `.oculpm`·`hooks`·고정 이름 원장이 링크면 쓰지 않고 exit 0.

## 검증

- 새 테스트 6개 (심어 둔 임시 이름 링크·append 링크·중간 폴더 링크·전수 검사·init 거부·훅 실행). 저장 테스트는 옛 코드였다면 밖 파일이 "after" 로 바뀌어 실패한다.
- `cargo test` 전체 통과(lib 1785) · clippy 경고 0 · `pnpm test` 3262 통과 · `pnpm lint`·`typecheck` 통과.
- 실기기 미확인: 링크가 든 프로젝트를 앱에서 열 때 오류 문구가 실제로 어떻게 뜨는지.