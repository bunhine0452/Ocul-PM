---
schema_version: 1
type: feature
slug: "project-init-command-and-restart-note"
status: done
difficulty: low
created_at: "2026-07-31T18:02:14+09:00"
session_id: "mcp-20260731-180214"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/commands/project_init.md"
    op: create
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "docs/claude-integration/06-plugin-contract.md"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
related: []
tags:
  - "plugin"
  - "commands"
  - "project-init"
  - "settings"
  - "ux"
  - "mcp-tool"
---
[x] /oculpm:project_init 커맨드 + MCP 등록 변경 시 재시작 안내

## 추가 기능

- **`/oculpm:project_init` 슬래시 커맨드** (사용자 요청): 커맨드 실행 자체가 "추적 시작의 명시적 요청"이므로 재확인 없이 `project_init(confirm=true)` 를 호출하고, 생성물 요약 + 다음 행동(인셉션 스킬/git 백필)을 제안. 도구 미연결이면 파일을 직접 만들지 않고 앱 안내.
- plugin_manifest 예산 테스트를 **커맨드 전수 스캔**으로 확장 (2종 고정 — project_init.md·standup.md, description 예산 합산에 자동 포함).
- 계약 문서 표의 커맨드 행 2종으로 갱신.
- **설정 → MCP 등록/해제 토스트에 재시작 안내** (사용자 요청): Claude Code 는 .mcp.json 을 세션 시작 시에만 읽으므로 "열려 있는 세션은 재시작해야 반영" 문구를 등록·해제 양쪽에 추가.

## 동작 흐름

플러그인 업데이트 후 새 저장소에서 `/oculpm:project_init` 입력 → .oculpm/·AGENTS.md·gitignore 보호 생성 보고 → "project-inception 스킬로 설계를 시작할까요?" 제안.

## 검증

`cargo test --test plugin_manifest` 6/6 (커맨드 2종·예산 통과), typecheck/test/build/lint exit 0.