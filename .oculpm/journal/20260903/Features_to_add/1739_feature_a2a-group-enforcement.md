---
schema_version: 1
type: feature
slug: "a2a-group-enforcement"
status: done
difficulty: medium
created_at: "2026-09-03T17:39:24+09:00"
session_id: "20260903-009"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "src/features/skills/pluginDocs.ts"
    op: update
related:
  - ref: "20260903/Features_to_add/1715_feature_a2a-session-grouping.md"
    kind: "followup"
tags:
  - "a2a"
  - "mcp"
  - "mcp-tool"
---
[x] 묶이지 않으면 못 보낸다 — 울타리는 새 연결 두 자리에만

## 추가 기능

세션 묶기의 마지막 조각 — MCP 도구가 그룹을 강제한다. `agent_send` 와
`task_create` 만 멤버십을 묻고, 나머지는 그대로 둔다(D6·D7).

## 동작 흐름

울타리는 **새 연결 두 자리에만** 선다:

| 도구 | 그룹을 묻나 | 왜 |
|---|---|---|
| `agent_send` · `task_create` | **묻는다** | 새 관계를 만드는 자리다 |
| `task_update` | 안 묻는다 | 당사자 규칙이 이미 지킨다 — 물으면 v2.37.0 에서 넘어온 일이 영영 못 닫힌다 |
| `agent_inbox` | 안 묻는다 | 배달된 것은 배달된 것이다 |
| `claim_paths` | 안 묻는다 | 물리적 자원이라 사회적 관계로 못 나눈다 |

거절 사유는 `groups::refusal` 이 **사람이 읽을 문장**으로 만든다 — 묶이지
않았으면 "Today 에서 묶어 주세요", 다른 그룹이면 그 그룹 이름을 대며.

## 병렬 세션을 기다린 값

`groups::may_talk` 이 `tasks.rs` 를 읽는데 그 파일이 다른 세션 손에 있어
기다렸다. 그쪽이 `eb7f830`(원장 해시 체인 + 3상태 생존 판정)으로 착지한 뒤
`cargo check` 가 **한 번에 깨끗**했다 — 그들이 `list_live`·`is_live` 를 남겨 둔
덕이다. 지금 들어갔다면 시그니처 변경과 부딪히거나 서로의 WIP 를 덮었다.

## 실측

두 세션을 띄워 확인했다: 묶기 전 `agent_send` **거절**(사유 문장 그대로), 같은
순간 `claim_paths` 와 `agent_inbox` 는 **통과**. 처음 돌렸을 때 통과가 나와
잠깐 결함으로 보였는데, `cd` 실패로 **빌드가 안 돌아 옛 바이너리**를 몰고 있었다 —
다시 빌드하니 설계대로였다. (테스트 실패를 코드 탓으로 단정하기 전에 무엇을
돌렸는지 먼저 볼 것.)

## 검증

`cargo fmt --check` 0 · `clippy -D warnings` 0 · `cargo test` **1312 passed /
0 failed**(신설 1: 보내기·위임은 막히고 읽기·임대는 통과) · `pnpm typecheck` 0 ·
`pnpm test` **161 files 2086 passed** · `pnpm lint` 0. 문서 표면 3곳 동기.