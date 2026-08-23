---
schema_version: 1
type: refactor
slug: "settings-integration-scope-split"
status: done
difficulty: low
created_at: "2026-08-23T15:20:24+09:00"
session_id: "manual-20260823-152024"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/mcp_settings.test.tsx"
    op: update
related: []
tags: ["ui", "settings", "integration", "scope", "claude-code"]
---

[x] 설정 연동 탭 — 배지 6개가 서로 다른 범위를 말하고 있었다

## 동기

사용자 질문에서 시작했다. *"이 설정은 프로젝트별로 따로 보여야 하는 것도 있지 않아? 한번 설치하면 모든 프로젝트가 동시에 연결되나?"*

확인해 보니 **섞여 있었다.** 한 섹션에 나란히 놓인 여섯 블록의 적용 범위가 셋은 프로젝트별, 셋은 머신 전역이다.

| 블록 | 쓰는 곳 | 범위 |
|---|---|---|
| 훅 연동 | `<프로젝트>/.claude/settings.local.json` | 프로젝트 |
| MCP 서버 | `<프로젝트>/.mcp.json` | 프로젝트 |
| Claude Desktop | 머신에 하나인 `claude_desktop_config.json`, 단 키가 `oculpm-<폴더명>` | 프로젝트(키 단위) |
| 플러그인 | `~/.claude/plugins` | 머신 |
| ACP 런타임 | node · claude CLI · 어댑터 바이너리 | 머신 |
| 터미널 셸 통합 | `~/.zshrc` | 머신 |

커맨드 시그니처가 이미 그 경계를 말하고 있다 — `claudeHooksStatus(projectId)` / `mcpStatus(projectId)` / `mcpDesktopStatus(projectId)` 대 인자 없는 `claudePluginStatus()` / `acpDiagnose()` / `shellIntegrationStatus()`. 그런데 **화면에는 그 경계가 없었다.** 결과가 이거다: 프로젝트를 바꾸면 배지 셋만 "꺼짐/미등록" 으로 뒤집히는데 왜 그런지 화면에 적힌 데가 없다. "설치됨" 이 이 프로젝트를 말하는지 이 머신을 말하는지 배지만 봐서는 알 수 없었다.

## 변경 요약

- **섹션을 범위로 갈랐다.** `sub === "integration"` 이 이제 `Section` 둘을 낸다 — 「이 프로젝트에만 적용」(훅·MCP·Desktop)과 「이 머신 전체에 적용」(플러그인·ACP·셸). 프로젝트 섹션 머리말은 `useOptionalWorkspace()` 의 `currentProjectName` 을 받아 *"지금 열려 있는 「ai-pm」에만 적용됩니다"* 로 이름을 못박는다(런처엔 프로바이더가 없어 이름 없는 문구로 폴백).
- **블록마다 범위 칩.** 상태 배지와 **의도적으로 다르게** 생겼다 — 색 없는 파선 테두리(`ScopeChip`). 색이 있으면 상태로 읽히고 한 헤더에 배지가 둘인 것처럼 보인다. 섹션 머리말이 이미 범위를 말하지만 스크롤하면 머리말이 화면 밖으로 나가고 배지만 남아서, 칩은 블록 안에 있어야 한다. Desktop 만 「이 프로젝트 키」로 따로 쓴다 — 설정 파일은 머신에 하나이고 프로젝트별인 건 키뿐이라 "이 프로젝트" 는 절반만 참이다.
- **플러그인 파트를 `ClaudePluginBlock` 으로 분리.** 원래 `McpServerBlock` 한 카드가 플러그인(머신) + MCP(프로젝트) + Desktop(프로젝트) 셋을 함께 그렸다. 범위가 다른 것이 한 카드에 있으면 갈라 놓을 수가 없다. 상태·복사 핸들러를 통째로 옮겼고 `projectId` 를 받지 않는다.
- **이중 설정 경고를 위치 중립으로.** `op.plugin.warn` 이 *"아래 프로젝트별 훅 토글"* 이라 했는데 블록이 다른 섹션으로 이사해 "아래" 가 거짓이 됐다. 섹션 이름(「이 프로젝트에만 적용」)으로 가리키게 바꿔 위아래 배치에 안 걸리게 했다.
- 쓰이지 않게 된 `op.claude.title`/`op.claude.desc` 는 양 사전에서 제거(하위 탭 라벨이 이미 "연동" 이라 우산 제목이 중복이었다). 신규 키 8종은 ko/en 양쪽에 추가.

섹션 순서는 프로젝트 먼저다. 머신 블록은 한 번 하면 끝이라 정적이고, 프로젝트를 옮길 때마다 실제로 손대야 하는 쪽이 위에 있어야 한다.

## 검증

- `pnpm test` 1154 통과(신규 5). 새 단언은 MCP·Desktop 헤더가 각각 프로젝트 칩을 달았는지, 플러그인 파트가 `McpServerBlock` 에서 빠졌는지(복사 버튼·머신 칩 부재), `ClaudePluginBlock` 이 `projectId` 없이 서는지, 그리고 경고 문구가 "아래" 를 더 이상 쓰지 않고 섹션 이름을 담는지를 본다 — 마지막 것이 이사와 문구를 함께 묶어 준다.
- `pnpm lint` exit 0 (스토리지 규율 + 하드코딩 한글 0).
- `pnpm typecheck` 는 **exit 0 을 못 봤다.** 남은 41건이 전부 병렬 세션이 작업 중인 `src/features/code/**`(+ `code_tree_lazy.test.tsx`) 의 미완 상태다 — `code.ops.*`/`code.tabs.*` 키를 쓰는 코드는 들어왔는데 사전 항목이 아직 없다. 이 변경이 만진 파일에서는 0건.

## 메모

플러그인이 머신 전역인데도 모든 프로젝트를 무차별로 건드리지는 않는다 — 훅 커맨드가 `if [ -d "${CLAUDE_PROJECT_DIR}/.oculpm" ]` 로 가드되고 MCP args 가 `--root ${CLAUDE_PROJECT_DIR}` 라, `.oculpm` 이 있는 프로젝트에서만 실제로 돈다. "전 프로젝트에 한 번에" 라는 기존 문구는 그래서 거짓이 아니고, 칩도 「이 머신 전체」로 둔 채 문구를 유지했다.

이중 설정 경고는 여전히 플러그인 블록에만 붙는다. 프로젝트 섹션까지 스크롤한 사용자는 못 보는데, 고치려면 플러그인 상태를 body 로 끌어올려 두 블록에 내려야 해서 이번 범위 밖으로 뒀다.

대응하는 플래너 항목은 없다 — `claude-integration` 이 자연스러운 자리지만 `status: done` 이라 수정 금지 대상이고, 활성 plan 넷(acp-agent-panel · ide-completion · lsp-code-intelligence · three-features-round) 중 이 작업에 맞는 항목이 없다.
