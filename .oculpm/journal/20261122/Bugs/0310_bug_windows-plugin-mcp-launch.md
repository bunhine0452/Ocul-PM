---
schema_version: 1
type: bug
slug: "windows-plugin-mcp-launch"
status: done
difficulty: medium
created_at: "2026-11-22T03:10:55+09:00"
session_id: "manual-20261122-031055"
agent:
  id: "claude-code"
  version: "Fable 5.2"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/.mcp.json"
    op: update
  - path: "plugin/oculpm/bin/Windows_NT/oculpm-mcp.cmd"
    op: create
  - path: "plugin/oculpm/bin/posix/oculpm-mcp"
    op: create
  - path: "plugin/oculpm/README.md"
    op: update
  - path: "src-tauri/tests/plugin_xplat.rs"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "docs/claude-integration/06-plugin-contract.md"
    op: update
  - path: "src/features/settings/AgentsSection.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/i18n_platform_words.test.ts"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/wiki-src/agents.md"
    op: update
  - path: "landing/wiki-src/settings.md"
    op: update
  - path: "landing/wiki-src/en/agents.md"
    op: update
  - path: "landing/wiki-src/en/settings.md"
    op: update
related: []
tags:
  - "플러그인"
  - "windows"
  - "mcp"
---
[x] 플러그인: Windows 에서 MCP 서버가 붙는다

## 발생 원인

Windows 의 Claude Code 는 stdio MCP 서버를 셸 없이 띄운다. 플러그인의 등록 명령은 sh 셔틀(`bin/oculpm-mcp`)이었고, Claude Code 는 그 파일의 `#!` 줄을 읽어 `sh` 를 불렀다. PowerShell 이나 cmd 에서 띄운 세션의 PATH 에는 `sh` 가 없다(Git for Windows 는 `cmd\git.exe` 만 PATH 에 싣는다). 이 기기의 MCP 로그 9회가 전부 `'sh' 은(는) 내부 또는 외부 명령 … 아닙니다` → `CONNECTION_CLOSED` 였다. 그래서 Windows 에서는 `journal_write` · `plan_update` · `ask_user` 가 한 번도 뜨지 않았고 에이전트가 규격서를 읽어 파일을 손으로 썼다. 문서는 「`.mcp.json` 은 OS 별로 가를 수 없다」 고 적고 앱의 직접 등록을 우회로로 안내해 왔다.

## 해결 방법

등록 명령을 `${CLAUDE_PLUGIN_ROOT}/bin/${OS:-posix}/oculpm-mcp` 로 바꿨다. `OS` 는 Windows 에만 늘 있는 환경변수(`Windows_NT`)라 Windows 는 `bin/Windows_NT/oculpm-mcp.cmd` 로 가고(확장자 없는 경로를 PATHEXT 로 푼다), 그 변수가 없는 macOS · Linux 는 기본값으로 `bin/posix/oculpm-mcp` 에 와서 예전 셔틀로 넘기기만 한다. `.cmd` 실행기는 셔틀과 같은 순서로 찾는다(`OCULPM_MCP_BIN` → 사용자 설치 → 다중 사용자 → 시스템 설치 → 리포 개발 빌드). ASCII 만 쓰고 레이블 · goto 를 쓰지 않는다(LF 배치 파일의 함정 — `run-sh.cmd` 와 같은 규칙). 훅은 그대로 셔틀을 부른다.

두 보간은 먼저 조사용 플러그인으로 쟀다: `${OS:-posix}` → `Windows_NT`, 없는 변수의 `${X:-posix}` → `posix`, 확장자 없는 경로 → `.cmd` 실행.

「Windows 에서는 플러그인 MCP 가 뜨지 않는다」 고 말하던 자리를 고쳤다: 설정의 「MCP 직접 등록」 메타 문구, 쓰이지 않는 `op.*__win` 사전 키 셋, 플러그인 README, 계약 문서, README 두 벌, 위키 원본 네 편. 직접 등록은 플러그인 없이 쓰거나 4.12 미만 플러그인일 때의 우회로로 남는다.

## 검증

- `claude --plugin-dir plugin/oculpm mcp list` (Claude Code 2.1.330 · Windows): `plugin:oculpm:oculpm … ✔ Connected` — 고치기 전에는 `✘ Failed to connect — CONNECTION_CLOSED`
- `cargo test --locked --test plugin_xplat --test plugin_manifest`: `test result: ok. 18 passed; 0 failed` · `test result: ok. 10 passed; 0 failed`
- `vitest run src/__tests__/i18n_platform_words.test.ts`: `Tests  19 passed (19)`

## 메모

macOS · Linux 쪽은 이 기기에서 못 돌렸다. `the_registered_mcp_command_starts_the_server_on_this_os` 가 세 OS 러너에서 등록 명령을 그 OS 의 방식으로 띄우니 CI 가 본다. `OS` 를 스스로 내보내는 macOS · Linux 환경에서는 `bin/<그 값>/` 이 없어 MCP 가 뜨지 않는다(계약 문서에 적었다).
