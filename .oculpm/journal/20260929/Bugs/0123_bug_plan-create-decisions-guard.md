---
schema_version: 1
type: bug
slug: "plan-create-decisions-guard"
status: done
difficulty: low
created_at: "2026-09-29T01:23:34+09:00"
session_id: "20260929-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools/plan_create.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/plan.rs"
    op: update
related:
  - ref: "20260929/Bugs/0035_bug_planner-anchored-phase-decisions-ext.md"
    kind: "followup"
tags:
  - "planner"
  - "mcp"
  - "mcp-tool"
---
[x] MCP plan_create 도 결정 섹션 이름을 phase 제목으로 받지 않는다 (PR #58)

## 발생 원인

L-PLAN2 가 plan_edit 의 phase 편집에 결정 섹션 가드를 넣으면서 같은 구멍이 MCP `plan_create` 에도 있다고 짚었다. 에이전트가 `phases[].title` 을 「결정」·「Decisions」 로 주면 `## 결정 {#p1}` 이 쓰이고, 그 아래 항목 전부를 파서가 결정 섹션으로 읽어 플랜에서 사라졌다.

## 해결 방법

`plan_create` 가 phase 제목마다 `heading::is_decisions_heading` 을 보고, 참이면 파일을 만들기 전에 거절한다. 판정은 plan_edit 와 같다.

## 검증

- `plan_create_refuses_a_decisions_heading_as_a_phase_title`: 「결정」·「Decisions」·「결정 (Decisions)」·「Decision log:」 를 거절하고 파일을 만들지 않는다. 「결정 반영」 은 통과한다. 로컬 clippy·파일 크기 래칫도 통과했다.
- PR #58 전 체크 pass, rebase 병합(70cbfff6).