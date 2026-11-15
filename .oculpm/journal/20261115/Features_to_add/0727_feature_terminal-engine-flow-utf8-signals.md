---
schema_version: 1
type: feature
slug: "terminal-engine-flow-utf8-signals"
status: done
difficulty: superhigh
created_at: "2026-11-15T07:27:27+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/commands/window/attention.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/program_status.rs"
    op: update
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/terminal_env.rs"
    op: create
  - path: "src-tauri/src/terminal_io.rs"
    op: create
  - path: "src-tauri/src/terminal_output.rs"
    op: update
  - path: "src-tauri/src/terminal_tests.rs"
    op: update
  - path: "src-tauri/src/terminal_types.rs"
    op: create
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src/__tests__/terminal_attention.test.ts"
    op: update
  - path: "src/__tests__/terminal_flow_control.test.ts"
    op: create
  - path: "src/__tests__/terminal_render_defaults.test.ts"
    op: create
  - path: "src/__tests__/terminal_resize_webgl.test.ts"
    op: update
  - path: "src/__tests__/terminal_signals.test.ts"
    op: create
  - path: "src/__tests__/terminal_webgl_recover.test.ts"
    op: create
  - path: "src/api/terminal.ts"
    op: update
  - path: "src/features/terminal/attention.ts"
    op: update
  - path: "src/features/terminal/fileLinks.ts"
    op: update
  - path: "src/features/terminal/termSize.ts"
    op: create
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/termTheme.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/styles/tokens.css"
    op: update
related: []
tags:
  - "터미널"
  - "terminal"
  - "quality-round"
  - "mcp-tool"
---
[x] 터미널: 흐름 제어 · UTF-8 · 대화 제목 알림을 넣었다

## 추가 기능

업그레이드 라운드 레인 「터미널 엔진」(계획 quality-round-20261115). Ghostty · WezTerm 에서 Claude Code 를 돌릴 때의 느낌이 기준이다.

- **UTF-8 환경(TE-01)**: Finder 로 띄운 설치본은 LANG 이 없어 zsh 가 한글을 바이트로 다뤘다(백스페이스가 자모를 쪼갬). 7월에 고친 근본 원인이 4.0 재도입 때 빠졌다. 비었을 때만 UTF-8 LANG 을 주고, 부모 터미널의 신원(TERM_PROGRAM=iTerm.app · VSCODE_* · TMUX · CLAUDECODE 등)을 지워 안의 claude 가 다른 터미널 · 중첩 세션으로 착각하지 않게. TERM_PROGRAM=Ocul.
- **Codex 칸을 claude 로 잇지 않기(TE-02)**: OSC 7501 의 app 을 읽어 업데이트 뒤 Codex 칸에 `claude --continue` 를 치지 않는다.
- **격자 · 대비(TE-03)**: addon-fit 0.11(xterm 6 짝)이 5.5 에서 늘 14px 를 빼 격자가 쏠렸다 → 0.10.0 고정 + 자투리 반을 왼쪽에. 커서 깜빡임 끔(영수증 ⑥), 넘치는 아이콘 축소, 대비 바닥(밝은 바탕 4.5 · 어두운 바탕 3). 마우스를 쓰는 전체 화면(Claude) 위 링크는 ⌘클릭.
- **입출력을 잠금 밖으로(TE-04)**: 세션마다 쓰기 스레드 — 빌드 중인 칸에 긴 붙여넣기를 해도 다른 창의 키 입력이 서지 않는다. 닫힌 세션의 자식을 거둔다(좀비 없음).
- **출력 흐름 제어(TE-05)**: 웹뷰가 소화한 만큼만 읽는다(ack, HIGH 256KB · LOW 32KB, 2초 자가 해제). `yes` · 큰 cat 에서 메모리가 붓지 않는다.
- **신호 한 모델(TE-06)**: OSC 0/2 제목(대화 주제)을 세션 이름으로, BEL · OSC 9/777 을 끝남 · 알림으로. 알림은 창이 뒤일 때 예외만(기다림 · 오류 · 일지 없이 끝남), 알림 뒤 창이 앞에 오면 그 세션으로.
- **WebGL 자가 회복 · 첫 크기(TE-07)**, **rc 질문이 먹지 않는 실행(TE-08)**: 「다음」 실행 줄을 셸에 치지 않고 `-l -i -c`(PowerShell 은 `-NoExit -Command`) 인자로 넘긴다. 인자를 못 받는 nushell · csh 만 예전처럼 친다.

## 동작 흐름

PTY 읽기 → 바이트 상태 기계 스캐너(OSC 7501 · 0/2 · 9 · 777 · BEL) → Output{n} 을 웹뷰로 → xterm.write 콜백이 32K 마다 term_ack → 백엔드 Flow 가 HIGH 를 넘으면 읽기를 멈춘다. 입력은 세션 쓰기 스레드의 줄로, 1MB 넘게 밀리면 큰 쓰기만 거절(키 입력은 받는다).

## 검증

- 레인 게이트: `cargo test --locked --no-fail-fast` 1191 passed 0 failed · clippy -D warnings · fmt · vitest 1143 passed · lint · build exit 0. 리뷰 둘(major 9) 반영.
- 합류 뒤: `cargo test` 1202 passed 0 failed · `pnpm test` 1652 passed. 실제 PTY 시험이 LANG · TERM_PROGRAM 과 rc 질문 셸을 문다. 설치본에서 눈으로 보지는 않았다.

## 메모

- 기다림 수는 더하지 않고 max(훅 셈, 앱 안 셈) — 훅이 앱 안 claude 의 기다림도 적어서 더하면 두 번 센다.
- 시간을 재는 Rust 시험(10ms 상한)은 기계가 아주 바쁘면 흔들릴 수 있어 셋 중 가장 빠른 값 · 500ms 상한으로 줄였다.
- CLAUDE.md 의 「앱이 터미널에 치는 줄」 문구는 합류 때 고친다(이제 셸 인자로 넘김).