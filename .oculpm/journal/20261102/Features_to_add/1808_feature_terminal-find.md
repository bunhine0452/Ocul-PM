---
schema_version: 1
type: feature
slug: "terminal-find"
status: done
difficulty: low
created_at: "2026-11-02T18:08:55+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/TermFindBar.tsx"
    op: create
  - path: "src/features/terminal/PaneTree.tsx"
    op: update
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_screen.test.tsx"
    op: update
related: []
tags:
  - "터미널"
  - "terminal"
  - "mcp-tool"
---
[x] 터미널: 출력에서 찾는다

## 추가 기능
⌘F(그 밖 OS 는 Ctrl+Shift+F)를 누르면 고른 칸 오른쪽 위에 찾기 줄이 뜬다. 출력과 스크롤백에서 찾는다.
- 치는 대로 찾는다.
- Enter 는 다음, ⇧Enter 는 이전, Esc 는 닫고 입력으로 돌아간다.
- n/m 수와 대소문자 구분이 있다.
- 다른 칸을 고르면 닫힌다(다른 세션의 출력이라서).

## 동작 흐름
- 의존성 `@xterm/addon-search@^0.15.0` 을 더했다. xterm 5.5.0 과 같은 판이라 webgl 0.18.0 과 짝이 맞는다.
- `termStore` 가 세션마다 SearchAddon 을 싣고 `findInTerm` · `onFindResult` · `clearFind` 를 낸다.
  - 장식 색은 지금 곳이 브랜드 초록 #12a06b, 찾은 곳은 호박색이다. xterm 장식은 #RRGGBB 만 받는다.
- `TermFindBar.tsx` 를 `PaneTree` 의 `overlay`(고른 칸에만) 자리에 얹는다.

## 검증
- `terminal_screen.test.tsx`: 13 passed. ⌘F 로 열기 · 입력 찾기 · Enter/⇧Enter 방향 · Esc 로 지우고 닫기를 확인했다.
- `pnpm test`: 997 passed ×2. `pnpm typecheck` · `pnpm lint` · `pnpm build` 0.
- Rust 변경은 없다. `cargo test --locked` 는 직전 커밋의 1074 passed 가 그대로다.