---
schema_version: 1
type: feature
slug: "port-cli-console-dbus-newwindow-paths"
status: done
difficulty: high
created_at: "2026-09-28T23:30:48+09:00"
session_id: "20260928-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/main.rs"
    op: update
  - path: "src-tauri/src/instance_lock.rs"
    op: create
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/new_window.rs"
    op: create
  - path: "src-tauri/tests/win_cli_console.rs"
    op: create
  - path: "src/api/window.ts"
    op: update
  - path: "src/lib/kbd.ts"
    op: update
  - path: "src/features/deeplink/deepLinkPlan.ts"
    op: update
related: []
tags:
  - "cross-platform"
  - "windows"
  - "linux"
  - "shortcuts"
  - "mcp-tool"
---
[x] Windows CLI 콘솔 출력 · Linux D-Bus 없을 때 이중 실행 방지 · Ctrl+Shift+N 새 창 · Windows 경로 비교 (L-OS3, PR #54)

## 추가 기능

- **Windows CLI 출력(#os-cli-console)** — 릴리스 exe 는 GUI 서브시스템이라, cmd·PowerShell 에서 `ocul-pm config …` 을 쳐도 출력이 콘솔에 붙지 않았다.
  - CLI 분기 세 곳(config · 에이전트 CLI · 심) 직전에만 `AttachConsole(ATTACH_PARENT_PROCESS)` 를 부르고 빈 표준 핸들을 `CONOUT$` 로 맞춘다. 파이프·리다이렉트면 붙지 않고, stdin 은 원래 값 그대로다.
  - 한계: 셸이 GUI exe 를 기다리지 않는다(`start /wait` 로 우회).
- **Linux 이중 실행(#os-single-instance-dbus)** — tauri-plugin-single-instance 2.4.4 는 세션 D-Bus 연결 실패를 조용히 삼켜 앱이 두 번 뜰 수 있었다.
  - Linux 전용 `instance-lock` 플러그인을 single-instance 바로 뒤에 두었다. 버스를 탐지하고 없으면 경고하며, 앱 데이터 폴더의 `instance.lock` flock 을 잡는다. 잡혀 있으면 3초 재시도한 뒤 이유를 남기고 종료한다.
  - 한계: D-Bus 없이는 딥링크를 넘기지 못한다.
- **새 창(#os-new-window)** — 비-mac 은 앱 메뉴를 떼어 새 창 진입이 없었다. Ctrl+Shift+N → `new_window` 커맨드(macOS 메뉴와 같은 생성 함수)를 쓴다. Shift 를 안 보는 화면 ⌘N 핸들러에 먹히지 않도록 캡처 단계에서 받는다. 치트시트와 ⌘K(비-mac 만)에도 넣었다.
- **Windows 경로(#ui-winpath-followups)** — 딥링크 등록 프로젝트 비교가 구분자·대소문자·`\\?\` 접두를 접는다. 같은 파일의 `openNavFor` 도 같은 결함이라 함께 고쳤다(VS Code 확장이 보내는 역슬래시 일지 경로). 홈 `~` 줄임은 `C:\Users\x` 를 안다.

## 동작 흐름

- Windows 콘솔 테스트: 자식은 DETACHED + 표준 핸들 NULL, 테스트는 전용 콘솔을 만들고 `ReadConsoleOutputCharacterW` 로 출력을 확인한다. 대조군 `cmd /c echo` 가 안 찍히는 것으로 조건이 성립함을 증명한다.
- 첫 CI 에서 `instance_lock` 테스트의 pid 읽기가 windows 에서만 붉었다. Windows `try_lock` 은 LockFileEx 강제 잠금이라 다른 핸들이 못 읽는다 — 오케스트레이터가 단언을 유닉스로 좁혔다(플러그인은 Linux 전용).

## 검증

- PR #54: ci.yml 3잡 · portability(windows·ubuntu Rust/프런트) · E2E 양 OS pass. rebase 병합(1d7d47d2).
- CI 가 못 본 것(w5-eyes): 사람의 콘솔에서 본 모습, D-Bus 없는 실제 데스크톱, 실제 창의 Ctrl+Shift+N.
- 발견 두 건은 항목으로 남겼다(`#os-dbus-addr-panic` · `#ui-shortcut-shift-exact`).