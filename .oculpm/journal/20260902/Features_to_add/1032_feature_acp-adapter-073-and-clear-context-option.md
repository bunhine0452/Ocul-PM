---
schema_version: 1
type: feature
slug: "acp-adapter-073-and-clear-context-option"
status: done
difficulty: medium
created_at: "2026-09-02T10:32:34+09:00"
session_id: "20260902-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src/features/chat/acpTitle.ts"
    op: update
  - path: "src/features/chat/conversation/permissionOptions.ts"
    op: create
  - path: "src/features/chat/conversation/PermissionCard.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/acp_permission_options.test.ts"
    op: create
  - path: "src/__tests__/acp_permission_card.test.tsx"
    op: create
  - path: "src/__tests__/acp_parallel_sessions.test.tsx"
    op: update
  - path: "src/__tests__/acp_conversation_seams.test.tsx"
    op: update
related: []
tags:
  - "acp"
  - "adapter"
  - "permission"
  - "ui"
  - "mcp-tool"
---
[x] ACP 어댑터 0.73.0 상향 — 내장 Claude Code 최신화 + 계획모드 "컨텍스트 비우기" 선택지 분리

## 추가 기능

고정 어댑터를 `@agentclientprotocol/claude-agent-acp` **0.70.0 → 0.73.0** 으로 올렸다. 함께 딸려 오는 **내장 Claude Code 가 `claude-agent-sdk@0.3.232` → `0.3.257`** 로 25패치 올라간다 — 사용자가 보는 실질 변화는 대부분 이쪽이다.

세 버전(0.71/0.72/0.73)이 더한 것 중 화면에 닿는 것:

1. **대화 제목** — 어댑터가 CLI 에 `generate_session_title` 을 따로 요청해 세션당 한 번만 붙이고 래치한다. 전에는 AI 제목이 붙기 전까지 마지막 지시문이 제목으로 새어 나왔고, `acpTitle.ts` 의 메아리 걸러내기가 그 흔적이다 — 생성 실패·미도달 구간의 폴백이 여전히 첫 지시문이라 **걸러내기는 남겨 뒀다**.
2. **effort 가 모델별로 기억된다** — 옵션 모양(`select`: default + 레벨들)은 완전히 동일해서 `EffortControl` 은 손대지 않았다. 모델 전환 시 값이 강제로 덮이지 않는 것만 달라진다.
3. **ExitPlanMode 승인에 "컨텍스트를 비우고 계획만 들고 이어가기"** 선택지가 붙는다 — 이번 라운드의 두 번째 작업.

## 동작 흐름

**상향은 상수 하나다.** `adapter::PINNED_VERSION` 을 올리면 `acp_ensure`(commands/acp.rs)가 `adapter_ok == false` 를 보고 다음 AI 패널 실행 때 npm 재설치를 스스로 돈다 — 사용자 액션이 따로 필요 없다.

**capabilities 는 일부러 안 늘렸다.** 0.71.0 이 더한 `nativeSubagentSessions` · `asyncTasks` 를 광고하면 `subagent_spawned` · `subagent_state_update` · `async_task_*` 5종이 흘러 들어오는데, 이건 아직 ACP 초안(agent-client-protocol#1992)이라 어댑터가 타입을 자체 정의해 두고 있다. Rust 쪽 `SessionUpdate` 는 최신 스키마 1.7.0 에도 이 종류가 없고 `#[serde(other)]` 폴백이 없어 **모르는 태그는 역직렬화가 실패한다** — "모르는 종류는 흘려보낸다"는 우리 방어선(session.rs)은 파싱을 통과한 뒤에나 작동한다. 게다가 `agent-client-protocol 2.0.0` 이 스키마를 `=1.5.0` 으로 못박고 있어 단독 상향도 불가. 근거를 `process.rs` 의 광고 지점 주석에 남겼다.

**계획모드 선택지.** 0.73 의 ExitPlanMode 승인은 최대 4+1 개를 준다:

| optionId | 라벨 | kind |
|---|---|---|
| `exit-plan-clear-{auto\|bypass\|accept-edits}` | Yes, clear context (37% used) and … | `allow_always` |
| `exit-plan-{auto\|bypass\|accept-edits}` | Yes, and … | `allow_always` |
| `exit-plan-default` | Yes, manually approve edits | `allow_once` |
| `reject` | No, keep planning | `reject_once` |

문제는 위 둘이 **같은 `allow_always`** 라 카드에서 `perm-always` 한 벌로 똑같이 그려진다는 것이다. 글자만 다르고 무게가 같은데 실제로는 하나가 이 대화를 통째로 버린다.

- `conversation/permissionOptions.ts` 의 `clearsContext(optionId)` 가 `exit-plan-clear-` 접두사로 가려낸다. **라벨로 판별하지 않는다** — 영문이고 `(37% used)` 처럼 값이 섞여 다음 버전에서 조용히 헛돈다. 비우지 않는 형제들과 접두사가 겹치지 않아 오탐이 없다.
- `PermissionCard` 는 그 선택지에만 `.btn.perm-destructive`(경고색)를 주고, 무엇이 사라지는지 한 줄을 **버튼 위**에 적는다 — 누른 뒤에 알면 늦다.

## 검증

- 스파이크 재실행(`docs/acp-panel/spike/acp_spike.py`) — 0.73.0 실측에서 핸드셰이크 `protocolVersion: 1` 그대로, 관측된 `session/update` 는 `available_commands_update` · `usage_update` · `agent_message_chunk` 뿐으로 새 종류 없음.
- 신규 테스트 6건 — `clearsContext` 판별 3건, 카드 렌더 3건(경고 낯빛 부여·형제와 미혼동·설명이 버튼보다 앞·평범한 승인엔 미부착).
- 게이트 전부 exit 0 직접 확인: `pnpm typecheck` · `pnpm test`(148파일 1850건) · `pnpm lint` · `pnpm build` · `cargo test` · `cargo fmt --check` · `cargo clippy --all-targets -D warnings`. `bindings.ts` 는 백엔드 시그니처 무변경이라 재생성 후에도 diff 없음.