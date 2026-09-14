---
schema_version: 1
type: feature
slug: "silent-failures-to-screen"
status: done
difficulty: medium
created_at: "2026-09-14T17:55:30+09:00"
session_id: "20260914-001"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d8c385d3-64d1-435b-abff-82b045ae0918"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/overview.rs"
    op: update
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/protocol.rs"
    op: update
  - path: "src-tauri/src/bin/oculpm_mcp.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_tasks.rs"
    op: update
  - path: "src-tauri/src/commands/mcp.rs"
    op: update
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: "src/api/llm.ts"
    op: update
  - path: "src/hooks/useLlmBackgroundToast.ts"
    op: create
  - path: "src/windows/TabbedWindow.tsx"
    op: update
  - path: "src/features/settings/tabs/ModelInput.tsx"
    op: update
  - path: "src/features/settings/VscodeExtensionBlock.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ref: "20260914/Chores/1720_chore_improvement-audit-2026-09-14.md"
    kind: "followup"
tags:
  - "llm"
  - "acp"
  - "mcp"
  - "logging"
  - "settings"
  - "audit-2026-09-14"
  - "mcp-tool"
---
[x] 조용한 실패를 화면으로 — 죽은 모델 토스트·목록 밖 모델 경고 · ACP 안 oculpm-mcp 이중 기동 휴면 · 로그 위생 · 404 마켓 링크 제거

## 추가 기능

감사(1720) 의 7·8·9·10·12번. 넷 다 "로그에만 남고 아무도 모르던 것"이다.

- **죽은 모델 토스트** — 색인 후 개요 생성(`run_generation`)이 실패하면 `LlmBackgroundFailed { provider, model, job, message }` 이벤트를 쏘고, 창 하나에 하나 거는 `useLlmBackgroundToast` 훅이 경고 토스트로 올린다 (같은 provider·model 은 한 시간에 한 번). 같은 입력 서명으로 실패한 개요는 프로세스 수명 동안 재시도하지 않는 백오프(`FAILED_SIGNATURES`) — 기본 nim 모델 `z-ai/glm-5.2` 가 08-21 EOL(410) 된 뒤 3주 동안 색인마다 죽은 엔드포인트를 두드렸다.
- **목록 밖 모델 경고** — 설정의 `ModelInput` 이 받은 목록에 적힌 값이 없으면 `--warn` 색으로 「지원 종료됐거나 이름이 바뀐 모델」이라고 적는다. 목록이 비었거나 못 받았으면 판단하지 않는다.
- **oculpm-mcp 휴면** — 앱이 띄운 ACP 어댑터에 `OCULPM_ACP_HOST=1` 을 싣는다(`protocol::ACP_HOST_ENV`). 그 아래서 플러그인 `.mcp.json` 으로 한 벌 더 뜬 `oculpm-mcp` 는 표식은 있는데 신원(`OCULPM_SESSION_ID`)이 없으므로 `McpServer::dormant` 로 선다 — initialize·ping 엔 답하고 `tools/list` 는 빈 배열, `tools/call` 은 isError. 죽이지 않는 이유는 CLI 가 MCP 실패를 떠들기 때문. 실측: Claude 프로세스 하나에 `oculpm-mcp` 둘(pid 35587/35592), 모델이 플러그인 쪽을 고르면 일지가 신원 없이 적혀 판정 사다리 1순위가 못 알아본다.
- **로그 위생** — `reason=Generated` 스킵은 DEBUG. 파일 로그의 ANSI 는 두 fmt 레이어가 스팬 필드 포맷을 캐시로 공유해(`FormattedFields`) stdout 의 색이 파일에 실리던 것 — stdout 레이어도 `with_ansi(false)`. (레이어 순서 교체는 두 match 팔의 타입이 갈려 컴파일이 안 된다.)
- **마켓 링크** — `VscodeExtensionStatus.marketplace_url` 을 `Option` 으로, 발행 전이라 `None`. 설정 행은 Open VSX 만 보여 준다. egress 원장에서 호스트를 뺐다(발행하면 되살린다).

## 동작 흐름

색인 완료 → `tokio::spawn(run_generation)` → 서명 같고 이전에 실패했으면 `Ok(None)` → 아니면 LLM → `Err` 이면 서명 기록 + `warn!` + 이벤트 emit → `TabbedWindow` 의 훅이 `llmApi.onBackgroundFailed` 로 받아 토스트.

## 검증

- `cargo test` 1,469 + 통합 전부 통과 (egress 원장 11 포함), `cargo clippy --all-targets -D warnings` · `cargo fmt --check` 깨끗.
- 새 테스트: `dormant_server_answers_the_protocol_but_offers_no_tools`, ModelInput 「warns when the typed model is not in the fetched list」, 확장 블록 스냅샷(마켓 링크 없음/있음).
- `pnpm typecheck`·`pnpm test` 전부 통과·`pnpm lint` 6 게이트 통과 (파일 크기 래칫 때문에 토스트 리스너는 WorkspaceContext 가 아니라 별도 훅, ACP_HOST_ENV 는 tools/mod.rs 가 아니라 protocol.rs).
- 실기기(설치본 3.1.0)는 플랜 {#eyes-round-0914}.