---
schema_version: 1
type: feature
slug: "palette-screen-keys"
status: done
difficulty: medium
created_at: "2026-11-23T21:26:10+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/commands/window/focus.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src/__tests__/jump_waiting.test.ts"
    op: update
  - path: "src/__tests__/palette_keys_love.test.tsx"
    op: create
  - path: "src/api/terminal.ts"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/components/ShortcutCheatsheet.tsx"
    op: update
  - path: "src/features/planner/PlanDoc.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/features/shell/jumpWaiting.ts"
    op: update
  - path: "src/hooks/useGlobalShortcuts.ts"
    op: update
  - path: "src/lib/kbd.ts"
    op: update
  - path: "src/lib/projectActions.ts"
    op: update
  - path: "src/lib/screenActions.ts"
    op: create
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "팔레트"
  - "love-round"
  - "keyboard"
  - "mcp-tool"
---
[x] 팔레트: ? 키 시트와 지금 화면 동작

## 추가 기능
- 입력 칸 · 터미널 밖에서 `?` 를 누르면 「이 화면의 키」 작은 시트가 지금 화면의 키만 보인다. 다시 `?` 로 닫고, 「단축키 전체 ⌘/」 로 넓힌다. 출처는 navRegistry · shortcutRegistry 하나(손으로 만든 표 없음).
- ⌘K 에 「지금 화면」 무리 — 각 화면이 이미 가진 윗줄 동작(터미널의 새 세션 · 찾기, 변경의 영수증 · 메모 보내기, 계획의 다음 실행 · 끝까지 · 셸에서 돌리기)을 그대로 부른다.
- ⌘K · ⌘J 로 다른 창의 터미널 세션을 고르면 그 창이 앞으로 오고 터미널 탭에 그 세션이 골라진다(이월 #palette-cross-window-focus — term_focus_session · TermFocusAsked).
- ⌘K 의 일지 본문 검색(두 글자부터)은 이미 있어 그대로 뒀다.

## 동작 흐름
`?` 는 ⌘ · Ctrl · ⌥ 없이, 텍스트 칸 · 터미널 밖에서만 듣는다. ⇧⌘C 영수증 · 터미널 키와 겹치지 않는다. 시작 창은 목록이 글자를 먼저 받아 빼고 ⌘/ 로 둔다.

## 검증
vitest `palette_keys_love` · `jump_waiting` 초록, 최종 검수 F1 영향 범위 78 passed. 창을 건너는 초점은 실제 창이 있어야 해서 Rust 시험 없이 설치본 확인 몫.