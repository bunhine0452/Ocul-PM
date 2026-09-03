---
schema_version: 1
type: error
slug: codex-oculpm-mcp-startup
status: done
created_at: 2026-09-03T20:25:53+09:00
session_id: "manual-20260903-202553"
agent:
  id: codex
  version: gpt-5.6-terra
language: ko
verified_by_user: false
files_touched:
  - path: .oculpm/journal/20260903/Errors/2025_error_codex-oculpm-mcp-startup.md
    op: create
related:
  - 20260720/Chores/1607_chore_phase-a-runtime-verify.md
tags:
  - codex
  - oculpm
  - mcp
  - configuration
---

[x] Codex에서 oculpm MCP 시작 실패 진단

## 발생 원인

Codex에 설치된 oculpm 2.38.0 플러그인의 `.mcp.json`이 Claude 전용 환경 변수인
`${CLAUDE_PLUGIN_ROOT}`와 `${CLAUDE_PROJECT_DIR}`를 사용한다. Codex가 이 변수를
해석하지 못하면 MCP 실행 명령의 경로가 존재하지 않아 시작 단계에서 실패한다.

## 해결 방법

ocul-pm 앱 번들(`/Applications/ocul-pm.app`)과 포함된 `oculpm-mcp` 2.38.0 바이너리는
정상임을 확인했다. Codex에서는 Claude 형식 플러그인을 비활성화하고, 절대 경로를 쓰는
별도 stdio MCP 등록으로 전환하면 된다.

## 검증

`/Applications/ocul-pm.app/Contents/MacOS/oculpm-mcp --version`이 `2.38.0`을 반환했다.
플러그인의 셔틀도 이 저장소 root 인수로 stdio 대기 상태까지 정상 진입했다.
