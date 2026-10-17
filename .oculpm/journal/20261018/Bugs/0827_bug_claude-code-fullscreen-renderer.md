---
schema_version: 1
type: bug
slug: "claude-code-fullscreen-renderer"
status: done
difficulty: high
created_at: "2026-10-18T08:27:18+09:00"
session_id: "20261018-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f2a896a3-7a54-47ca-9267-32f3b36af4fc"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
related:
  - ref: "20261018/Bugs/0319_bug_terminal-drag-pty-resize-once.md"
    kind: "followup"
tags:
  - "terminal"
  - "xterm"
  - "resize"
  - "mcp-tool"
---
[x] 내장 터미널의 Claude Code 를 fullscreen 렌더러로 — 작업일지 옆 좁은 터미널에서 받은 답이 좁게 남던 것

사용자 보고(스크린샷): 터미널 화면에서 전체 폭으로 일하다 작업일지로 가면, 같은 세션이 옆 좁은 터미널(도크)에 뜬다. 다시 터미널 화면으로 돌아와 위로 올리면 과거 글이 그 좁은 폭으로 보인다. 스크린샷에서는 같은 보고가 위쪽은 좁게, 아래쪽은 넓게 두 번 찍혀 있었다. 사용자 요구는 "옆에서 잘리지 않게 폭은 유동적으로, 이 현상은 아예 안 보이게". 그리고 "orca 는 이걸 완전히 해결했다".

## 발생 원인
- pty 실측 1: 일반 렌더러는 폭이 바뀌면 **보이는 화면만** 다시 찍는다. ALPHASTART + 숫자 70줄 + ALPHAEND 를 출력시킨 뒤 폭을 바꾸면 ALPHASTART 는 0회, ALPHAEND 만 다시 찍혔다. 그래서 "폭이 바뀌면 옛 사본을 지운다" 방식은 기록을 지워 버린다(기각).
- 스크린샷의 좁은 위쪽은 사용자가 작업일지를 보던 **동안 새로 나온 출력**이었다. 일반 렌더러는 새 글을 그때의 PTY 폭으로 직접 줄바꿈하므로, 어떤 터미널도 나중에 넓혀 펴지 못한다.
- Orca(stablyai/orca) 코드 조사: 테스트·daemon 주석이 Claude Code 가 alternate screen(`ESC[?1049h`)으로 도는 것을 전제한다("in alt-screen (Claude/Codex TUIs) ... scrollbackAnsi is empty").

## 해결 방법
- `commands/terminal.rs`: 고정 env 를 `base_terminal_env()` 로 빼고 `CLAUDE_CODE_NO_FLICKER=1` 을 더했다. Claude Code 공식 fullscreen 렌더러다. rc 의 `=0` 이 나중에 돌아 이긴다.
- pty 실측 2 (fullscreen):
  - alt screen 진입 1회, 폭이 바뀌면 `ESC[2J` 로 지우고 다시 그린다.
  - 50칸일 때 받은 문단이 140칸 창으로 넓히자 136칸으로 다시 그려졌다.
  - PgUp 으로 올린 지난 출력도 보였다.
- 마우스를 Claude Code 가 가져가므로 xterm `macOptionClickForcesSelection: true` 를 켰다. ⌥+드래그로 터미널 선택이 된다(iTerm2 와 같은 관례).
- 대가(공식 문서): 대화 검색은 우리 터미널 ⌘F 가 아니라 Ctrl+O 안에서 해야 한다. xterm.js 는 휠 한 칸에 이벤트 하나라 스크롤이 느릴 수 있다(`CLAUDE_CODE_SCROLL_SPEED` 로 조정).

## 검증
- 단위 테스트 `claude_code_starts_in_fullscreen_renderer`. cargo fmt/clippy/test 2063 passed, typecheck/test(3355)/lint/build exit 0.
- **실기기 미확인**:
  - 새로 연 터미널에서 Claude Code 를 띄워 작업일지 옆으로 갔다가 돌아오기
  - 선택하면 복사가 되는지 — 우리 터미널은 OSC 52 미처리
  - ⌥+드래그 선택
  - 휠 스크롤 속도
  - 한글 IME
- 이미 떠 있는 셸은 env 가 없다. 새 탭을 열거나 `/tui fullscreen` 을 쳐야 한다.