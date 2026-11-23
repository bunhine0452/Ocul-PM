---
schema_version: 1
type: feature
slug: "terminal-input-fixes"
status: done
difficulty: high
created_at: "2026-11-23T21:23:54+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/terminal_check_cases.json"
    op: update
  - path: "src-tauri/src/terminal_clipboard.rs"
    op: create
  - path: "src-tauri/src/terminal_env.rs"
    op: update
  - path: "src-tauri/src/terminal_launch_tests.rs"
    op: update
  - path: "src/__tests__/check_ps51.test.ts"
    op: create
  - path: "src/__tests__/osc52_clipboard.test.ts"
    op: create
  - path: "src/__tests__/term_file_paste.test.ts"
    op: create
  - path: "src/__tests__/term_keys_agent.test.ts"
    op: update
  - path: "src/__tests__/term_keys_right_option.test.ts"
    op: create
  - path: "src/__tests__/xtermHarness.ts"
    op: update
  - path: "src/api/terminal.ts"
    op: update
  - path: "src/features/terminal/agentScreen.ts"
    op: update
  - path: "src/features/terminal/filePaste.ts"
    op: create
  - path: "src/features/terminal/imeBridge.ts"
    op: update
  - path: "src/features/terminal/oscClipboard.ts"
    op: create
  - path: "src/features/terminal/pasteSafe.ts"
    op: update
  - path: "src/features/terminal/runCheck.ts"
    op: update
  - path: "src/features/terminal/termCopy.ts"
    op: update
  - path: "src/features/terminal/termKeys.ts"
    op: update
related: []
tags:
  - "터미널"
  - "love-round"
  - "mcp-tool"
---
[x] 터미널: 입력 결함 다섯을 고친다

## 추가 기능
- Claude 의 Ctrl+G 바깥 편집기에서 돌아와도 Shift+Enter 가 줄바꿈이다(이월 #shift-enter-ctrl-g).
- 맥에서 오른쪽 ⌥ 는 @ · € 같은 글자, 왼쪽 ⌥ 는 예전처럼 Meta.
- Finder · 탐색기에서 복사한 파일을 ⌘V 하면 따옴표 처리된 경로가 붙는다(최대 64개, terminal_clipboard.rs).
- tmux · ssh 너머 vim 의 OSC 52 복사가 시스템 클립보드로 — 키를 누른 직후 64KB 이하만 받고, 쓸 때마다 알리고, 읽기 요청은 답하지 않는다.
- 계획 「셸에서 돌리기」 가 PowerShell 5.1 에서 `&&`·`||` 로 이은 확인 명령은 돌리지 않고 까닭과 PowerShell 7 안내를 보인다(이월 #ps51-and-and, terminal_check_cases.json 사례).

## 동작 흐름
한글 IME 브리지와 붙여넣기 정화(pasteSafe)는 그대로 지나간다. 「허락 묻는 중 보내기 막기」 는 이미 있었다. OSC 9;4 진행 숫자는 실측 근거로 걷기를 권한다.

## 검증
vitest 레인 시험 7파일 79 passed(osc52_clipboard · term_file_paste · paste_safe 39). PR #177 CI 통과(c538bf7e). Windows 클립보드 FFI 는 macOS 에서 컴파일하지 못했다 — portability(port/love-round) 와 설치본 확인 몫.