---
schema_version: 1
type: feature
slug: "mcp-plan-add-decision-verdict"
status: done
difficulty: high
created_at: "2026-11-23T21:22:41+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/skills/inception/SKILL.md"
    op: update
  - path: "plugin/oculpm/skills/next/SKILL.md"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/journal_spec_en.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/journal_spec_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/protocol.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/args.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/ask.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/claims.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_create.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_update.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/project_init.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tests/args_forgive.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tests/claims.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tests/guards.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/plan_add.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tests/plan_update_safety.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/parse.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/plan_decision.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/plan_edit.rs"
    op: update
  - path: "src-tauri/src/oculpm/verdict/transcript.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
related: []
tags:
  - "mcp"
  - "love-round"
  - "planner"
  - "mcp-tool"
---
[x] MCP: 계획에 항목 · 결정 · 판정을 더한다

## 추가 기능
- `plan_update` 에 `add`(항목 · 하위 1단계) · `decision`(`## 결정` 블록) · `verdict`(상태 변경 없이 판정 줄만)를 더했다. 모두 같은 plan_guard + base_hash CAS 안에서 쓰고, plan-log 에 `→☐` 행이 남는다. 탐색에서 이 저장소 세션이 python heredoc 으로 planner 파일을 직접 고친 호출 94건(CAS · {#id} 우회)의 원인이었다.
- 거절은 빠진 인자를 한 번에 전부 알리고, 흔한 동의어(body→body_markdown · hash→base_hash · 글리프 상태 등)는 받아 응답 `received` 로 알린다. 일지 slug 는 선택.
- `plan_status` 가 `[~]` 마다 누가 · 언제 잡았는지와 48시간 넘은 stale 을 싣는다. ask_user 질문 파일에 묻는 대화의 신원. project_init 문구를 한 언어로.
- 템플릿 v21 · journal-spec v4 가 새 길을 가르치고, 손으로 쓰는 결정 블록 모양은 journal-spec 이 든다.

## 동작 흐름
에이전트가 하다 찾은 남은 일을 `plan_update(add: [...])` 로 넣으면 서버가 {#id} 를 짓고(겹치면 -2) 로그를 남긴다. 최종 검수(F4)가 옛 앱이 `verdict` 를 조용히 버리는 틈을 막았다 — 응답이 받은 판정을 되돌려 주고 next 스킬이 그 줄을 확인한다.

## 검증
PR #177 CI(macOS · Linux) Rust 잡 통과(c538bf7e), 로컬 `cargo test --lib plan_add` 7 passed · `plan_parallel_write` 5 · `plan_cas_two_process` 3 · `rule_canary` 6 passed. 동시 add 두 번에 한쪽이 write-conflict 로 거절되는 시험 포함.