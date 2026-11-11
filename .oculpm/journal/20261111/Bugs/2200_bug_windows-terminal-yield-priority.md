---
schema_version: 1
type: bug
slug: "windows-terminal-yield-priority"
status: done
difficulty: low
created_at: "2026-11-11T22:00:00+09:00"
session_id: "manual-20261111-220000"
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
  - ref: "20261111/Bugs/2130_bug_windows-terminal-output-flood.md"
    kind: "context"
tags:
  - "터미널"
  - "windows"
  - "성능"
---
[x] 터미널: 안에서 도는 빌드가 화면을 밀지 않는다

## 발생 원인
Ocul 터미널 안의 Claude 가 병렬 세션 넷을 띄우자 rustc 30개가 CPU 를 100% 로 채웠고, 앱 터미널의 입력과 화면이 크게 밀렸다(한글이 두 번 찍히는 것도 이때 보였다). macOS 는 보고 있는 앱을 먼저 돌려 주지만 Windows 는 그 구분이 약해, 터미널 안의 빌드가 앱 · 웹뷰 · ConPTY 중계와 같은 등급으로 CPU 를 다퉜다.

## 해결 방법
세션을 띄운 직후 셸을 `BELOW_NORMAL_PRIORITY_CLASS` 로 내린다(`yield_to_ui`). CreateProcess 는 BelowNormal 부모의 등급을 자식에게 물려주므로 claude · 병렬 세션 · cargo 가 모두 따라 내려간다. 앱과 웹뷰, conhost 는 보통에 남는다. 한가할 때는 차이가 없고, 실패해도 세션은 그대로 연다. 셸 프로필이 첫 순간에 띄운 짧은 자식만 보통으로 남을 수 있다.

## 검증
- `cargo test --lib terminal` → test result: ok. 13 passed (새 시험 `windows_terminal_shell_yields_to_ui`: GetPriorityClass == BELOW_NORMAL)
- `cargo fmt --check` → exit 0
- 설치본에서 병렬 빌드 중 입력 · 화면이 부드러운지는 눈 확인으로 남음
