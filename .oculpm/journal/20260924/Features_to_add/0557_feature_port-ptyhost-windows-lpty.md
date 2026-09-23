---
schema_version: 1
type: feature
slug: "port-ptyhost-windows-lpty"
status: done
difficulty: superhigh
created_at: "2026-09-24T05:57:09+09:00"
session_id: "20260924-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/pipe.rs"
    op: create
  - path: "src-tauri/src/ptyhost/host/windows.rs"
    op: create
  - path: "src-tauri/src/ptyhost/host/windows/tests.rs"
    op: create
  - path: "src-tauri/src/ptyhost/host/unix.rs"
    op: create
  - path: "src-tauri/src/ptyhost/host/unsupported.rs"
    op: delete
  - path: "src-tauri/src/ptyhost/host/mod.rs"
    op: update
  - path: "src-tauri/src/ptyhost/client.rs"
    op: update
  - path: "src-tauri/src/ptyhost/mod.rs"
    op: update
  - path: "src-tauri/tests/ptyhost_roundtrip.rs"
    op: create
  - path: "src-tauri/tests/ptyhost_reattach.rs"
    op: update
  - path: "src-tauri/tests/ptyhost_write_backpressure.rs"
    op: update
related:
  - ref: "20260924/Features_to_add/0427_feature_port-shell-integration-lshell.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "terminal"
  - "ptyhost"
  - "mcp-tool"
---
[x] PTY 호스트 Windows — 네임드 파이프·ConPTY·Job Object, ^C 무시 상속 결함 (L-PTY, PR #37)

## 추가 기능

크로스플랫폼 W2 · L-PTY 합류 — **W2 레인 6개 전부 합류, `src-tauri` 전체 `PORT-STUB` 0건.** 업데이트·재시작 뒤에도 셸을 살리는 PTY 호스트 설계(메모리: 자리 고정 + 옛 자리 이어받기 + 협상, 이름에 프로토콜을 담지 않기)를 Windows 로 옮겼다.

- **전송**: 네임드 파이프 `\\.\pipe\ocul-pm-<stem>[-admin]-<blake3(사용자 SID + 경로)>`. 자리 규칙은 `client` 가 두 OS 공통으로 소유하고 `pipe.rs` 는 경로→이름 한 겹. DACL 현재 사용자 SID 만, 승격 호스트는 High IL 레이블, `first_pipe_instance`, 접속 뒤 서버 SID 확인, 비켜 주는 옛 호스트는 이름이 빌 때까지 대기.
- **종료**: 셸마다 Job Object — 의사 콘솔 닫기(SIGHUP 자리) → 1.5s → `TerminateJobObject`(SIGKILL 자리).
- **생존**: 셸 종료 감시(ConPTY 는 판에 따라 파이프를 안 닫는다), 포그라운드 Toolhelp32 + `NtQueryInformationProcess`.
- Unix 소켓 `serve` 는 `host/unix.rs` 로 옮기기만(동작 동일), `host/mod.rs` 810→800.

## 발생 원인 → 해결 (구현 중 발견)

**`CREATE_NEW_PROCESS_GROUP` 로 뜬 프로세스는 "Ctrl+C 무시" 가 켜진 채 태어나 자식에게 물려준다** — 지시대로 분리 기동하면 호스트가 띄우는 모든 셸에서 ^C 가 아무것도 멈추지 못했다(CI 러너의 테스트 프로세스도 같은 상태). 셸 기동 직전 `SetConsoleCtrlHandler(NULL, FALSE)` 로 복원하고 `idle_shell…` 테스트가 ^C 로 ping 을 실제로 멈추는지 지킨다. 첫 Windows run 의 60분 매달림은 실패한 테스트의 `spawn_blocking` 읽기가 런타임 종료를 막은 것 — Drop 가드·DSR/DA 응답(xterm.js 대신)·워치독으로 "매달림 → 원인과 함께 실패".

## 오케스트레이터 검토 (macOS 불변)

`spawn_host_from` 의 unix 경로(`process_group(0)`·stdio null)는 한 줄도 다르지 않다. Unix `serve` 는 bind 경합·0600·받기 루프 동일, 공통 절차만 `occupy` 로.

## 검증

- portability 35911066139: 잡 6개 success, windows **1,956 통과 · 0 실패**(reattach 5 · roundtrip 1 · backpressure 5 · host::windows 9 · pipe 6 — 실제 앱 바이너리 `--pty-host` 분리 기동, pwsh 한글 왕복, 리사이즈 123열, 재접속 스크롤백 크기 마커, Kill 뒤 자식 0).
- PR #37 ci.yml 3잡 SUCCESS → rebase 머지 9b67bf9b.
- 결정·후속(플랜): **Windows 업데이트 때 터미널 세션이 끊길 공산**(NSIS 가 같은 exe 이름을 끝낸다 — #w3-update-ptyhost-lock), 핸들 상속(#pty-handle-inherit), Job 이 셸에서 띄운 GUI 자식도 끝냄(#pty-job-gui-children), PowerShell 네이티브 출력 UTF-8(#shell-pwsh-utf8).
- CI 로 못 본 것: 실제 앱 종료·업데이트 뒤 호스트 생존, 한국어 Windows(CP949) 입력기, 비승격 사용자의 실제 serve, 구형 Windows 10 conhost.