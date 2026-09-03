---
schema_version: 1
type: bug
slug: "a2a-live-smoke-findings"
status: done
difficulty: high
created_at: "2026-09-03T16:24:25+09:00"
session_id: "20260903-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/error.rs"
    op: update
  - path: "src-tauri/src/app_error.rs"
    op: update
  - path: "src-tauri/src/oculpm/a2a/leases.rs"
    op: update
  - path: "src-tauri/src/oculpm/a2a/mailbox.rs"
    op: update
  - path: "src-tauri/src/oculpm/a2a/tasks.rs"
    op: update
  - path: "src-tauri/src/commands/a2a.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: update
  - path: ".gitignore"
    op: update
  - path: "src/components/CodexMark.tsx"
    op: create
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
related:
  - ref: "20260903/Features_to_add/1606_feature_a2a-phase6-http-door.md"
    kind: "followup"
tags:
  - "a2a"
  - "smoke"
  - "mcp-tool"
---
[x] A2A 실측 — 테스트가 초록인 채로 죽어 있던 것 넷

## 발생 원인

Phase 0~6 이 전부 초록인 상태에서 **실제로 두 세션을 띄워** 돌렸다. 새로 빌드한
`oculpm-mcp` 를 stdio 로 직접 몰아, 한쪽을 살려 둔 채 다른 쪽이 같은 구역을
집도록 했다. 흐름 자체는 설계대로 돌았다 — 참여자 목록에 둘, 겹치는 구역은
선점자·기한과 함께 거절, 안 겹치는 구역은 승인, 작업 넘기기까지.

그런데 네 가지가 **단위 테스트로는 보이지 않는 자리**에서 틀려 있었다.

1. **거절 문구가 `io error at /경로: {json}` 로 나갔다.** 에이전트가 그대로 읽는
   문장인데 IO 오류로 포장돼, 무엇이 왜 거절됐는지를 접두사가 가렸다.
2. **아무도 청소하지 않았다.** 죽은 참여자 카드가 7장 쌓였다. `list_live` 가
   읽을 때 걸러 화면은 정직했지만 파일은 영영 남는다.
3. **기한 보장이 죽은 코드였다.** `expire_overdue` 를 부르는 곳이 프로덕션에
   **하나도 없었다** — "수행자가 죽으면 기한이 대신 닫는다"가 테스트 안에서만
   참이었다. A2A 가 경고하는 "호출자가 영원히 기다리는" 상태가 그대로 남는다.
4. **원장이 gitignore 밖에 있었다.** `agents/leases/`·`tasks/`·`inbox/` 가
   추적 대상이라, 실측이 만든 임대 파일이 커밋 후보로 떴다. pid 와 기계 로컬
   세션 id 가 든 조율 상태다.

## 해결 방법

- `OculpmError::A2aRejected` 를 만들어 A2A 거부 사유가 **경로 접두사 없이**
  그대로 나가게 했다 (`a2a_rejected` 코드).
- 청소와 기한 만료를 **"지금 나를 기다리는 것"을 묻는 두 읽기**에 얹었다 —
  앱의 `a2a_overview`, MCP 의 `agent_inbox`. 읽기 전에 치워야 답이 정직하고,
  앱이 꺼져 있어도 CLI 세션이 그 일을 한다. 테스트로 못 박았다.
- gitignore 관리 블록에 원장 네 갈래를 전부 넣었다.

덧붙여 사용자가 준 `docs/codex.svg` 를 `CodexMark` 로 옮겨 사이드바와 Codex
시작 화면에 붙였다 (`ClaudeMark` 와 같은 계약 — `currentColor`·`size`).

## 확인 못 한 것

앱이 올리는 카드(`claude-code-app`)는 못 봤다. dev 빌드(A2A 포함)는 떠 있지만
ACP 패널을 아직 안 열었고, 설치본 2.36.0 이 동시에 떠 있어 락이 경합하는
상태였다 — 이 저장소가 이미 사고로 배운 조합이다. 앱 쪽 실측은 남아 있다.

## 검증

`cargo fmt --check` 0 · `clippy -D warnings` 0 · `cargo test` **1285 passed /
0 failed**(신설 1: 인박스 읽기가 죽은 카드를 걷고 기한 지난 태스크를 닫는다) ·
`pnpm typecheck` 0 · `pnpm test` 160 files 2077 passed · `pnpm lint` 0.