---
schema_version: 1
type: bug
slug: "plan-log-archive-test-month-rollover"
status: done
difficulty: verylow
created_at: "2026-10-01T18:27:11+09:00"
session_id: "20261001-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tests/plan_log_archive.rs"
    op: update
related: []
tags:
  - "test"
  - "planner"
  - "mcp-tool"
---
[x] plan_log_archive 테스트가 10월 1일에 붉음 — 본문 로그 행을 씨앗의 월 접두로 셌다

## 발생 원인

`archived_rows_stay_in_the_item_history_and_never_become_a_plan` 이 본문에 남은 plan-log 행 수를 `starts_with("| 2026-09-")` 로 셌다. 씨앗 60행은 9월이지만, 테스트 중 `plan_update` 로 쓰는 "분리 유발" 행은 **오늘** 날짜로 찍힌다. 9월 동안은 우연히 맞았고 2026-10-01 부터 39 ≠ 40 으로 붉었다. 이 라운드 코드와 무관 — 전체 `cargo test` 에서 이것 하나만 실패해 확인했다.

## 해결 방법

월 접두 대신 행의 모양(`| YYYY-MM-DDT…`)으로 세는 `is_log_row` 헬퍼. 같은 패턴의 다른 자리는 `grep 'starts_with("| 20'` 로 0건 확인.

## 검증

`cargo test --test plan_log_archive` 통과, `fmt --check`·`clippy --all-targets -D warnings` 0.