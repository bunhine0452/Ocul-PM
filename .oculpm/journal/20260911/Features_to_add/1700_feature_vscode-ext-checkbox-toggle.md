---
schema_version: 1
type: feature
slug: "vscode-ext-checkbox-toggle"
status: done
difficulty: medium
created_at: "2026-09-11T17:00:49+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/src/mcp/client.ts"
    op: create
  - path: "extension/src/mcp/pool.ts"
    op: create
  - path: "extension/src/tree/toggle.ts"
    op: create
  - path: "extension/src/tree/planModel.ts"
    op: update
  - path: "extension/src/tree/planTree.ts"
    op: update
  - path: "extension/src/tree/planTree.spec.ts"
    op: update
  - path: "extension/src/extension.ts"
    op: update
  - path: "extension/src/test/extension.test.ts"
    op: update
related: []
tags:
  - "vscode"
  - "extension"
  - "mcp"
  - "planner"
  - "mcp-tool"
---
[x] VS Code 확장 첫 쓰기 경로 — 체크박스 토글이 oculpm-mcp plan_update 로 간다

## 추가 기능

플랜 `vscode-extension-round` `{#sb-toggle}` + 하위 2 — 활성 플랜 트리의 **리프** 항목에 `TreeItemCheckboxState`(`manageCheckboxStateManually`). 체크 → `plan_status(plan_id)` 로 hash → `plan_update(base_hash, status done|todo, note "VS Code 체크박스")`. 파일은 한 줄도 직접 안 고친다 — 글리프·plan-log·잠금·CAS 전부 서버 규격. 충돌(`write-conflict:` 접두)이면 한 번 다시 읽어 재시도, 실패는 토스트 + 트리 갱신(체크박스가 디스크 상태로 복귀). `checkboxFor` 규칙: 잠긴 플랜(`{#sb-toggle-lock}`)·부모(롤업)·읽기 전용은 체크박스 없이 툴팁에 이유.

## 동작 흐름

- **MCP 클라이언트는 직접 썼다**(`{#sb-toggle-client}` 문구는 `@modelcontextprotocol/sdk`): 서버 `protocol.rs` 가 같은 이유(표면이 initialize/tools/call 뿐, SDK 변동 리스크)로 직접 구현했고, SDK 1.30 은 ESM 전용에 의존성이 많아 CJS 번들·`^1.101` 하한과 마찰이 크다. 그래도 handshake(initialize → notifications/initialized)는 표준대로. 라인 JSON-RPC, 요청별 10초 타임아웃, `isError` → `McpToolError`, 프로세스 종료 시 대기 중 요청 전부 reject. `OCULPM_AGENT_ID=vscode-ext` 로 띄워 plan-log 귀속. 루트별 프로세스 풀(`McpPool`), 바이너리 재탐색 시 전부 닫고 재시작. stderr 는 출력 채널 "Ocul-PM".
- 상태 순환(트리는 readOnly 를 상태에서, 상태는 트리를 담음)을 가변 필드 두 개로 풀었다.

## 검증

- mocha 신규 1(실제 `oculpm-mcp` 사용, 앱 없는 머신은 skip): 임시 프로젝트에 활성/잠긴 플랜 2개 → `[ ]`→`[x]` 가 디스크에, `| #leaf | vscode-ext |` 행이 plan-log 에, 되돌리기 `todo`, 잠긴 플랜은 `rejects` 하고 파일 바이트 불변. vitest 신규 `checkboxFor` 4경우.
- `pnpm compile && pnpm test` exit 0(vitest 18·mocha 6), 루트 `lint:extension` OK. 앱 플래너 화면이 워처로 같이 바뀌는 장면은 EVALS 2번(실기기).