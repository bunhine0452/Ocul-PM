---
schema_version: 1
type: feature
slug: "convenience-round-terminal-switcher"
status: done
difficulty: medium
created_at: "2026-11-03T01:36:56+09:00"
session_id: "20261103-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "6fc3a353-b7f3-424c-8f8a-3203b542643e"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/termFontSize.ts"
    op: create
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/convenience_keys.test.tsx"
    op: create
  - path: "src/__tests__/terminal_screen.test.tsx"
    op: update
related: []
tags:
  - "터미널"
  - "terminal"
  - "shell"
  - "mcp-tool"
---
[x] 터미널: 편의 키와 목록 거르기를 더한다

## 추가 기능
사용자 요청(11-03) 「이런 편의성이 완성도를 가른다 — 다른 거 다 찾아 적용」. 창 여럿 · 터미널 여럿으로 에이전트를 돌리는 사람 기준으로 빠진 것을 찾았다.
- **일하는 세션 닫기 전에 묻기** — ⌘W · ✕ 로 세션을 닫을 때 안에서 무언가 돌면(Claude 작업 중) 확인. 빈 셸은 바로.
- **이전 · 다음 세션 ⇧⌘[ / ⇧⌘]** (그 밖 Ctrl+PageUp/PageDown) — iTerm · Terminal.app 과 같은 키. 탭 순서로 돈다.
- **터미널 글자 크기 ⌘= / ⌘- / ⌘0** — 9~28px, 설정(`terminal_font_size`)에 남아 모든 창 · 세션이 같다.
- **⌘O 목록 거르기** — 열면 바로 쳐서 이름 · 경로로 좁히고 ↩ 로 첫 줄을 연다. ⌥⌘ 번호는 거르기 전 그대로.
- 단축키 안내에 ⌘W 새 동작 · 세션 이동 · 글자 크기 줄.

## 동작 흐름
- `termFontSize.ts` 가 키 → 새 크기(범위 지킴), `termStore.setTermFontSize` 가 모든 세션에 적용하고 보이는 칸을 다시 맞춘다.
- 세션 busy 는 목록을 줄 때 재는 값이라 닫기 직전 `terminalApi.list()` 로 다시 읽는다.

## 검증
- pnpm test 1021 passed(새 `convenience_keys.test.tsx` 6건), typecheck/lint/build 0
- 설치본 육안 확인은 아직