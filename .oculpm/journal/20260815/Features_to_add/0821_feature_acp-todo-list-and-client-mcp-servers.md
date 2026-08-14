---
schema_version: 1
type: feature
slug: "acp-todo-list-and-client-mcp-servers"
status: done
difficulty: medium
created_at: "2026-08-15T08:21:21+09:00"
session_id: "mcp-20260815-082121"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "feature"
  - "mcp"
  - "plan"
  - "mcp-tool"
---
[x] 할 일 목록과 우리 MCP 서버 — 어댑터가 주던 것을 버리고 있었다

## 어댑터 README 가 목록으로 알려 줬다

`TODO lists` 와 `Client MCP servers`. 둘 다 **이미 오고 있었는데 우리가 버리고 있었다.**

## 할 일 목록

`SessionUpdate::Plan` 을 `Other` 로 뭉개 버리고 있었다. 에이전트가 세우는 계획(TodoWrite)이 통째로 사라진 것이다.

**합치지 않고 대체한다.** 스펙이 못 박는다 — "갱신할 때는 모든 항목을 현재 상태와 함께 보내고, 클라이언트는 통째로 갈아 끼운다". 합치면 같은 항목이 갱신될 때마다 화면에 여러 벌 쌓인다.

조각(`blocks`) 흐름에 끼우지 않고 **턴에 하나**만 둔다. 진행 상황을 훑는 물건이라 글 사이에 끼면 매번 찾아야 하고, 갱신마다 새 카드가 생긴다.

상태는 색과 채움으로만 말한다 — 글자로 "완료"를 덧붙이면 목록이 두 배로 길어지는데, 훑을 때 필요한 것은 어디까지 왔는지뿐이다. 도는 항목은 레일의 점과 같은 맥박으로 뛴다.

## 우리 MCP 서버

`session/new` 의 `mcp_servers` 를 **빈 채로** 보내고 있었다. 이제 `oculpm-mcp` 하나를 물린다 — 앱 안의 Claude Code 가 `journal_write`·`plan_update` 를 그대로 쓸 수 있다. 프로젝트에 `.mcp.json` 을 등록해 두지 않았어도.

**이 앱은 자기 자신을 추적한다.** 에이전트가 일지를 못 쓰는 것이 기본값이면 그 전제가 반쪽이 된다.

두 곳을 갈랐다.
- 바이너리를 못 찾으면 **아무 것도 안 넘긴다** — 없는 명령을 서버라고 넘기면 어댑터가 매 세션마다 그걸 띄우려다 실패한다(개발 중 `cargo build --bin oculpm-mcp` 전까지가 그 상태다).
- `/usage` 전용 대화에는 **안 물린다** — 한 줄 묻고 마는 일회용이라 서버를 띄우면 그만큼 느려지고 쓸 일도 없다.

## 곁들여 확인한 것

어댑터 최신은 **0.68.0**, 우리 고정은 0.67.0. 이번 작업에 필요한 것은 둘 다 있어서 올리지 않았다 — 버전을 올릴 때는 스파이크를 다시 돌려 `session/update` 종류가 늘거나 바뀌지 않았는지 봐야 한다(adapter.rs 주석의 약속).

## 검증

typecheck 0 · 프런트 856(할 일 목록 3건 추가) · lint 0 · build 0 · 백엔드 581 유닛 + 전 스위트.

**미확인**: MCP 서버가 실제로 물려 도구가 보이는지는 대화에서 `journal_write` 를 시켜 봐야 안다.