---
schema_version: 1
type: bug
slug: "journal-write-string-files-touched"
status: done
difficulty: low
created_at: "2026-10-04T18:53:49+09:00"
session_id: "20261004-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ff953333-de21-4236-80e6-db91a04ad7fa"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools/files_touched.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/journal.rs"
    op: update
related:
  - ref: "20261004/Features_to_add/1837_feature_agent-report-card-first-draft.md"
    kind: "followup"
tags:
  - "mcp-tool"
---
[x] journal_write 가 문자열 배열 files_touched 를 경고 없이 버리던 것

## 발생 원인

`journal_write` 의 files_touched 파싱이 `filter_map(|f| … f.get("path")?.as_str()? …)` 였다. 에이전트가 정규 모양(`{"path","op"}`) 대신 경로 문자열 배열을 주면 `f.get("path")` 가 None 이 되어 원소가 통째로 빠지고, 응답 `warnings` 는 비어 있었다. 성적표 판독(09-04 ~ 10-04 대화 기록)에서 호출 250번 중 4번, 경로 59개가 `files_touched: []` 로 저장된 것을 찾았다 — 예: `20260923/Bugs/1818_bug_bug-hunt-parallel-three-2026-09-22.md` 는 17개를 넘겼는데 0개.

## 해결 방법

파싱을 `mcp/tools/files_touched.rs` 의 `parse_files_touched(root, args, &mut warnings)` 로 옮겼다(`mod.rs` 798줄 → 773줄, 래칫 800 — related.rs·tags.rs 와 같은 분리). 문자열 원소는 `update` 로 받고, 그래도 읽지 못한 원소(숫자·path 없는 객체·빈 경로)는 개수를 세어 `warnings` 한 줄로, 배열이 아닌 값도 `warnings` 로 알린다. `parse_file_op` 도 이 모듈로 옮겼다(다른 사용처 없음).

## 검증

새 테스트 2개(`journal_write_accepts_string_paths_in_files_touched`, `journal_write_warns_on_unreadable_files_touched`)를 옛 동작으로 되돌려 둘 다 실패하는 것을 확인한 뒤 복원. 워크트리(origin/main 기반)에서 cargo fmt·clippy(-D warnings) 통과, cargo test --no-fail-fast 2,025 통과 — `dap_lldb::lldb_dap_runs_a_whole_session` 만 이 기계의 lldb-dap 이 `initialized` 를 안 보내 실패(DAP 무변경). pnpm typecheck·lint·build exit 0, vitest 3,288 통과. PR #67.