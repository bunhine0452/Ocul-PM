---
schema_version: 1
type: bug
slug: "terminal-pwsh-on-windows"
status: done
difficulty: low
created_at: "2026-11-10T19:17:43+09:00"
session_id: "manual-20261110-191743"
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
related: []
tags:
  - "터미널"
  - "windows"
  - "powershell"
---
[x] 터미널: Windows 에서 PowerShell 7 을 띄운다

## 발생 원인
- 사용자 지적: 앱 터미널을 열면 설정해 둔 PowerShell 이 아니라 기본 PowerShell 이 뜬다.
- `shell_command()` 가 Windows 에서 늘 `powershell.exe` 였다. 이것은 OS 에 들어 있는 Windows PowerShell 5.1 이다.
- 사용자는 PowerShell 7.6(`pwsh.exe`, Store 판)을 쓰고, 프로필(fnm · starship · zoxide · PSReadLine)은 `Documents\PowerShell\` 에만 있다. 5.1 은 `Documents\WindowsPowerShell\` 을 읽는데 거기는 비어 있다.
- 이 PC 의 5.1 은 실행 정책도 스크립트를 막아, 프로필이 있어도 못 읽었다(5.1 로 .ps1 을 돌리면 UnauthorizedAccess).
- Windows Terminal 의 기본 프로필도 pwsh 다(GUID 574e775e…, 자동 생성 그대로).

## 해결 방법
- `find_pwsh(PATH)`: PATH 를 셸과 같은 순서로 보며 처음 잡히는 `pwsh.exe`. 상대 PATH 항목은 건너뛴다(`proc.rs` 와 같은 규칙).
- 있으면 그 전체 경로로 띄우고 탭 이름은 `pwsh`. 없으면 예전 그대로 `powershell.exe`.
- Store 판 pwsh 는 `WindowsApps` 의 앱 실행 별칭이다. Rust 1.99 의 `exists()` · `is_file()` 이 그것도 파일로 보는지 따로 컴파일해 확인했다(둘 다 true).

## 검증
- `cargo test --lib terminal::` → 7 passed (pwsh_is_found_on_path_in_order_and_only_in_absolute_dirs 포함)
- 실기기 개발판(Windows 11): 터미널 탭이 `PowerShell 7.6.9 · 개인 및 시스템 프로필을 로드하는 데 1791ms` 와 starship 프롬프트로 떴다.
