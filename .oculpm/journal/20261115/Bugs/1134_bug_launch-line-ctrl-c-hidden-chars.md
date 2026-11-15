---
schema_version: 1
type: bug
slug: "launch-line-ctrl-c-hidden-chars"
status: done
difficulty: superhigh
created_at: "2026-11-15T11:34:06+09:00"
session_id: "20261115-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/program_status.rs"
    op: update
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/terminal_check_cases.json"
    op: create
  - path: "src-tauri/src/terminal_env.rs"
    op: update
  - path: "src-tauri/src/terminal_launch_tests.rs"
    op: create
  - path: "src-tauri/src/terminal_output.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src/__tests__/check_line_gate.test.tsx"
    op: create
  - path: "src/__tests__/plan_check_in_shell.test.tsx"
    op: update
  - path: "src/__tests__/terminal_ask_record_guard.test.tsx"
    op: create
  - path: "src/__tests__/terminal_receipt_chrome.test.tsx"
    op: create
  - path: "src/features/planner/PlanDoc.tsx"
    op: update
  - path: "src/features/terminal/SendToClaudeHost.tsx"
    op: update
  - path: "src/features/terminal/StatusBand.tsx"
    op: update
  - path: "src/features/terminal/TermToolbar.tsx"
    op: update
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/terminal/runCheck.ts"
    op: update
  - path: "src/features/terminal/sendToClaude.ts"
    op: update
  - path: "src/features/terminal/status.ts"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "CLAUDE.md"
    op: update
related:
  - ref: "20261115/Bugs/0826_bug_glue-cross-lane-gaps.md"
    kind: "followup"
tags:
  - "터미널"
  - "terminal"
  - "security"
  - "quality-round"
  - "mcp-tool"
---
[x] 터미널: Ctrl+C 와 숨은 글자에도 실행 줄을 지킨다

## 발생 원인

업그레이드 라운드의 최종 검수(영역 여섯 + 소견마다 반박 검증 2표)가 확인한 major 다섯이 실행 줄 조립(`terminal_env.rs`)과 확인 명령 문(`runCheck.ts`)에 몰려 있었다.

- 「다음」 · 잇기 · 확인 명령은 `$SHELL -l -i -c '<줄>\n\nexec "$SHELL" -l -i'` 꼴이었다. zsh(macOS 기본)는 앞의 작업이 SIGINT 로 죽으면 errflag 를 세워 나머지(exec)를 건너뛰어, 긴 확인 명령을 Ctrl+C 로 멈추면 세션이 「끝남 · 코드 130」 이 됐다. Ctrl+Z 로 멈춘 작업은 다음 줄의 exec 로 고아가 됐다.
- 확인 창에 보인 글과 셸이 도는 글이 다를 수 있었다: 양방향 서식 글자(RLO · 격리)는 두 문을 다 지나 창에서 순서가 바뀌어 그려졌고(Trojan Source), 끝의 `|` · `&&` · `||` 는 앱이 덧붙인 exec 줄을 삼켰고, 코드 조각이 둘 이상인 줄의 백틱은 명령 치환이 됐다.
- 「기록 남기게 하기」 가 claude 가 이미 끝난 셸 칸에도 프롬프트 + CR 을 보냈다. OSC 7501 msg= 만 양방향 · 폭 0 글자를 걷지 않았다.

## 해결 방법

- 모든 -c 스크립트 머리에 `trap 'exec "$SHELL" -l -i' INT QUIT`(문자열 트랩이라 하위 셸이 물려받지 않음), Ctrl+Z 로 멈춘 작업은 zsh 는 $jobstates 의 번호로, bash 는 재귀 함수로 되돌린다. `{…} always {…}` 는 탐침에서 멈춘 작업을 못 보고 Ctrl+Z 뒤 셸이 끝나 쓰지 않았다.
- 확인 명령 줄은 환경 변수 `OCULPM_CHECK` 로 넘기고 셸이 하위 셸에서 `( eval "$OCULPM_CHECK" )` 로 **따로** 읽는다 — 끝의 `|` · 닫히지 않은 따옴표 · `<<EOF` 는 그냥 구문 오류이고 셸은 남는다.
- 보이지 않는 글자(Unicode Cf · Default_Ignorable · 비ASCII 공백 · U+2800)가 있으면 Rust `is_one_line` · 웹뷰 `prepareCheck` 둘 다 **거절**한다(조용히 지우지 않는다 — 보인 글 = 돈 글). 두 쪽이 한 사례표 `terminal_check_cases.json` 을 문다. 계획 카드는 숨은 글자를 ‹U+202E› 로 드러낸다. 남은 백틱도 막힘 + 이유($(…) 를 쓰라고).
- 「기록 남기게 하기」 · 보내기 줄 · 대화상자는 같은 canReceive(살아 있고 · 바쁘고 · claude) 판정을 지나야 쓴다. msg= 도 같은 정화(`clean_msg`). unix 의 pwsh 로그인 셸은 -l.
- 화면: 터미널 고른 탭의 강조색 2px 아랫선을 윗줄 탭과 같은 회색 면으로(영수증 규칙 1), 격자 오른쪽 여백 0 으로 좌우 차 8px 안, 빈 화면 단추 30px, 키 표기 aria-hidden + aria-keyshortcuts.

## 검증

- 실제 PTY 시험(zsh · bash): Ctrl+C · Ctrl+\ · Ctrl+Z 두 번 · Ctrl+C 로 죽는 가짜 claude, 끝의 `|` · `||` · `<<EOF` · 닫히지 않은 따옴표 — 옛 스크립트를 되돌리면 넷 다 빨강. 합류 뒤 `cargo test --locked --no-fail-fast` 1227 passed 0 failed · clippy -D warnings · fmt exit 0.
- `pnpm test` 206 files · 1968 passed · typecheck · lint · build exit 0. 설치본 · 실제 Windows 에서 눌러 보지는 않았다.

## 메모

- 확인 명령은 셸 기록(history)에 남지 않는다(사람이 보는 자리는 확인 창의 전문). PowerShell 5.1 의 `&&` 는 tech-backlog #ps51-and-and 로.