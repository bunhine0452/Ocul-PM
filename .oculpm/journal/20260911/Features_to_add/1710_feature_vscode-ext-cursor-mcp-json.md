---
schema_version: 1
type: feature
slug: "vscode-ext-cursor-mcp-json"
status: done
difficulty: low
created_at: "2026-09-11T17:10:22+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/src/cursor/mcpJson.ts"
    op: create
  - path: "extension/src/cursor/mcpJson.spec.ts"
    op: create
  - path: "extension/src/cursor/register.ts"
    op: create
  - path: "extension/src/extension.ts"
    op: update
  - path: "extension/src/commandRegistry.ts"
    op: update
  - path: "extension/package.json"
    op: update
related: []
tags:
  - "vscode"
  - "extension"
  - "cursor"
  - "mcp"
  - "mcp-tool"
---
[x] VS Code 확장 Cursor 경로 — .cursor/mcp.json 에 oculpm 키만 머지(파싱 불가 파일 무접촉)

## 추가 기능

플랜 `vscode-extension-round` `{#ag-cursor}` — `vscode.lm` MCP 공급자 API 가 없는 포크(Cursor 는 2026-02 시점 미지원, Antigravity 동류 추정)를 위한 옵인 커맨드 `ocul-pm.registerCursorMcp`: `.cursor/mcp.json` 의 `mcpServers.oculpm` 에 `{command, args ["--root", 루트], env {OCULPM_AGENT_ID: "cursor"}}` 를 머지. 컨텍스트 키 `oculpm.mcpProviderApi` 로 **API 가 있는 VS Code 에선 팔레트에서 숨긴다**(`when: !oculpm.readOnly && !oculpm.mcpProviderApi`). 모달이 "바이너리 경로는 이 머신 것" 을 고지(register.rs 의 D3 캐비앗 그대로).

## 동작 흐름

`mergeCursorMcpJson(raw, entry)` 순수 함수 — `register.rs` 규율 복제: 없음/빈 파일 → 생성, **파싱 불가·최상위 비객체·`mcpServers` 비객체 → error(아무것도 안 씀)**, 남의 키 보존, 같은 값이면 `unchanged`(멱등), pretty+개행. `isRegistered` 는 우리 키 또는 command 의 `oculpm-mcp` 서명. 디스크는 커맨드 층이 만진다.

## 검증

vitest 신규 3(23 통과): 남의 키·`other` 보존, 두 번째 호출 unchanged, 손상 JSON 3종 전부 error(`kind === "error"` 이고 text 없음). `pnpm compile && pnpm test` exit 0(mocha 8), 루트 `lint:extension` OK. Cursor 실기기에서 도구 노출은 EVALS 8번.