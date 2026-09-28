---
schema_version: 1
type: bug
slug: "port-win-terminal-utf8-inherit-gui"
status: done
difficulty: high
created_at: "2026-09-28T22:22:45+09:00"
session_id: "20260928-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/shell_integration/templates/oculpm.ps1"
    op: update
  - path: "src-tauri/src/oculpm/shell_integration/live_tests.rs"
    op: update
  - path: "src-tauri/src/proc.rs"
    op: update
  - path: "src-tauri/src/proc/detached.rs"
    op: create
  - path: "src-tauri/src/ptyhost/client.rs"
    op: update
  - path: "src-tauri/src/ptyhost/mod.rs"
    op: update
  - path: "src-tauri/src/ptyhost/survivors.rs"
    op: create
  - path: "src-tauri/src/ptyhost/host/windows.rs"
    op: update
  - path: "src-tauri/src/ptyhost/host/windows/job.rs"
    op: create
  - path: "src-tauri/src/ptyhost/host/windows/tests.rs"
    op: update
related:
  - ref: "20260908/Bugs/1740_bug_retire-empty-stale-pty-host.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "windows"
  - "terminal"
  - "ptyhost"
  - "mcp-tool"
---
[x] Windows 터미널 — PowerShell UTF-8 · 호스트 핸들 상속 · 세션 종료 때 GUI 자손 보존 (L-PTY3, PR #52)

## 발생 원인

- **PowerShell 한글** — "ConPTY 는 이미 UTF-8" 이라는 전제가 틀렸다. ConPTY 파이프는 UTF-8 이지만, 셸이 도는 콘솔의 코드 페이지는 OEM 값으로 시작한다. 러너 실측은 pwsh 7 `437/437/65001`, 5.1 `437/437/20127`(파이프가 ASCII)이었다. cmd 는 `chcp 65001` 로 이미 고쳐져 있었고 PowerShell 만 비어 있었다.
- **핸들 상속** — std `Command::spawn` 은 `bInheritHandles=TRUE` 라서, 분리 기동한 호스트가 부모의 상속 가능 파이프를 물었다. 증상은 dev·CI 에서 부모의 출력 파이프가 EOF 를 못 받는 것.
- **GUI 자손** — 세션 종료가 Job Object 로 트리 전체를 끝내, 셸에서 띄운 `code .` 의 VS Code 까지 죽였다. macOS 는 살아남는다.

## 해결 방법

- `oculpm.ps1` 의 `OCULPM_TERM` 가드 안(Windows 만)에서 Console Input/OutputEncoding 과 `$OutputEncoding` 을 BOM 없는 UTF-8 로 맞췄다.
- `proc/detached.rs` 의 `proc::spawn_detached` 가 `CreateProcessW` 를 직접 부른다(`bInheritHandles=FALSE`, 표준 핸들 NULL, 플래그는 예전과 같다). PTY 호스트 기동의 Windows 경로가 이것을 쓰고, 유닉스 경로는 불변이다.
- `ptyhost/survivors.rs` — PE 서브시스템과 Job 안의 조상 사슬로 판정한다. GUI 이거나 GUI 아래에 있는 자손은 살리고, 셸까지 전부 콘솔인 사슬은 끝낸다. 모르는 것도 끝낸다.
  - `host/windows/job.rs` 가 목록을 읽어 콘솔만 `TerminateProcess` 하고, 남은 것이 GUI 뿐임을 확인한 뒤 KILL_ON_JOB_CLOSE 를 풀고 닫는다. 확인에 실패하면 예전처럼 Job 째 끝낸다.
  - 대가: 호스트가 비정상으로 죽으면 GUI 도 끝난다(예전과 같다).

## 검증

- CI 전 잡 초록.
  - windows cargo test 1799/0. `ptyhost_roundtrip`·`update_survival`·`reattach` 가 새 기동 경로로 통과했다.
  - 새 테스트: pwsh 5.1·7 UTF-8 왕복, 상속 파이프 EOF(대조군 포함), GUI 가 살고 콘솔 자손은 0.
  - E2E 터미널 한글·IME·빠른 연타도 통과.
- PR #52 rebase 병합(3930f64a).
- CI 가 못 본 것: 실제 `code .` VS Code, 한국어 Windows(949) 체감, 호스트 비정상 종료.