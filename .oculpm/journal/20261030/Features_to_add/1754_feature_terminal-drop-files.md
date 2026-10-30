---
schema_version: 1
type: feature
slug: "terminal-drop-files"
status: done
difficulty: low
created_at: "2026-10-30T17:54:02+09:00"
session_id: "20261030-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/dropFiles.ts"
    op: create
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
  - path: "src/__tests__/terminal_drop_files.test.tsx"
    op: create
related: []
tags:
  - "터미널"
  - "orca-bench"
  - "drag-drop"
  - "mcp-tool"
---
[x] 터미널: 끌어다 놓은 파일 경로를 입력에 넣는다

## 추가 기능

사용자 결정(10-30): Orca 의 「Drag Files to Agents」를 가져온다(계획 `orca-bench-20261030` #drop-files). Finder 에서 파일이나 그림을 터미널에 놓으면 따옴표 친 경로가 그 세션의 입력에 붙는다. iTerm · Terminal.app 과 같은 동작이고, Claude Code 는 그림 경로를 첨부로 바꾼다.

## 동작 흐름

1. 앱 창은 Tauri 드래그-드롭이 켜져 있어서 DOM `drop` 에는 경로가 없다. 그래서 웹뷰의 `onDragDropEvent` 로 경로와 물리 좌표를 받는다.
2. 좌표를 `devicePixelRatio` 로 나눈 자리에서 `elementFromPoint` → `[data-term-id]` 로 커서 아래 칸의 세션을 찾는다. 못 찾으면 고른 세션이 받는다. 다음 항목인 나란히 보기에서도 그대로 쓰도록 이렇게 했다.
3. 끌고 지나는 동안 그 칸에 액센트 테와 「놓으면 경로를 입력에 넣어요」를 띄운다.
4. 놓으면 `pasteToTerm` → xterm `paste` 로 붙인다. 안의 프로그램이 브래킷 붙여넣기를 켰을 때만 감싸므로, 셸 프롬프트에 날 escape 가 찍히지 않는다.
5. 따옴표 규칙:
   - 셸 낱말이 되는 경로는 그대로 둔다.
   - POSIX 는 작은따옴표로 감싸고, 안의 `'` 는 `'\''` 로 바꾼다.
   - Windows 는 큰따옴표로 감싼다.
   - 끝에 빈칸을 하나 붙인다.

함정: 한글 하드코딩 검사(`check-no-hardcoded-korean`)는 중첩 템플릿 문자열을 따라가지 못해, 그 뒤의 주석을 코드로 읽었다. 따옴표 처리를 문자열 연결로 바꿨다.

## 검증

- `pnpm vitest run src/__tests__/terminal_drop_files.test.tsx` → 4 passed: 따옴표(공백 · `'` · 한글 · Windows), 지나감 → 테 → 떠남, 놓기 → 붙임, 해제.
- 기존 `terminal_screen.test.tsx` 의 가짜 `termStore` 에 `pasteToTerm` 을 더했다.
- `pnpm typecheck` 0 · `pnpm test` 959 passed · `pnpm lint` 0 · `pnpm build` 0
- Finder 에서 실제로 끌어 놓는 확인은 설치본에서 할 일로 남았다(하네스에는 OS 드롭이 없다).