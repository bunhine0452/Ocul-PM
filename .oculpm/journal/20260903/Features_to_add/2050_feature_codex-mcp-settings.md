---
schema_version: 1
type: feature
slug: codex-mcp-settings
status: done
created_at: 2026-09-03T20:50:36+09:00
session_id: "manual-20260903-205036"
agent:
  id: codex
  version: gpt-5.6-terra
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/Cargo.toml
    op: update
  - path: src-tauri/src/commands/mcp.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/src/oculpm/mcp/mod.rs
    op: update
  - path: src-tauri/src/oculpm/mcp/codex.rs
    op: create
  - path: src-tauri/src/oculpm/mcp/register.rs
    op: update
  - path: src/api/oculpm.ts
    op: update
  - path: src/features/settings/CodexMcpServerBlock.tsx
    op: create
  - path: src/features/settings/OculpmSettings.tsx
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: src/__tests__/mcp_settings.test.tsx
    op: update
  - path: plugin/oculpm-codex/.codex-plugin/plugin.json
    op: create
  - path: plugin/oculpm-codex/skills/oculpm-codex/SKILL.md
    op: create
related:
  - 20260903/Errors/2025_error_codex-oculpm-mcp-startup.md
  - 20260903/Features_to_add/1345_feature_codex-acp-integration.md
tags:
  - codex
  - mcp
  - settings
  - plugin
---

[x] Claude와 독립된 Codex MCP 설정 및 플러그인 추가

## 추가 기능

설정 → 연동에 Codex MCP 서버 카드를 추가했다. 등록·해제는 Claude의 플러그인이나
`.mcp.json`을 건드리지 않고, 현재 프로젝트 루트만 가리키는 `~/.codex/config.toml`
stdio 서버를 관리한다. Codex 전용 플러그인은 Claude 환경 변수를 포함하지 않는
스킬 패키지로 분리했다.

## 동작 흐름

1. Codex 카드가 설정 폴더·바이너리·현재 프로젝트 등록 상태를 표시한다.
2. 등록은 기존 TOML 주석과 외부 MCP 서버를 보존하고 `oculpm-<project>` 키를 추가한다.
3. 동명 프로젝트 충돌은 경로 해시 접미로 피하며, 해제는 현재 프로젝트 엔트리만 제거한다.
4. 새 Codex 세션부터 반영됨을 표시한다. Claude Code 연동은 그대로 독립 동작한다.

## 검증

`cargo test --manifest-path src-tauri/Cargo.toml oculpm::mcp::register::tests --lib` 11건 통과.
`pnpm typecheck`, `pnpm vitest run src/__tests__/mcp_settings.test.tsx` 21건, `pnpm lint`,
`cargo fmt --check`, Codex 플러그인 검증이 모두 통과했다.
