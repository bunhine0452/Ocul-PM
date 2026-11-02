---
schema_version: 1
type: feature
slug: "terminal-split-panes-tree"
status: done
difficulty: medium
created_at: "2026-11-02T17:26:10+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/paneLayout.ts"
    op: create
  - path: "src/features/terminal/PaneTree.tsx"
    op: create
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/race.ts"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/__tests__/terminal_screen.test.tsx"
    op: update
  - path: "src/__tests__/terminal_pane_layout.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - ref: "20261030/Features_to_add/1757_feature_terminal-split-two.md"
    kind: "followup"
tags:
  - "터미널"
  - "terminal"
  - "orca"
  - "mcp-tool"
---
[x] 터미널: 칸을 몇 번이든 나눈다

## 추가 기능
한 프로젝트의 터미널을 여러 칸으로 띄운다. Orca(설치본 1.4.177 app.asar 의 `PaneManager`)의 방식을 그대로 가져왔다.
- 고른 칸을 오른쪽(⌘D) · 아래(⇧⌘D)로 몇 번이든 나눈다. 칸은 이진 트리고, 칸을 닫으면 짝이 그 자리로 올라간다(Orca `promoteSibling`).
- 칸 경계를 끌거나 화살표 키로 크기를 바꾼다. 두 번 누르면 모든 칸이 고르게 맞춰진다(Orca `equalizePaneSplitSizes`: 같은 방향 잎 수로 나눈다).
- ⇧⌘↩ 를 누르면 고른 칸 하나만 크게 본다(Orca 「Expand pane」).
- 새 칸은 원래 칸의 폴더를 물려받는다. 레인(worktree)이면 그 worktree 에서 열린다.
- 비-mac 단축키는 터미널 가족 규칙을 따른다: Ctrl+Shift+D · Ctrl+Alt+Shift+D · Ctrl+Shift+Enter.

## 동작 흐름
- `paneLayout.ts` 는 순수 트리 연산(split · remove · replace · prune · setRatio · equalize)과 화면 동기(`show` · `syncView`)를 맡는다. `PaneTree.tsx` 가 이것을 flex 로 그린다.
- 칸이 둘 이상이면 칸마다 머리 한 줄(이름 · 상태 · 닫기)이 붙는다. 고른 칸은 액센트 밑줄로 보인다.
- 칸에 없는 세션의 탭을 고르면 고른 칸에 그 세션을 띄운다. 「하나로」는 고른 칸만 남기고, 나머지 세션은 탭에서 계속 돈다.
- 10-30 의 「나란히」(두 칸 고정, ⌘\)는 이것으로 대신했고 옛 경로는 지웠다.
- `mountTerm` 에 `focus` 인자를 더했다. 칸이 여럿 설 때 마지막에 선 칸이 입력 초점을 가져가지 않게 하려고.

## 검증
- typecheck 0 · test 991 passed · lint 0 · build 0.
- Vite+CDP 하네스로 실제 xterm 4칸을 띄웠다(⌘D → ⇧⌘D → ⌘D). 경계를 끌어 50 → 30 이 되는 것을 확인했고 오류는 0건이었다.
- 설치본에서 눈으로 확인하는 일은 남았다.