---
schema_version: 1
type: feature
slug: "cursor-gemini-mcp-registration"
status: done
difficulty: medium
created_at: "2026-11-23T21:24:24+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/claude-integration/07-other-agents.md"
    op: create
  - path: "extension/CHANGELOG.md"
    op: update
  - path: "extension/README.md"
    op: update
  - path: "extension/l10n/bundle.l10n.ko.json"
    op: update
  - path: "extension/package.json"
    op: update
  - path: "extension/package.nls.json"
    op: update
  - path: "extension/package.nls.ko.json"
    op: update
  - path: "extension/src/extension.ts"
    op: update
  - path: "extension/src/model/start.spec.ts"
    op: create
  - path: "extension/src/model/start.ts"
    op: create
  - path: "plugin/oculpm-codex/.codex-plugin/plugin.json"
    op: update
  - path: "plugin/oculpm-codex/skills/inception/SKILL.md"
    op: create
  - path: "plugin/oculpm-codex/skills/next/SKILL.md"
    op: create
  - path: "plugin/oculpm-codex/skills/oculpm-codex/SKILL.md"
    op: update
  - path: "plugin/oculpm-codex/skills/redteam/SKILL.md"
    op: create
  - path: "plugin/oculpm/skills/help/SKILL.md"
    op: update
  - path: "src-tauri/src/commands/mcp.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/agent_json.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/agent_json_tests.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/mod.rs"
    op: update
  - path: "src-tauri/tests/other_agents_docs.rs"
    op: create
  - path: "src-tauri/tests/plugin_codex_skills.rs"
    op: create
  - path: "src/__tests__/settings_agent_mcp.test.tsx"
    op: create
  - path: "src/features/settings/AgentMcpRow.tsx"
    op: create
related: []
tags:
  - "설정"
  - "love-round"
  - "agents"
  - "mcp-tool"
---
[x] 설정: Cursor · Gemini 에 MCP 를 등록한다

## 추가 기능
- **Cursor · Gemini CLI MCP 등록**(사용자 결정 11-23): 설정 · 에이전트 칸에 Codex 행과 같은 모양의 행. 그 도구를 쓰는 흔적이 있을 때만 서고, 「등록」 을 누를 때만 그 프로젝트의 `.cursor/mcp.json` · `.gemini/settings.json` 의 mcpServers 에 제자리 병합한다 — 모르는 키 · 순서 보존, 이미 있으면 멱등, 주석 · 깨진 JSON 은 덮어쓰지 않고 경로와 이유를 보인다(agent_json.rs).
- Codex 플러그인에 next · inception · redteam 스킬(Claude 원문에서 렌더, `plugin_codex_skills` 가 글자 단위로 문다).
- MCP 없는 에이전트용 셸 CLI 안내(docs/claude-integration/07-other-agents.md · help 스킬).
- VS Code 확장: `.oculpm` 이 없는 폴더의 패널에 시작 안내와 설치 두 줄 복사(읽기 전용 원칙 유지, 판은 Unreleased).

## 동작 흐름
등록에 쓰는 실행 경로는 기존 Claude/Codex 등록과 같은 출처다. 쓰는 파일은 프로젝트 안뿐이고 네트워크 · 자식 프로세스는 없다(원장 두 곳 변경 없음, 시험 픽스처 `example.invalid` 만 원장에 사유와 함께).

## 검증
vitest `settings_agent_mcp` + `i18n_glossary` 32 passed, extension vitest 81 passed, 로컬 `plugin_codex_skills` 4 · `other_agents_docs` 2 passed. PR #177 CI 통과.