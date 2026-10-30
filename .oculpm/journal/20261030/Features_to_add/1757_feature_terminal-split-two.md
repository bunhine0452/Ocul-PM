---
schema_version: 1
type: feature
slug: "terminal-split-two"
status: done
difficulty: medium
created_at: "2026-10-30T17:57:55+09:00"
session_id: "20261030-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
  - path: "src/__tests__/terminal_screen.test.tsx"
    op: update
related: []
tags:
  - "터미널"
  - "orca-bench"
  - "split"
  - "mcp-tool"
---
[x] 터미널: 세션 둘을 나란히 본다

## 추가 기능

사용자 결정(10-30): Orca 의 「Terminal Splits」를 가져온다(계획 `orca-bench-20261030` #term-split). 「터미널을 3.x 쪽으로 키우지 않는다」는 규칙을 사용자가 이번에 직접 풀었다.

범위는 칸 둘을 반반으로 나누는 데까지다. 세션은 앱 안 그대로이고, PTY 호스트 · 떼어내기 · 끌어서 크기 바꾸기는 넣지 않았다.

## 동작 흐름

- **켜고 끄기:** 툴바의 「나란히 / 하나로」, 또는 ⌘\. Windows · Linux 는 Ctrl+Shift+\ 다(Ctrl+\ 는 셸의 SIGQUIT).
- **켤 때:** 가장 최근의 다른 세션을 오른쪽 칸에 붙인다. 다른 세션이 없으면 새 셸을 연다.
  - 이때 「새 세션이 생기면 그 세션을 고른다」는 기존 규칙이 왼쪽을 빼앗지 않도록 `openingSplit` 표식을 둔다. 효과 훅이 그 증가를 한 번 소비한다.
- **자리 바꾸기:** 오른쪽 세션의 탭(테 두름)을 누르면 두 칸이 자리를 바꾼다.
- **접힘:** 오른쪽 세션이 닫히거나 왼쪽으로 오면 접힌다.
- **끌 때:** 오른쪽 세션은 탭에 남아 계속 돈다.
- **기억:** 화면을 오가도 나란히 상태를 기억한다(`rememberedSplit`, 창 하나에 하나).
- **함정:** 왼쪽 칸은 늘 같은 DOM 요소여야 한다. 감싸는 구조가 바뀌어 다시 만들어지면 `mountTerm` 으로 붙어 있던 터미널이 떨어진다. 그래서 `.tm-panes` 를 늘 그린다.
- **끌어다 놓기와의 관계:** 두 칸 모두 `data-term-id` 를 달아, 끌어다 놓기가 커서 아래 칸으로 간다.

## 검증

- `terminal_screen.test.tsx` → 9 passed(+2): ⌘\ 로 붙임(새 세션 안 엶), 오른쪽 탭으로 자리 바꾸기, 닫히면 접힘, 하나뿐이면 새 셸(왼쪽 유지), 끄면 탭에 남음.
- 하네스: 두 칸이 640 · 641px 이고 가운데 선, 오른쪽 탭의 테, 툴바 「하나로 ⌘\」를 스크린숏으로 확인했다.
- 처음 돌린 `pnpm test` 에서 `i18n_glossary` 가 새 설명의 줄표를 잡았다(값에 「 — 」 금지). 고친 뒤 966 passed.
- `pnpm typecheck` 0 · `pnpm lint` 0 · `pnpm build` 0