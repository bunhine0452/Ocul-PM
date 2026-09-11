---
schema_version: 1
type: feature
slug: "vscode-ext-mcp-provider"
status: done
difficulty: medium
created_at: "2026-09-11T17:06:26+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/src/mcp/provider.ts"
    op: create
  - path: "extension/src/mcp/providerModel.ts"
    op: create
  - path: "extension/src/mcp/provider.spec.ts"
    op: create
  - path: "extension/src/injectRules.ts"
    op: create
  - path: "extension/src/extension.ts"
    op: update
  - path: "extension/src/commandRegistry.ts"
    op: update
  - path: "extension/src/test/extension.test.ts"
    op: update
  - path: "extension/package.json"
    op: update
related: []
tags:
  - "vscode"
  - "extension"
  - "mcp"
  - "copilot"
  - "agents-md"
  - "mcp-tool"
---
[x] VS Code 확장 MCP 공급자 — Copilot 이 oculpm-mcp 를 본다 + 규칙 주입은 project_init 재사용

## 추가 기능

플랜 `vscode-extension-round` `{#ag-mcp}` + 하위 2.
- `contributes.mcpServerDefinitionProviders` `oculpm` + `vscode.lm.registerMcpServerDefinitionProvider` — 추적 폴더마다 `McpStdioServerDefinition(label "oculpm (<폴더>)", command=바이너리, args ["--root", 폴더], env OCULPM_AGENT_ID)`, `cwd` 는 생성자 인자가 아니라 필드라 따로 넣어 서버의 `conflicting_tracked_root` 가드와 맞춘다. 바이너리 없으면 **0개**(오류 아님), `onDidChangeMcpServerDefinitions` 는 폴더 변경·설정(`mcpBinaryPath`·`mcpAgentId`) 변경·재탐색에 발화(`{#ag-mcp-env}`). `vscode.lm` 이 없는 포크(Cursor)는 등록을 건너뛴다. 새 설정 `oculpm.mcpAgentId`(기본 `copilot`) — 에이전트가 쓰는 일지의 `agent.id`.
- **규칙 주입 커맨드** `ocul-pm.injectRules`(첫 WRITE 커맨드, `when: !oculpm.readOnly`, 모달 확인): 확장이 템플릿 복사본을 갖지 않는다 — `project_init` 이 이미 추적 중인 프로젝트에서 **ensure 시맨틱**(`sync_active` 호출)이라 앱의 AGENTS.md 동기와 같은 Rust 함수 → 바이트 동일이 구조로 보장(`{#ag-mcp-rules}`). 미추적 폴더는 거부(추적 시작은 앱의 일).

## 동작 흐름

- **`@types/vscode` 가 `^1.101.0` 캐럿으로 1.137 을 받고 있었다** — engines 하한보다 새 타입은 `vsce` 가 패키징을 거부하고, 1.137 에만 있는 API 를 모르고 쓸 위험. `1.101.0` 으로 정확히 고정, 지금까지 쓴 API(체크박스·MCP 공급자) 전부 1.101 타입에 있음을 확인.
- VS Code 엔 등록된 MCP 정의를 읽는 API 가 없어 `ext.exports.mcp().provide()` 로 테스트가 직접 공급 함수를 부른다.

## 검증

- mocha 신규 2: 이 저장소 정의 = `oculpm (ai-pm)`·`--root <repo>`·`cwd`·`OCULPM_AGENT_ID=copilot`; 임시 추적 프로젝트에 `project_init(confirm)` → `initialized:false`(보완만)·AGENTS.md 관리 블록·`_template.md` 시드·두 번째 호출 바이트 불변. vitest 신규 `definitionsFor` 2.
- `pnpm compile && pnpm test` exit 0(vitest 20·mocha 8), 루트 `lint:extension` OK. 'MCP: List Servers' 에 실제로 뜨는 화면·Copilot 도구 노출은 EVALS 5번(실기기).