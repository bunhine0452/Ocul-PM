---
schema_version: 1
type: feature
slug: "plugin-schema-paths-alignment"
status: done
difficulty: medium
created_at: "2026-07-31T01:06:06+09:00"
session_id: "mcp-20260731-010606"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: "plugin/oculpm/.mcp.json"
    op: update
  - path: "plugin/oculpm/bin/oculpm-mcp"
    op: create
  - path: "plugin/oculpm/README.md"
    op: update
  - path: "scripts/build-sidecar.mjs"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: create
related: []
tags:
  - "plugin"
  - "mcp"
  - "marketplace-prep"
  - "plugin-round"
  - "mcp-tool"
---
[x] 플러그인 스키마·경로 정합 — 자동발견 위임 + bin 셔틀 + 버전 자동 동기 (A1)

## 추가 기능

plugin-round A1. 마켓플레이스 공개(A3)의 전제가 되는 플러그인 구조 정합 4종:

1. **plugin.json 최소화** — `hooks`/`mcpServers` 필드 제거(자동발견 위임 — ECC 의 add/revert 4회 flip-flop 이력이 보여주듯 선언 가부는 CLI 버전에 따라 흔들리므로, 신·구 모두 안전한 자동발견 쪽을 계약으로 고정), displayName 등 비문서 필드 제거, repository 추가.
2. **bin/oculpm-mcp 셔틀** — `.mcp.json` 의 macOS 절대경로 하드코딩을 `${CLAUDE_PLUGIN_ROOT}/bin/oculpm-mcp` 로 교체. 셔틀(POSIX sh)이 OCULPM_MCP_BIN → .app 번들(시스템/유저) → ~/.local/bin → 리포 개발 빌드 순으로 탐색, 미발견 시 stderr 설치 안내(stdout 은 프로토콜 전용).
3. **버전 자동 동기** — build-sidecar.mjs 가 tauri.conf.json 버전을 plugin.json 에 스탬프(0.1.0 고정 상수 해소, 현재 2.3.1).
4. **불변식 테스트** — `tests/plugin_manifest.rs` 4종: 선언 금지·버전 동기 강제·훅 3이벤트 가드+stdin 소비+네트워크 금지·셔틀 실행 비트(설치 복사의 1순위 고장 원인). README 현행화(요구 사항: macOS v1·CLI 2.1.220·중복 설치 캐비앗).

## 동작 흐름

`claude --plugin-dir plugin/oculpm` → plugin.json(메타만) + hooks/hooks.json·.mcp.json 자동발견 → MCP 가 셔틀 실행 → 셔틀이 실바이너리 exec.

## 검증

- `claude plugin validate` 통과 + `--plugin-dir plugin details` 인벤토리 실측: Hooks 3 · MCP 1 · version 2.3.1 · Always-on ~0 tok.
- 셔틀 단독 실행 `--version` = 2.3.1 해석 성공, initialize 핸드셰이크 왕복 확인.
- cargo test 전체(신규 4 포함) FAILED 0 + typecheck/lint/vitest 332/build 그린.