---
schema_version: 1
type: feature
slug: "terminal-pane-move-keys"
status: done
difficulty: low
created_at: "2026-11-02T18:10:50+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/paneNav.ts"
    op: create
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_pane_nav.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "터미널"
  - "terminal"
  - "mcp-tool"
---
[x] 터미널: 칸 사이를 방향키로 옮겨 다닌다

## 추가 기능
⌥⌘ + 방향키(iTerm 과 같은 키, 그 밖 OS 는 Ctrl+Alt + 방향키)로 고른 칸을 옮긴다. 키보드 단축키 표(⌘/)에 「터미널」 묶음을 새로 넣었다: 새 세션 ⌘T · 오른쪽 ⌘D · 아래 ⇧⌘D · 칸 이동 · 크게 ⇧⌘↩ · 찾기 ⌘F.
- Orca 의 ⌘[ / ⌘] 는 이 앱의 화면 뒤로/앞으로와 겹쳐서 쓰지 않았다.
- ⌥⌘ + 방향키는 4.0 에서 탭 키와 함께 걷혀 비어 있었다.

## 동작 흐름
- `paneNav.ts` 의 `neighborOf(rects, from, dir)` 는 순수 함수다.
  - 트리 형제가 아니라 화면의 실제 사각형으로 고른다. 오른쪽 칸을 아래로 또 나누면 트리 형제가 엉뚱한 칸이 되기 때문이다.
  - 그 방향 가장자리 너머에서 직각 방향으로 겹치는 칸 가운데 가장 가까운 것을 고르고, 같으면 중심이 가까운 것을 고른다.
- `TerminalScreen` 이 `.tm-pane[data-term-id]` 의 `getBoundingClientRect` 를 재서 넘긴다.
  - 고른 칸과 칸 수는 ref 로 읽는다. 나눈 직후 처리기가 다시 걸리기 전에 온 키를 위해서다.

## 검증
- `terminal_pane_nav.test.ts`: 2 passed. ┌1│2/3│4┐ 배치에서 1→오른쪽=2, 4→왼쪽=3, 3→왼쪽=1, 2→아래=3, 벽이면 null 을 확인했다.
- `platform_keys` · `polish_phase2`(단축키 중복) 포함 `pnpm test` 999 passed ×2. `pnpm typecheck` · `pnpm lint` · `pnpm build` 0. Rust 변경은 없다.