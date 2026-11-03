---
schema_version: 1
type: feature
slug: "window-switcher-alt-tab"
status: done
difficulty: medium
created_at: "2026-11-04T03:49:16+09:00"
session_id: "20261104-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "011dde9e-5e7e-4fbe-b351-fec86b11e9b0"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/shell/WindowSwitcher.tsx"
    op: create
  - path: "src/__tests__/window_switcher.test.tsx"
    op: create
  - path: "src-tauri/src/commands/window/registry.rs"
    op: update
  - path: "src-tauri/src/commands/window/projects.rs"
    op: update
  - path: "src-tauri/src/commands/window/tests.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/window.ts"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/features/theme/projectTint.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "창"
  - "window"
  - "design"
  - "mcp-tool"
---
[x] 창: ⌥Tab 창 전환기와 또렷한 창 색

사용자 요청(11-04): 「여러 프로젝트 oculpm으로 열면 창전환 더 편하고 더 유연하게 하고싶어. 제발」 → 고른 것은 창 전환기. 함께 「테마 상단에 한줄만 보이게 하지말고 좀더 구분가게」, 「내가 색 바꾸면 다른 프로젝트의 색도 바뀌는 버그」, 「내가 한번도 열지 않은 프로젝트들이 바뀌어」.

## 추가 기능
- **창 전환기** (`features/shell/WindowSwitcher.tsx`): macOS ⌥Tab · 그 밖 Ctrl+` 를 누르고 있으면 열린 프로젝트 창이 최근에 쓴 순서로 서고, Tab · ⇧Tab · ↑↓ 로 고르고 손을 떼면 그 창(`openProjectWindow` — 이미 열린 창을 앞으로). 140ms 안에 떼면 목록을 그리지 않고 직전 창으로. esc 취소, 창이 포커스를 잃으면 취소. 키는 window 캡처 단계라 터미널(xterm) 위에서도 먼저 받는다. 목록이 오기 전의 Tab · 손 뗌도 기억했다가 적용한다.
- 백엔드: `Registry.recent`(MRU) — register · restore · note_focus 가 앞으로, remove 가 뺀다. `recent_projects()` 는 시작 창을 빼고 프로젝트 id 를 최근 순으로. 명령 `recent_window_projects`.
- 단축키 표(`shortcutRegistry.ts`)에 ⌥Tab / Ctrl+`.

## 결함
설치본 4.5.1 에서 윗줄(`.topbar[data-pc]`)의 `--pc` 가 그 안의 색 없는 점(⌘O 목록 · 시작 창)에 물려 내려가, 색을 바꾸면 한 번도 색을 고르지 않은 프로젝트의 점이 같이 바뀌었다. DB 에는 프로젝트마다 바른 색이 있었다(읽기 전용으로 확인). `--pc` · `--pc-soft` 를 `@property inherits: false` 로 등록하고, 이름 알약처럼 창 안에서 그 창 색이 필요한 곳은 `--win-pc` 로 받는다.

## 창 구분
윗줄 전체 면(밝게 14% · 어둡게 20%) + 색 띤 아랫선 + 이름 알약(16%, hover 26%), 바탕 물들임 6.5% · 9.5%.

## 검증
```
cargo test --locked → EXIT=0 (recent_projects_follow_focus_order 포함)
pnpm vitest run src/__tests__/window_switcher.test.tsx → 6 passed
pnpm test → Tests 1055 passed (1055)
pnpm typecheck / pnpm lint / pnpm build → exit 0
```
하네스: 네 창(파랑 · 장미 · 초록 · 색 없음) 밝게 · 어둡게, 전환기 펼침, 톡 누름 → `open_project_window` 만 불리고 목록 없음. PR #165.