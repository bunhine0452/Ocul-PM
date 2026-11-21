---
schema_version: 1
type: feature
slug: "waiting-new-notification-kinds"
status: done
difficulty: low
created_at: "2026-11-22T03:41:50+09:00"
session_id: "20261122-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "fe824e5d-958c-4ffc-9c86-900de7c6682a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/waiting_cases.json"
    op: update
  - path: "src-tauri/src/oculpm/claude_waiting.rs"
    op: update
  - path: "extension/src/model/waiting.ts"
    op: update
  - path: "extension/src/guard.spec.ts"
    op: update
  - path: "extension/package.json"
    op: update
  - path: "extension/CHANGELOG.md"
    op: update
related: []
tags:
  - "기다림"
  - "자동-모드"
  - "확장"
  - "mcp-tool"
---
[x] 기다림: 에이전트 물음 · MCP 입력 요청도 선다

## 추가 기능

「Claude 기다림」 은 알림 둘(`permission_prompt` · `idle_prompt`)만 알았다. 자동 모드가 기본이 되면 허락 묻기는 드물어지고, 사람을 기다리는 모양은 백그라운드 에이전트의 물음(`agent_needs_input`)과 MCP 서버의 입력 요청(`elicitation_dialog` · `elicitation_url_dialog`)쪽으로 옮겨 간다. 이 셋도 기다림(입력)으로 서고, 입력 요청에 답하면(`elicitation_complete` · `elicitation_response`) 그 세션의 기다림이 풀린다.

## 동작 흐름

규칙은 앱(`claude_waiting.rs`)과 VS Code 확장(`extension/src/model/waiting.ts`)이 같은 사례표(`waiting_cases.json`)로 물린다 — 표에 다섯 사례를 더했고 양쪽 구현을 함께 고쳤다. 종류는 여전히 둘(permission · idle)이라 화면 문구는 그대로다. 완료 · 할당량 · 플러그인 알림과 자동 모드의 거부(`PermissionDenied`)는 기다림이 아니다. 확장은 0.3.1 로 올렸다.

확장의 `guard.spec.ts` 가 Windows 에서 경로를 `C:\C:\…` 로 읽어 통째로 못 돌던 것도 함께 고쳤다(`URL.pathname` → `fileURLToPath`, 경로 구분자).

## 검증

- `cargo test --locked --lib claude_waiting`: `test result: ok. 3 passed; 0 failed` (공용 사례표 포함)
- `vitest run --root extension`: `Test Files  6 passed (6)` · `Tests  78 passed (78)` — 고치기 전에는 `guard.spec.ts` 가 Windows 에서 ENOENT 로 실패

## 메모

알림 종류 이름은 Claude Code 훅 문서의 목록에서 가져왔고 실제 세션에서 그 알림을 받아 보지는 못했다.