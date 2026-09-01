---
schema_version: 1
type: bug
slug: cmd-t-terminal-new-tab
status: done
difficulty: medium
created_at: 2026-09-01T15:12:00+09:00
session_id: manual-20260901-151200
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src/lib/intentChain.ts
    op: create
  - path: src/lib/newTabIntent.ts
    op: create
  - path: src/lib/closeIntent.ts
    op: update
  - path: src/lib/windowRoute.ts
    op: update
  - path: src/features/terminal/TerminalSurface.tsx
    op: update
  - path: src/windows/TabbedWindow.tsx
    op: update
  - path: src/windows/TerminalWindow.tsx
    op: update
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src-tauri/src/menu.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: src/__tests__/new_tab_intent.test.ts
    op: create
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related:
  - .oculpm/journal/20260829/Bugs/1538_bug_close-is-not-focus-aware.md
tags:
  - terminal
  - shortcuts
  - menu
  - macos
---

[x] 터미널에 포커스가 있어도 ⌘T 가 프로젝트 탭을 열던 문제

## 발생 원인

`⌘T` 는 앱 메뉴의 액셀러레이터다 (`src-tauri/src/menu.rs::ACC_NEW_TAB`). macOS 는
메뉴 액셀러레이터를 웹뷰보다 **먼저** 소비하므로 웹뷰에는 `keydown` 이 아예
도달하지 않는다. 그런데 터미널의 새 탭은 `TerminalSurface` 의 keydown 리스너
안 `k === "t"` 분기에 있었다 — **한 번도 실행된 적이 없는 코드**였고, 메뉴는
곧장 `new_start_tab_inner` 를 불러 프로젝트 탭을 열었다. 치트시트
(`lib/shortcutRegistry.ts`)에는 "⌘T = 터미널 새 탭"이 적혀 있었으니 약속만 남고
동작이 없었던 셈이다.

2026-08-29 에 ⌘W 가 정확히 같은 이유로 죽어 있었고 그때 `CloseIntent` 사슬로
풀었다. ⌘T 만 옮겨오지 않은 채 남아 있었다.

분리 터미널 창은 더 나빴다: 메뉴 처리기가 `focused_app_window` 로 떨어져
**남의 창에** 프로젝트 탭이 열렸다 (⌘W 가 겪었던 그 버그의 재판).

## 해결 방법

⌘W 의 길을 그대로 따른다 — Rust 는 판단하지 않고 의도만 쏜다.

- `NewTabIntent { window }` 이벤트 신설. `menu.rs` 의 `NEW_TAB` 은 분리 터미널
  창을 먼저 묻고(⌘W 와 같은 순서), 앱 창이면 그 창에 의도를 쏜다. 들을 창이
  하나도 없을 때만 예전처럼 Rust 가 시작 탭을 만든다.
- 프런트에 `lib/newTabIntent` 사슬. 순서·포커스 우선권 규칙은 `closeIntent` 에서
  `lib/intentChain` 으로 추출해 두 키가 공유한다 (동작 변경 없음).
- `TerminalSurface` 는 죽은 ⌘T keydown 분기를 버리고 사슬에 등록한다. 포커스가
  자기 면 안에 있을 때만 가져간다 — 크롬식 탭은 **배경 프로젝트 탭도 마운트된
  채**라 포커스 말고는 "지금 보고 있는 터미널"을 가릴 방법이 없다.
- 분리 터미널 창은 `ownsNewTab` 로 포커스 조건을 면제한다 (그 창엔 다른 탭이
  없고, 포커스가 크롬 버튼에 있으면 ⌘T 가 통째로 씹힌다).
- `TabbedWindow` 는 아무도 소비하지 않을 때만 시작 탭을 연다.

## 검증

`cargo test`(1006+ 통과, `bindings.ts` 재생성) · `cargo fmt --check` · `cargo
clippy --all-targets -D warnings` · `pnpm typecheck` · `pnpm test`(136 파일 /
1663 통과, 신규 `new_tab_intent.test.ts` 9건 포함) · `pnpm lint` · `pnpm build`
전부 exit 0. 신규 테스트는 포커스 우선권과 "포커스가 밖이면 소비하지 않는다"를
단언하고, 소스 가드로 ⌘T keydown 분기의 부활(= 비 macOS 에서 탭 두 개)을 막는다.

## 메모

⌘D·⌘F·⌘L·⌘± 는 메뉴 액셀러레이터가 아니라 keydown 이 정상 도달한다 — 이번
변경 대상이 아니다. 실기기 확인(설치본에서 도크·터미널 화면·분리 창 각각의
⌘T)은 사용자 몫으로 남는다.
