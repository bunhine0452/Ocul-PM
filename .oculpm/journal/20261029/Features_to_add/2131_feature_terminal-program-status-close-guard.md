---
schema_version: 1
type: feature
slug: "terminal-program-status-close-guard"
status: done
difficulty: medium
created_at: "2026-10-29T21:31:00+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/program_status.rs"
    op: create
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/commands/window/lifecycle.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/terminal.ts"
    op: update
  - path: "src/features/terminal/status.ts"
    op: create
  - path: "src/features/terminal/TermsChip.tsx"
    op: create
  - path: "src/features/terminal/useTermCloseGuard.tsx"
    op: create
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/features/start/StartWindow.tsx"
    op: update
  - path: "src/windows/ProjectWindow.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_screen.test.tsx"
    op: update
  - path: "src/__tests__/terminal_close_guard.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "THIRD_PARTY_NOTICES.md"
    op: create
related:
  - ref: "20261029/Refactors/2108_refactor_sweep-legacy-before-features.md"
    kind: "followup"
tags:
  - "terminal"
  - "ocul-next"
  - "ui-audit"
  - "mcp-tool"
---
[x] 앱 안 터미널이 Claude 상태(OSC 7501)를 알고, 실행 중인 세션이 있으면 닫기 · 끄기 전에 묻는다

## 추가 기능

- **상태 신호 (OSC 7501, Program Status Protocol)** — `src-tauri/src/program_status.rs`. Orca(stablyai/orca, MIT)의 `protocol.ts` · `osc-scanner.ts` 를 Rust 로 옮겼다. 상한(본문 4096 · msg 2048 · id 깊이 8)·base64 한 줄·제어 문자 거부는 원본 그대로 두었다. OSC 133 · RIS 는 보지 않는다(이 앱 셸에는 셸 통합이 없다). 허락문은 `THIRD_PARTY_NOTICES.md` 에 있다.
- **탐침 응답** — PTY 읽기 루프에서 바이트를 화면으로 넘기기 **전에** 훑는다. `ESC]7501;?` 가 오면 그 PTY 에 `states=…:kinds=…` 로 답한다. 이 답이 xterm 의 DA1 응답보다 먼저 가야 Claude 가 이 터미널이 신호를 받는다고 본다.
- **세션 상태** — `TermInfo.status` 는 루트 기록만 담는다(state · kind · msg · since). 값이 바뀔 때만 `TermEvent::Status` 를 보내고, 끝난 세션에도 마지막 값이 남는다.
- **모든 창 세기** — `term_overview` · `TermSessionsChanged`(열림 · 끝남 · 상태 바뀜일 때만, 출력에는 안 쏜다). 프로젝트 전환 목록과 시작 창의 각 줄에 「실행 중 N」 또는 「내 차례」가 붙는다(중립 딱지).
- **터미널 목록** — 「실행 중」 자리에 상태 말이 온다(작업 중 · 입력을 기다려요 · 허락/답/로그인을 기다려요 · 끝냈어요 · 오류). 기다릴 때만 프로그램이 붙인 한 줄과 노란 점이 보인다.
- **「무언가 도는」 세션만 센다** — `TermInfo.busy` 는 터미널의 포그라운드 프로세스 그룹이 셸이 아닐 때 참이다(`tcgetpgrp` ≠ 셸 pid, macOS 터미널이 닫기 전에 묻는 기준). 빈 셸까지 세면, 터미널 탭은 세션이 없을 때 셸을 하나 띄우므로 그 탭을 한 번 연 창은 닫을 때마다 물었다. 그룹을 물을 수 없는 Windows 는 상태 신호를 보낸 프로그램이 있을 때만 센다. 빈 셸에서 명령이 시작 · 끝나는 것은 사건이 없어서, 프로젝트 전환 목록은 펼칠 때 다시 읽는다.
- **닫기 · 끄기 확인** — `CloseRequested` 때 그 창에 무언가 도는 세션이 있으면 닫기를 멈추고 `TermCloseAsked` 를 보낸다. 「닫기」를 고르면 `term_end_window` 뒤에 창을 다시 닫는다. ⌘Q(`ExitRequested`, code 없음)도 같은 방식으로 묻고, 모든 창의 세션을 프로젝트 이름과 함께 보여 준다. 「끄기」를 고르면 프로세스 플러그인 `exit(0)` 으로 끈다. 묻는 창이 응답하지 못해도 끌 수 있게, 10초 안에 ⌘Q 를 한 번 더 누르면 묻지 않고 끈다.

## 동작 흐름

PTY 읽기 → `Scanner::feed` → (탐침이면 PTY 에 답 / 루트 보고면 세션 표 갱신 → Channel 로 `status` + 전역 `TermSessionsChanged`) → UTF-8 조립 → 화면 출력.

## 남은 것

- 하위 기록(`id=…`, 하위 에이전트)은 읽기만 하고 버린다.
- ⌘Q 의 `prevent_exit` 가 macOS 의 기본 「종료」 메뉴에서 실제로 먹히는지는 설치본에서 눈으로 봐야 한다(ocul-next #eyes-installed). 먹히지 않으면 지금처럼 묻지 않고 끝난다.

## 검증

- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 파일 72개 · 테스트 895개 통과, lint exit 0, build ✓.
- `cargo fmt --check && cargo clippy --all-targets -D warnings && cargo test --locked` → exit 0, 1146 passed · 0 failed. 진짜 PTY 로 탐침 답 → 상태 사건 → 중복 억제를 확인했다. 대화형 `sh -i` 로 빈 셸은 안 묻고, `sleep 5` 가 앞에 서면 묻고, ⌘Q 두 번이면 그대로 끄는 것도 확인했다(5회 반복 통과).