---
schema_version: 1
type: bug
slug: "port-integ-paths-home-guard"
status: done
difficulty: high
created_at: "2026-09-24T04:01:03+09:00"
session_id: "20260924-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/paths/tool_config.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/register.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/codex.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/acp/recording.rs"
    op: update
  - path: "src-tauri/src/acp/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/plugin_xplat.rs"
    op: create
  - path: "src-tauri/tests/delivery_gate.rs"
    op: update
  - path: "plugin/oculpm/bin/oculpm-mcp"
    op: update
  - path: "plugin/oculpm-codex/hooks/hooks.json"
    op: update
  - path: "plugin/oculpm-codex/hooks/run-sh.cmd"
    op: create
  - path: "scripts/build-sidecar.mjs"
    op: update
  - path: ".github/workflows/portability.yml"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
  - path: "docs/claude-integration/06-plugin-contract.md"
    op: update
related:
  - ref: "20260924/Features_to_add/0240_feature_port-os-branches-los.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "plugin"
  - "mcp"
  - "mcp-tool"
---
[x] 외부 도구 연동 경로 — 설정 위치·사이드카·플러그인·훅, Windows 홈 폴더 가드 결함 (L-INTEG, PR #36)

## 발생 원인

- **홈 폴더 초기화 가드가 Windows 에서 꺼져 있었다** — `project_init` 이 `HOME` 환경변수와 비교했는데 Windows 에는 HOME 이 없다. 에이전트가 사용자 홈 전체를 `.oculpm` 프로젝트로 초기화하는 것을 막는 가드였다.
- 외부 도구 설정 위치가 흩어져 있었고 macOS 전제였다(Claude Desktop `~/Library/…`). Windows 의 Claude Desktop 은 **MSIX 판이 %APPDATA% 가 아닌 LocalCache 를 읽는다**(claude-code#25579 등).
- 플러그인 셔틀은 macOS `.app` 만 찾았고, Codex 는 Windows 에서 훅을 cmd.exe 로 돌려 sh 훅이 돌지 않는다.
- 인벤토리의 `codex_register_collapses_legacy_pinned_entries` 는 픽스처가 TOML 문자열을 손으로 조립한 탓(실제 쓰기는 toml_edit 값).

## 해결 방법

- `oculpm/paths/tool_config.rs` 한 곳: 홈(`directories`), `~/.claude`, `CODEX_HOME`, Claude Desktop(Windows MSIX 먼저), AppImage 사이드카 안정 자리. `paths::is_home_dir` 로 가드 수정.
- 사이드카: AppImage 는 마운트 밖으로 해시 비교 복사(기동 훅), 셔틀 탐색 목록을 앱 `acp/recording.rs` 와 같은 자리·순서로(대조 테스트).
- 훅: 조사 근거 — Claude Code 는 Windows 에서 Git Bash(없으면 PowerShell), Codex 는 `%COMSPEC% /C` + `commandWindows` 인식(codex-rs 소스). Claude 판 hooks.json 불변, Codex 판에만 `commandWindows` + `run-sh.cmd`.
- 오케스트레이터가 승인한 소유 밖 변경 7개(lib.rs 기동 훅 · portability 사이드카 잡 · marketplace · 계약 문서 §4 · 홈 가드 · codex_home · stable_sidecar_dir)를 레인이 반영.
- **README 안내가 틀린 채 나갈 뻔했다** — 없는 메뉴 경로였고, 앱 문구 셋은 Windows 에서 따르면 MCP 가 하나도 안 남는다 → README 바로잡음, 앱 문구는 #ui-followups.

## 검증

- portability 35902734631: ubuntu 초록, windows 이 레인 몫 전부 초록(홈 가드는 **실제 러너 홈**을 거부하는 테스트) · 남은 실패 1건은 L-SHELL 몫. 사이드카 잡: windows `.exe` 27.4MB·ubuntu release(thin LTO) 링크·실행 — D11 부분 증거.
- 오케스트레이터 검토: build-sidecar.mjs 는 macOS 릴리스에서 같은 경로·이름, 훅 sed 는 macOS 경로에 없는 `\\` 만 푼다. PR #36 ci.yml 3잡 SUCCESS → rebase 머지 e82b3505.
- CI 로 못 본 것: 실제 AppImage 복사, Windows 의 실제 Claude Code·Codex·Claude Desktop(MSIX), deb 실설치. 사용자 결정: #integ-win-plugin-mcp.