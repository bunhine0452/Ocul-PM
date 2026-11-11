---
schema_version: 1
type: bug
slug: "windows-terminal-output-flood"
status: done
difficulty: medium
created_at: "2026-11-11T21:30:00+09:00"
session_id: "manual-20261111-213000"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/terminal_output.rs"
    op: create
  - path: "src-tauri/src/terminal_tests.rs"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
related:
  - ref: "20261110/Bugs/1918_bug_windows-terminal-busy-children.md"
    kind: "context"
tags:
  - "터미널"
  - "windows"
  - "성능"
---
[x] 터미널: Windows 출력 · 도는 중 재기를 가볍게

## 발생 원인
- 출력: PTY 읽기 한 번(최대 8KB)이 곧 웹뷰 송신(`TermEvent::Output`) 한 번이었다. ConPTY 는 출력을 잘게 쪼개고 Claude Code 전체 화면 렌더러는 프레임을 통째로 다시 그려, 송신마다 WebView2 스크립트 실행이 하나씩 쌓였다.
- 도는 중: Windows 의 `busy()` 가 세션마다 `CreateToolhelp32Snapshot`(시스템 전체 프로세스 목록)을 떴고, `list` · `overview` · `busy_all`(세션마다 두 번)이 그것을 세션 표 잠금 안에서 돌렸다. 그동안 입력(`term_write`) · 크기 바꾸기 · 출력 스레드의 상태 반영이 모두 그 잠금을 기다렸다. `term_close` 는 프로젝트 하나를 찾으려고 개요 전체를 쟀다.
- pwsh 는 세션을 열 때마다 시작 배너를 찍었다.

## 해결 방법
- 읽기 스레드(`term-N-read`)와 보내기 스레드를 나눴다. 보내기 쪽(`terminal_output.rs` `pump_output`)이 `recv_timeout` 으로 5ms 잠잠 · 첫 글자 뒤 12ms · 64KB 가운데 먼저 오는 때에 한 번 보낸다. 상태 신호(OSC 7501)는 여전히 조각마다 화면보다 먼저 반영하고(DA1 순서), 상태 사건을 보내기 전에 앞서 모은 출력을 먼저 보내 순서가 예전과 같다. EOF 에는 남은 출력(반쪽 글자는 대체 문자)을 끝 사건보다 먼저 보낸다. 채널은 32조각으로 묶어 웹뷰가 밀리면 읽기도 멈춘다. `TermEvent` 모양은 그대로.
- 잠금 안에서는 세션을 줄(`Row`)로 베끼기만 하고, Windows 스냅숏은 잠금 밖에서 호출당 한 번(자식을 둔 pid 집합) 뜨고 500ms 동안 다시 쓴다. `term_close` 는 `project_of` 로 찾는다. unix 의 포그라운드 그룹 판정은 그대로.
- pwsh · powershell 에 `-NoLogo` (프로필은 그대로 읽는다). 800줄 한계 때문에 출력 길을 `terminal_output.rs` 로 떼었다.

## 검증
- `cargo test --lib terminal` → test result: ok. 12 passed — 실측 `조각 12000개(142890 bytes) → 송신 3번`(예전 12000번), `세션 3개 · 호출 4번 → 스냅숏 1번`(예전 15번)
- `cargo clippy --all-targets -- -D warnings` → exit 0 · `cargo fmt --check` → exit 0
- 설치본에서 claude 전체 화면 · 입력 지연은 아직 눈으로 확인하지 않았다
