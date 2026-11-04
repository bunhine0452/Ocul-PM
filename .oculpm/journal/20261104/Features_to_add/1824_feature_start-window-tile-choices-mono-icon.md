---
schema_version: 1
type: feature
slug: "start-window-tile-choices-mono-icon"
status: done
difficulty: medium
created_at: "2026-11-04T18:24:21+09:00"
session_id: "20261104-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "2d22bf7f-6405-4d02-807b-8e7aa8da8901"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/start/StartWindow.tsx"
    op: update
  - path: "src/features/start/start.css"
    op: update
  - path: "src-tauri/src/commands/window/tile.rs"
    op: update
  - path: "src-tauri/src/commands/window/registry.rs"
    op: update
  - path: "src/features/shell/TileChoices.tsx"
    op: create
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src-tauri/src/app_icon.rs"
    op: create
  - path: "src-tauri/icons/mono/icon-mono.svg"
    op: create
  - path: "src-tauri/icons/mono/icon-mono.png"
    op: create
  - path: "src-tauri/src/commands/config.rs"
    op: update
  - path: "src/features/settings/DisplaySection.tsx"
    op: update
  - path: "src/lib/settings.ts"
    op: update
related: []
tags:
  - "창"
  - "ui"
  - "window"
  - "design"
  - "mcp-tool"
---
[x] 창: 시작 창 · 창 정리 2~6개 · 앱 아이콘 흑백

## 추가 기능

사용자 피드백(11-04, v4.7.0 써 본 뒤) 넷을 반영했다.

- 「창이 좁을 때 `● Oc… ▾` 가 답답해」
- 「시작 화면이 촌스럽고 구려」
- 「앱 아이콘 색을 흑백으로 바꿀 수 있게」
- 「창 3개 나란히 놓기가 아니라 2개~6개까지 정리」

### 시작 창 (`features/start/`)
- 베이지 캔버스(`--bg-sidebar`) 위 흰 카드 한 장을 걷었다. 창 전체가 `--bg-content` 한 면이다.
- 목록은 칸이 맞는 표다. `.start-groups` 가 열 6칸을 정의하고 목록 · 줄 · 「열기」 단추가 subgrid 로 이어 받는다. 그래서 딱지와 날짜가 모든 줄에서 같은 세로선에 선다(영수증 규칙 4).
- 「열림」 딱지는 「열린 창」 · 「최근」 두 묶음으로 바꿨다.
- 경로 `whereOf`: 폴더 이름이 프로젝트 이름과 같으면 그 위 폴더만 쓴다(`~/Desktop/git`).
- 채운 단추는 「폴더 열기」 하나다. 채운 단추 안의 키캡은 단추 글자색의 옅은 면으로 바꿨다(`primitives.css`).
- ↑↓ 로 줄을 옮긴다.
- 좁은 폭 처리는 `@container screen` 640 / 460 으로 했다. design lint 가 `@media` 를 거절한다.

### 창 정리 2~6 (`commands/window/tile.rs`, `TileChoices.tsx`)
- `tile_app_windows(count?)` 가 최근에 쓴 창 n 개를 세운다. 순서는 `Registry::recent_labels`, 새로 만든 MRU 라벨 목록이다.
- 배치는 `preferred_cols` 로 정한다: 4 → 2×2, 5 · 6 → 3열. 최소 폭 480 을 못 지키면 열을 줄인다(작은 화면의 3 → 2 + 1).
- 칸은 지금 놓인 순서를 따른다. 앞으로 올리는 순서는 덜 최근 것부터라 ⌥Tab 최근 순서가 그대로다.
- ⌘O 목록 아래에 칸 모양 단추 다섯이 선다. 열린 창보다 많은 수는 `blocked()` 로 막고 툴팁이 이유를 말한다.
- 메뉴 이름을 「프로젝트 창 정리」(⌥⌘T, 6개까지)로 바꿨다.

### 좁은 창 윗줄 (`shell.css`)
- 640 아래의 이름 상한 104px 이 원인이었다. 줄 가운데 160px 가 비어 있는데도 이름이 잘렸다. 이제 이름은 `flex: 0 1 auto; max-width: 240px` 이고 ▾ 는 감춘다.
- 윗줄 접힘 선을 640 에서 780 으로 옮겼다. 660~780 에서 탭 이름이 이름을 「나…」 까지 눌렀다.
- 900 아래에서는 찾기가 돋보기로 줄어든다. `.topbar-actions` 는 `flex-shrink: 0` 이라 「+ 새 일지」 가 잘리지 않는다.

### 앱 아이콘 흑백 (`app_icon.rs`, 설정 「표시 › 앱 아이콘」)
- `settings_set` / `settings_set_many` 가 `app_icon` 키를 받으면 아이콘을 바꾼다. 새 명령은 없다.
- 바꾸는 자리는 두 곳이다: Dock(`NSApplication.setApplicationIconImage`)과 번들(`NSWorkspace.setIcon:forFile:`).
- 번들은 `Icon\r` 이 이미 그 상태면 건드리지 않는다. 기동 때 저장값이 흑백이면 다시 건다.
- 그림은 `icons/mono/icon-mono.svg` 다. 컬러 아이콘과 모양이 같고 색만 회색이며, 헤드리스 Chrome 으로 512px 에 구웠다.
- 의존성: `objc2` 직접 의존을 더했고 app-kit · foundation 기능을 켰다.

## 검증
- `pnpm typecheck` · `pnpm lint` · `pnpm build`: 0. `pnpm test`: 1059 passed. `cargo test --locked`: 0. clippy `-D warnings`: clean.
- 하네스 스크린샷: 시작 창 밝게 · 어둡게 · 500, 윗줄 900 / 800 / 760 / 660 / 640 / 560 / 480, ⌘O 창 정리 줄.
- 설치본에서 볼 것: 실제 Dock 아이콘 교체, 앱을 끈 뒤에도 번들 아이콘이 남는지.