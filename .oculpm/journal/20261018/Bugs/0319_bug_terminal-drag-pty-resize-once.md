---
schema_version: 1
type: bug
slug: "terminal-drag-pty-resize-once"
status: done
difficulty: medium
created_at: "2026-10-18T03:19:12+09:00"
session_id: "20261018-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f2a896a3-7a54-47ca-9267-32f3b36af4fc"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/resizeGesture.ts"
    op: create
  - path: "src/features/terminal/ptyResize.ts"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalDock.tsx"
    op: update
  - path: "src/features/terminal/terminalSurface/useSplitDrag.ts"
    op: update
  - path: "src/__tests__/terminal_resize_gesture.test.tsx"
    op: create
related:
  - ref: "20261018/Bugs/0114_bug_terminal-tiny-fit-and-webgl-release.md"
    kind: "followup"
tags:
  - "terminal"
  - "xterm"
  - "resize"
  - "mcp-tool"
---
[x] 손잡이를 끄는 동안 PTY 크기를 보내지 않는다 — 좁힌 폭으로 다시 찍힌 대화가 남던 것

사용자 정정에서 출발: "좁혔다 넓히면 잘 커지는데 이전 대화 내용이 좁은 상태로 남는다". 레인 A 의 극소 fit 바닥(20×4)은 이 증상을 고친 게 아니었다.

## 발생 원인
- pty 실측: python `pty.fork()` 로 `claude` 를 띄우고 120→50→120 열로 `TIOCSWINSZ` + SIGWINCH 를 보냈다. Claude Code 는 SIGWINCH 마다 **보이는 화면만** `ESC[H` 뒤 행마다 `ESC[2K` 로 지우고 새 폭으로 다시 찍는다. 스크롤백은 다시 찍지 않는다.
- 좁은 폭으로 다시 찍힌 줄은 진짜 개행이다. 스크롤백으로 밀려난 뒤엔 넓혀도 안 펴진다.
- 우리 쪽 원인: 도크·분할 손잡이를 끄는 동안 패널 크기가 실시간으로 바뀐다. 손이 `RESIZE_SETTLE_MS`(60ms)만 멎어도 중간 폭이 PTY 로 새어 나갔다. 그래서 한 번 끌 때마다 Claude Code 가 중간 폭으로 대화를 몇 번씩 다시 찍었다.

## 해결 방법
- `resizeGesture.ts`: 손잡이 제스처 문. 겹치는 제스처는 카운트로 세고, 끝 함수는 멱등이다. 마지막 제스처가 끝나면 구독자를 부른다.
- `createPtyResizeQueue(send, refit)`: 문이 열려 있으면 `pump` 를 멈추고 쥐고만 있는다. 문이 닫히면 `refit`(=`applyFit`)으로 지금 크기를 밀어 넣고 한 번 보낸다.
  - xterm 은 끄는 동안에도 계속 맞춘다. soft wrap 리플로는 넓히면 되돌아온다.
  - `TerminalInstanceImpl.tsx` 는 큐 생성 인자 한 줄만 바꿨다. 800줄 래칫 950 안이다.
- `TerminalDock` 의 grip 과 `useSplitDrag` 가 pointerdown 에서 문을 열고, pointerup·pointercancel 에서 닫는다.
- 한계: 좁힌 채로 **쓰는 동안** 찍힌 줄은 여전히 못 편다. TUI 의 몫이고 iTerm2 도 같다. 창 크기 조절은 제스처가 아니라서 기존 settle 경로 그대로다.

## 검증
- `terminal_resize_gesture.test.tsx` 9건. 큐 3건은 `ptyResize.ts` 를 되돌리면 실패하는 것을 확인했다.
- typecheck/test(264 files·3355)/lint/build 와 cargo test 2062 passed 모두 exit 0.
- **실기기 미확인**: Claude Code 를 띄운 도크를 좁혔다 넓혔을 때 끄는 도중 다시 찍힘이 없는지, 손을 뗀 뒤 한 번만 다시 그리는지 봐야 한다.