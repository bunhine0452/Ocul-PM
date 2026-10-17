---
schema_version: 1
type: bug
slug: "terminal-tiny-fit-and-webgl-release"
status: done
difficulty: high
created_at: "2026-10-18T01:14:23+09:00"
session_id: "20261018-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f2a896a3-7a54-47ca-9267-32f3b36af4fc"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/ptyResize.ts"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/webglRenderer.ts"
    op: update
  - path: "src/__tests__/terminal_pty_resize.test.ts"
    op: update
  - path: "src/__tests__/terminal_webgl_slot.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - ref: "20261001/Bugs/1825_bug_bare-dialog-gate.md"
    kind: "followup"
tags:
  - "terminal"
  - "xterm"
  - "resize"
  - "webgl"
  - "perf"
  - "mcp-tool"
---
[x] 터미널을 극소 크기로 줄였다 키우면 뭉개지던 것 + 숨은 터미널의 WebGL 컨텍스트 반납

병렬 레인 A (Opus 5.5 medium, worktree). 사용자 보고 "터미널이 작아졌다가 커졌을 때 텍스트가 뭉개진다".

## 발생 원인
- `applyFit` 은 폭이 정확히 0일 때만 건너뛰었다. `@xterm/addon-fit` 은 0이 아니면 최소 `MINIMUM_COLS=2`·`MINIMUM_ROWS=1` 을 내놓는다.
- 도크 최소 크기 120px(`TERMINAL_DOCK_MIN`)는 오른쪽 도크의 레일 폭(compact 168px)보다 좁다. 아래 도크는 머리줄·상태줄을 빼면 1~2행이다. 그래서 도크를 최소 근처로 끌면 터미널이 2열·1행으로 접혔다.
- 2열이 되면 스크롤백 20000줄이 2열로 다시 접혀 위쪽 기록이 잘렸다. PTY 도 2열을 받아 셸·Claude Code 가 진짜 개행을 넣어 다시 그렸다. 그래서 다시 넓혀도 리플로로 펴지지 않았다.
- 기존 코드는 `fit.fit()` 뒤에 이어받은 폭으로 `term.resize` 를 한 번 더 불러 리플로가 두 번 돌 수 있었다.
- 레인 D 측정: WebContent 그래픽(unmapped) 1.19~1.5GB. 원인은 `webglRenderer.ts` 가 한 번 붙인 애드온을 언마운트까지 놓지 않는 것이다. 비활성 탭(display:none)·확대 중 가려진 페인·다른 프로젝트 탭이 각자 컨텍스트와 아틀라스 텍스처 사본을 쥔다.
  - `footprint -v` 에서 4MB 51개, 16.5MB 13개 객체가 보인다. "컨텍스트 수 × 페이지 수" 모양과 맞지만, 정황 근거다.

## 해결 방법
- `ptyResize.ts` 에 `MIN_FIT_COLS=20`·`MIN_FIT_ROWS=4` 를 둔다.
  - `holdTinyAxes`: 바닥 아래로 떨어진 축은 지금 크기를 유지한다. 축마다 따로 본다.
  - `planFit`: 극소 축 유지와 폭 이어받기를 한 번에 판정한다. resize 호출은 한 번만 나간다.
- `WebglSlot`(`webglRenderer.ts`):
  - IntersectionObserver 로 15초 넘게 숨으면 애드온을 dispose 하고 `WEBGL_lose_context` 를 부른다. 마지막 소유자가 놓으면 공유 아틀라스도 버린다.
  - 다시 보이면 새로 붙인다. 컨텍스트를 잃었던 페인도 이때 되살아난다.
  - 불러오는 사이의 경합은 세대 카운터로 막는다.
- 유휴 커서 깜빡임 rAF 는 xterm 이 포커스 터미널에서만 돌려서 기각했다.

## 검증
- 테스트 17건 추가: `terminal_pty_resize` 8건(구현 전 실패 확인), `terminal_webgl_slot` 9건. 합류 브랜치에서 typecheck/test/lint/build 와 cargo fmt/clippy/test 가 exit 0.
- **실기기 미확인**(설치본 실행 중). 도크 최소 폭/높이 왕복, 숨긴 뒤 15초 지나 그래픽 메모리가 줄었는지, 다시 보인 탭의 글자 선명도를 봐야 한다.
- 한계: 20열 이상 정상 폭에서 TUI 가 남기는 잔해, 좁은 폭에서 새로 찍힌 줄, mixed-DPI 셀 크기 변화는 그대로다.