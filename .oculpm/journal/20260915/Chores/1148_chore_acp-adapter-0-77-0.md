---
schema_version: 1
type: chore
slug: "acp-adapter-0-77-0"
status: done
difficulty: low
created_at: "2026-09-15T11:48:37+09:00"
session_id: "20260915-002"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b264922e-7832-4206-995a-f4582387624e"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
  - path: "src/__tests__/i18n_english_screens.test.tsx"
    op: update
  - path: "src/__tests__/shell_acp_view_no_today_fallback.test.tsx"
    op: update
related: []
tags:
  - "acp"
  - "adapter"
  - "claude-code"
  - "mcp-tool"
---
[x] claude-agent-acp 0.76.0 → 0.77.0 (번들 SDK 0.3.270, agent 옵션 제거, defaultToNo)

## 변경 요약

관례대로 두 tarball 의 `dist/` 를 대조했다(11개 파일 변경). 우리 계기에 닿는 것:

- **번들 SDK `0.3.257` → `0.3.270`** — 딸려 오는 Claude Code CLI 도 함께 바뀐다.
- **agent 설정 옵션 제거** (`AGENT_CONFIG_ID`·`DEFAULT_AGENT_ID` 삭제). 우리 셀렉터는 온 목록을 그대로 그리고 `id === "agent"` 를 집는 코드가 없어 항목 하나가 사라질 뿐.
- **권한 요청 `defaultToNo`** (SDK 0.3.268+ 의 삭제류 Bash·Artifact 게시 안전 확인): 거절 선택지를 앞에 정렬하고 `_meta` 에 힌트. `PermissionCard` 는 kind 로 강조하고 포커스를 뺏지 않으므로 순서만 바뀐다(의도된 "거절이 먼저"). `suppressAlwaysAllowRule` 이면 「항상 허용」이 안 온다.
- `sessionFailure.reason` `access_denied` 신설(category `access`) — `FailureRow` 는 category 로 분기하지 않는다.
- 나머지(재시도 `no_response` 문구, 재생 메시지의 `<system-reminder>` 제거, `owedTrailingIdles` 리셋, elicitation 다중선택 병합, TaskList 파서, `allowBypass`)는 어댑터 내부 또는 우리가 광고하지 않는 capability.

`PINNED_VERSION` 한 줄 + 대조 주석, 테스트 mock 의 버전 문자열 2곳.

## 검증

- `pnpm vitest run` 해당 테스트 2파일 16 통과, 전체 `pnpm test` 2711 통과.
- `cargo test` (acp_handshake 는 기본 ignored) · clippy · fmt 통과.