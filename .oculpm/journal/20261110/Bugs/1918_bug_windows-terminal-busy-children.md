---
schema_version: 1
type: bug
slug: "windows-terminal-busy-children"
status: done
difficulty: medium
created_at: "2026-11-10T19:18:30+09:00"
session_id: "manual-20261110-191830"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/terminal_tests.rs"
    op: update
related:
  - ref: "20261110/Bugs/1917_bug_terminal-pwsh-on-windows.md"
    kind: "context"
tags:
  - "터미널"
  - "windows"
---
[x] 터미널: Windows 에서도 도는 프로그램을 묻고 닫는다

## 발생 원인
- `Session::busy()` 는 macOS · Linux 에서 PTY 의 포그라운드 프로세스 그룹으로 「셸 위에서 무언가 도는가」를 본다.
- Windows 에는 프로세스 그룹이 없어 상태 신호를 보낸 claude 만 세었다.
- 그래서 `npm run dev` · 빌드 · 테스트가 도는 세션도 세션 닫기 · 창 닫기 · 앱 끄기에서 묻지 않고 함께 끝났다. macOS 는 묻는다.
- busy 를 쓰는 곳: 세션 하나 닫기(TerminalScreen), 창 닫기(`CloseRequested` → `busy_in`), 앱 끄기 · 업데이트 재시작(`busy_all`).

## 해결 방법
- Windows 는 셸 pid 를 부모로 둔 프로세스가 있으면 「도는 중」 이다. `CreateToolhelp32Snapshot` 한 번으로 본다(windows-sys 의 `Win32_System_Diagnostics_ToolHelp` 는 이미 켜져 있었다).
- 콘솔 호스트(`conhost.exe` · `OpenConsole.exe`)는 세지 않는다. 자기 콘솔을 만든 콘솔 프로그램은 그것을 자식으로 둔다. 하나라도 끼면 빈 셸이 늘 「도는 중」 이 된다.
- 스냅숏을 못 뜨면 예전처럼 상태 신호로 물러선다.

## 검증
- `cargo test --lib terminal::` → 7 passed. 새 Windows 전용 둘: 자식 탐침(ping 은 자식 없음 · 띄운 쪽은 있음), 실제 ConPTY 의 cmd 셋에서 빈 셸 0 → ping 띄운 둘 = `TermBusy { busy: 2, claude: 1 }`.
- `cargo clippy --lib --tests -- -D warnings` → Finished, 경고 0
- 실기기 개발판: starship 을 쓰는 빈 pwsh 세션이 있는 창을 ✕ 로 닫으니 묻지 않고 닫혔다(빈 셸이 「도는 중」 으로 새지 않는다).

## 메모
- 못 본 것: 실기기에서 도는 프로그램이 있는 창을 닫을 때 확인 창이 뜨는지. 판정 경로는 위 ConPTY 테스트가 보지만 앱 화면에서는 안 봤다.
- starship · zoxide 처럼 프롬프트마다 잠깐 도는 자식이 있으면 그 순간에 닫을 때 한 번 더 물을 수 있다.
