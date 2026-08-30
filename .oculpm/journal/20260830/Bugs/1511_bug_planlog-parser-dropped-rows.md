---
schema_version: 1
type: bug
slug: planlog-parser-dropped-rows
status: done
created_at: 2026-08-30T15:11:00+09:00
session_id: "manual-20260830-151100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/oculpm/planner/parse.rs
    op: update
  - path: src-tauri/src/oculpm/planner/plan_edit.rs
    op: update
related: []
tags: [planner, parser, data-loss, polish-round]
---

[x] plan-log 파서가 `agent`·`시각`·`에이전트` 가 든 데이터 행을 헤더로 버려 이 저장소에서 22행이 이력에서 사라졌다

## 발생 원인

`parse.rs parse_log_row` 의 헤더 판정이 셀을 합친 문자열에 `시각`·`에이전트`·`agent`(대소문자 무시) 가 있으면 헤더로 보고 `None` 을 돌려줬다. 일지 경로(`…/1753_chore_agent-discipline-redesign-plan.md`)와 메모("agent-client-protocol 2.0", "시각 보정") 에 그 낱말이 흔하다 — `.oculpm/planner/*.md` 를 세어 보니 `| 2026-` 로 시작하는 행 중 22개가 해당했고, 전부 항목 이력·에이전트 귀속·연결 일지에서 조용히 빠져 있었다. 같은 파서가 맨 `|` 로 split 하므로 메모에 파이프 하나만 있어도 열이 밀렸고, `plan_edit.rs render_row` 는 이스케이프를 하지 않았다.

## 해결 방법

- 헤더 판정을 **첫 셀이 숫자로 시작하는가** 로 바꿨다 — 데이터 행은 항상 ISO 시각으로 시작하고 헤더(`시각`/`ts`)는 절대 그렇지 않다. 낱말 검색은 없앴다.
- `split_table_cells`: `\|` 를 글자 `|` 로 되돌리며 나눈다. `render_row` 는 자유 텍스트 셀(에이전트·일지·메모)의 `|` 를 `\|` 로, 줄바꿈을 공백으로 쓴다.

## 검증

새 테스트 `log_rows_with_agent_or_sigak_in_cells_are_data_not_header`: 실제 소실 행 두 개(경로에 `agent`, 메모에 `agent-client-protocol` 과 `시각` 과 `\|`)가 파싱되고 헤더 행은 여전히 버려진다. `cargo test` 869 그린. 기존 22행은 코드만 고치면 다음 파싱부터 되살아난다(파일은 손대지 않았다).
