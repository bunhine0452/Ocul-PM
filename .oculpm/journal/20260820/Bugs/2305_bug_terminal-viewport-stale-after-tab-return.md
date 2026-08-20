---
schema_version: 1
type: bug
slug: "terminal-viewport-stale-after-tab-return"
status: done
difficulty: high
created_at: "2026-08-20T23:05:00+09:00"
session_id: "manual-20260820-230508"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/viewportResync.ts"
    op: create
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/__tests__/terminal_viewport_resync.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - "journal/20260820/Bugs/2244_bug_sidebar-collapse-per-tab.md"
tags: ["terminal", "xterm", "viewport", "multi-window", "claude-code"]
---

[x] 다른 프로젝트 탭에 갔다 오면 터미널이 출력을 못 따라와 잘리던 것

## 발생 원인

오른쪽 도크에서 claude code 를 돌려 두고 다른 프로젝트 탭에 갔다 돌아오면, 대화는 계속 아래로 흘렀는데 화면이 그걸 따라가지 못한 채 굳었다. ⌘J 로 도크를 닫았다 열면 나았다.

**⌘J 가 나은 이유부터가 단서였다.** 도크는 `dockVisible &&` 조건부 렌더라 ⌘J 는 터미널을 **언마운트했다 다시 마운트**한다. xterm 이 통째로 새로 만들어지고 백엔드 스크롤백을 재생하니 어긋남이 남을 수가 없다 — 고친 게 아니라 새로 지은 것이다. 즉 "돌아왔을 때 무엇이 어긋난 채로 남는가" 가 진짜 질문이었다.

xterm 5.5 의 `browser/Viewport.ts` 를 소스맵에서 꺼내 읽고 확정했다. 비활성 탭은 `.tabpane[hidden] { display: none }` 이다. 그 동안에도 출력이 오면 Viewport 는 `_innerRefresh()` 를 계속 도는데,

```ts
this._lastRecordedViewportHeight = this._viewportElement.offsetHeight;   // ← 0
```

레이아웃 상자가 없는 엘리먼트의 `offsetHeight` 는 0 이다. 그래서 (1) 스크롤 영역 높이를 캔버스 높이만큼 짧게 잡아 캐시하고, (2) 이어지는 `scrollTop` 대입은 조용히 무시된다. xterm 자신도 `_handleScroll` 에 "hidden 상태의 scrollTop 은 오염되며 버퍼를 맨 위로 끌어올린다"고 적어 두고 **그 함수만** 막아 뒀다 — `_innerRefresh` 는 막혀 있지 않다.

돌아왔을 때 우리 `ResizeObserver` 가 `fit()` 을 부르지만 아무 일도 일어나지 않는다. 탭을 오갔다 오면 **크기가 같으므로** 애초에 리사이즈가 없고, 설령 불려도 `Terminal.resize(x, y)` 는 `x === cols && y === rows` 면 즉시 반환한다. xterm 의 IntersectionObserver 는 **행 다시 그리기**만 재개할 뿐 스크롤 기하는 손대지 않는다. 그래서 어긋남이 그대로 굳는다.

## 해결 방법

크기가 아니라 **가시성**으로 판정하고, 다시 보이는 순간 뷰포트를 강제로 되맞춘다 (`src/features/terminal/viewportResync.ts`).

- `nextRevealState(wasVisible, entry)` — `IntersectionObserver` 항목에서 "숨었다 지금 보이게 됐는가" 를 가려내는 순수 함수. `TerminalInstanceImpl` 이 컨테이너에 IO 를 걸고(xterm 이 렌더 재개를 판정하는 것과 같은 잣대) 이 전이에서만 움직인다.
- `resyncViewport(term)` — `scrollback` 을 1 올렸다 되돌린다. Viewport 가 `onSpecificOptionChange('scrollback')` 에서 `syncScrollArea()` 를 부르고, 그 안의 "캐시된 뷰포트 높이 ≠ 실제 캔버스 높이" 판정이 (캐시가 0 이므로) 반드시 걸려 높이와 `scrollTop` 을 다시 계산한다. 이어서 `refresh(0, rows-1)` 로 밀린 행을 한 번 다시 그린다.
- 되맞춤 직전에 `fit()` + `resizePty` 도 한 번 — 자리를 비운 사이 창이 실제로 커졌을 수 있다.

`scrollback` 을 고른 이유: 공개 API 중 `syncScrollArea()` 를 확실히 부르면서 **버퍼를 건드리지 않는** 유일한 길이다. `resize()` 는 같은 치수에서 반환하고, `scrollLines(0)`·`scrollToLine(현재줄)` 은 이동량 0 이라 빠져나가며, `refresh()` 는 행만 그린다. 한도를 늘렸다 줄이는 사이는 동기 구간이라 새 줄이 끼어들 수 없어 잘려 나가는 스크롤백도 없다. 행 수를 흔들어 리플로를 유발하는 방법도 있었지만, PTY 에 알리지 않는 리플로는 TUI 에 빈 줄을 남길 수 있어 택하지 않았다.

## 검증

- `pnpm test` 1059 통과(신규 9: 가시성 전이 4종 — 특히 "같은 크기로 돌아온" 경로, `scrollback` 왕복 순서·복원·기본값 폴백, `refresh` 범위와 rows=0 경계). typecheck·lint·build 각각 exit 0.
- 실제 앱에서의 재현·확인은 아직 사용자 몫이다 (`verified_by_user: false`). jsdom 에는 실제 레이아웃이 없어 이 버그 자체를 테스트로 재현할 수 없다 — 그래서 원인은 xterm 소스에서 확정하고, 테스트는 **판정과 자극**이라는 우리 쪽 두 조각만 못박았다.
- 전체 스위트를 5회 돌리는 동안 1회 알 수 없는 실패가 있었으나 이후 4회 연속 통과했고 실패 이름을 잡지 못했다. 이번 변경과의 연관은 확인되지 않았지만 사실대로 남긴다.

## 메모

같은 오염은 **도크 안의 터미널 탭 전환**(`visible=false` → `display:none`)에도 있었다. IO 는 그 경로도 같이 덮는다.

이 파일은 재발 이력이 있는 표면이라(2026-07-31 크래시 2건) 새 옵저버는 기존 `ResizeObserver` 와 같은 자리에서 `disconnect()` 로 정리한다.
