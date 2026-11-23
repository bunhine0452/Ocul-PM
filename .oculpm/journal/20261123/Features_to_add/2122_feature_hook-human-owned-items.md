---
schema_version: 1
type: feature
slug: "hook-human-owned-items"
status: done
difficulty: high
created_at: "2026-11-23T21:22:57+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm-codex/hooks/delivery-gate.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/event-sink.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/hooks.json"
    op: update
  - path: "plugin/oculpm-codex/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/session-end.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/session-marker.sh"
    op: update
  - path: "plugin/oculpm/README.md"
    op: update
  - path: "plugin/oculpm/hooks/delivery-gate.sh"
    op: update
  - path: "plugin/oculpm/hooks/hooks.json"
    op: update
  - path: "plugin/oculpm/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm/hooks/session-end.sh"
    op: update
  - path: "plugin/oculpm/hooks/session-marker.sh"
    op: update
  - path: "src-tauri/src/bin/oculpm_mcp.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/hook.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/digest.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/owner_cases.json"
    op: create
  - path: "src-tauri/tests/plugin_hook_no_plan.rs"
    op: update
  - path: "src-tauri/tests/plugin_hook_owner.rs"
    op: create
  - path: "src-tauri/tests/plugin_hook_subfolder.rs"
    op: create
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src-tauri/tests/resume_context.rs"
    op: update
  - path: "src-tauri/tests/session_verdict.rs"
    op: update
  - path: "src/__tests__/plan_owner_cases.test.ts"
    op: create
  - path: "src/features/planner/planMeta.ts"
    op: update
  - path: "extension/src/model/plan.ts"
    op: update
related: []
tags:
  - "훅"
  - "love-round"
  - "today"
  - "mcp-tool"
---
[x] 훅: 사람 몫은 에이전트의 다음에서 뺀다

## 추가 기능
- `[사용자]`·`[user]` 몫 항목(부모가 사람 몫이면 그 하위도)은 오늘 · 계획 화면의 「다음」 과 시작 훅이 에이전트 일로 권하지 않는다. 탐색에서 오늘의 채운 단추 「터미널에서 실행」 이 걷은 의미검색의 눈 확인을 Claude 에게 맡기라고 권하던 결함이다. digest.rs · plan-context.sh · planMeta.ts · (최종 검수 F1 이 더한) 확장 plan.ts 가 `owner_cases.json` 한 사례표를 문다.
- 시작 훅: 사람 몫은 「N개는 뺐다」 로 접고, 사람 몫만 남은 계획은 한 줄, 확인 명령 없는 계획은 이름으로 짚고, 직전 대화가 일지 없이 끝났으면 한 줄. 서브에이전트는 활성 계획 이름 한 줄만(약 1.6KB → 400B).
- 저장소 하위 폴더에서 띄운 claude 도 훅 · MCP 가 위로 올라가 루트의 `.oculpm` 에 붙는다.

## 동작 흐름
판정 정규식(`^(판정|verdict) (✓|✗)`)은 그대로 두고, 「다음」 을 고르는 쪽만 같은 규칙으로 바꿨다. 「작업 전 일지 찾기」 를 훅으로 싣는 안은 바이트 대비 가치가 낮아 하지 않았다.

## 검증
로컬 `plugin_hook_owner` 6 · `plugin_hook_subfolder` 5 · `plugin_hook_no_plan` 10 · `resume_context` 5 · `session_verdict` 5 passed, vitest `plan_owner_cases` 7 passed. PR #177 CI Rust 통과(c538bf7e). Windows Git Bash 경로는 portability 몫.