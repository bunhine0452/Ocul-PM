---
schema_version: 1
type: feature
slug: "a2a-agent-register-tools"
status: done
difficulty: medium
created_at: "2026-09-03T14:34:52+09:00"
session_id: "20260903-004"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/protocol.rs"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "landing/plugin.html"
    op: update
related:
  - ref: "20260903/Features_to_add/1426_feature_a2a-phase1-registry.md"
    kind: "followup"
tags:
  - "a2a"
  - "mcp"
  - "mcp-tool"
---
[x] A2A — 앱 밖 세션이 스스로 참여자 목록에 오른다

## 추가 기능

MCP 도구 2종 — `agent_register`(이 세션을 참여자 목록에 올린다) · `agent_list`
(지금 붙어 있는 에이전트). Phase 1 의 마지막 조각으로, 앱이 없는 터미널 세션도
같은 원장에 들어온다.

## 동작 흐름

**pid 로 MCP 서버 자신의 것을 적는다.** 이 서버는 에이전트가 세션 동안 붙잡고
있는 자식 프로세스라, 세션이 끝나면 함께 죽는다 — 우리 pid 의 생사가 곧 그
세션의 생사다. 에이전트가 준 pid 를 받아 적으면 남이 준 숫자를 믿는 것이고,
그게 틀리면 죽은 세션이 살아 있는 참여자로 남아 넘긴 작업이 허공으로 간다.

**하트비트를 따로 걸지 않는다.** 도구 호출마다 카드를 다시 쓰면 워처를 그만큼
두들기는데, pid 가 이미 더 정확한 신호를 준다. 등록을 다시 부르는 것으로 충분하다.

`agent_id` 는 `{provider}-term-{pid}` 로 서버가 짓는다. provider 는 파일명이
되므로 경로가 섞이면 거부한다 — 카드 이름은 앱 밖 에이전트가 주는 값이라
그대로 붙이면 경로 탈출이다.

## 걸린 함정

도구 정의를 하나 더 넣자 `json!` 매크로가 **재귀 한도**에 걸렸다. 크레이트 전역
`recursion_limit` 을 올리는 대신 배열을 갈래별로 나눠 이어 붙였다
(`a2a_tool_definitions`) — 도구가 늘 때마다 전역 한도를 올리는 것보다 싸다.

## 검증

`cargo fmt --check` · `cargo clippy --all-targets -D warnings` clean ·
`cargo test` 1249 passed / 0 failed (신설 2: 등록→목록 왕복·재등록 멱등,
경로가 섞인 provider 거부). `tools/list` 계약 테스트와 `plugin_manifest` 게이트에
도구 2종을 더하고 `landing/plugin.html` 을 9종으로 갱신했다(게이트 통과).
프런트는 손대지 않았다 — 이 도구들은 Tauri 커맨드가 아니라 바인딩 영향이 없다.

AGENTS.md 규칙(세션 시작에 등록하라)은 **Phase 4 로 미룬다.** 받을 것이 아직
없는데 규칙을 넣으면 모든 추적 프로젝트에 토큰만 얹는다.