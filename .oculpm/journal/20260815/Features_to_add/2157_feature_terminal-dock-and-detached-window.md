---
schema_version: 1
type: feature
slug: "terminal-dock-and-detached-window"
status: done
difficulty: high
created_at: "2026-08-15T21:57:17+09:00"
session_id: "mcp-20260815-215717"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: create
  - path: "src/features/terminal/TerminalDock.tsx"
    op: create
  - path: "src/features/terminal/TerminalAway.tsx"
    op: create
  - path: "src/windows/TerminalWindow.tsx"
    op: create
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/hooks/useGlobalShortcuts.ts"
    op: update
  - path: "src/windows/ProjectTab.tsx"
    op: update
  - path: "src/lib/windowRoute.ts"
    op: update
  - path: "src/main.tsx"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src-tauri/src/commands/window.rs"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/menu.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/capabilities/default.json"
    op: update
  - path: "src-tauri/tests/acp_handshake.rs"
    op: correct
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: correct
  - path: "src/__tests__/terminal_dock.test.tsx"
    op: create
  - path: "src/__tests__/multi_window.test.tsx"
    op: update
  - path: "src/__tests__/terminal_quality_round.test.ts"
    op: update
  - path: "scripts/check-no-localstorage.mjs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "terminal"
  - "dock"
  - "multi-window"
  - "pty"
  - "ui"
  - "mcp-tool"
---
[x] 터미널을 어느 화면에서나 — 하단·왼쪽 도크 + 창으로 분리

## 추가 기능

터미널은 **다른 화면을 보면서** 쓰는 물건인데, 지금까지는 ⌘10 으로 터미널 화면에 들어가야만 셸이 보였다. 일지·플래너를 보려면 나와야 했고, 그래서 앱 밖 iTerm 으로 돌아가게 됐다.

- **도크** — 어느 화면에서나 ⌘J (사이드바 발밑에도 버튼). 붙이는 자리는 **사용자가 고른다**: 하단(가로 폭 우선) / 왼쪽(세로 길이 우선). 드래그로 크기 조절, 자리·크기·열림 상태 영속.
- **창으로 분리** — 도크의 ⇱ 로 셸을 자기 창(`index.html?term=<id>`)에 떼어낸다. 세션은 옮겨가지 않고 **그대로 이어진다** (PTY 는 Rust 에 살아 있고 sid 가 프로젝트 기준이라 스크롤백까지 복원). 앱 안에는 자리표시자 + "되돌리기" 가 남는다.
- 세션은 **터미널 화면·도크·분리 창이 공유**한다. 자리를 옮기거나 창으로 떼어내도 하던 셸이 이어진다.

## 동작 흐름

**소유권 — 터미널을 그리는 면은 언제나 하나.** 하나의 PTY 에 xterm 둘이 붙으면 서로의 `fit()` 을 되돌려 화면이 떨린다. `ShellV2` 가 `분리 창 > 터미널 화면 > 도크` 순으로 심판한다.

**분리 상태의 진실은 창의 존재 여부**다. 백엔드가 `TerminalWindowsChanged` 로 알려 주고 프런트는 미러링만 한다 — 사용자가 OS 닫기 버튼으로 창을 닫아도 같은 길로 되돌아온다.

**PTY 정리는 refcount 로.** 예전엔 탭이 닫히면 `p<pid>-` 접두사를 전량 kill 했다. 그대로 두면 터미널을 떼어낸 뒤 프로젝트 탭을 닫는 순간 분리 창 **안의 셸만** 사라진다. 이제 탭·터미널 창 **둘 다 없을 때만** 죽인다(`Registry::project_in_use`). 마지막 앱 창을 닫을 때의 총정리도 `kill_except` 로 분리 창의 접두사를 살린다.

**영속 레코드를 창 둘이 나눠 소유한다.** 한 프로젝트의 `aipm:workspace:v2:p<id>` 를 앱 창과 분리 창이 함께 쓰게 됐다 — 둘 다 통째로 쓰면 나중에 저장한 쪽이 상대의 변경을 지운다. `PersistScope` 로 각자 자기 몫만 쓰고 나머지는 디스크 값을 남긴다: 앱 창은 분리 중 터미널 세션 필드를 건드리지 않고, 분리 창은 터미널 세션 필드만 쓴다. 되돌아올 때(`setTerminalDetached(false)`) 디스크에서 다시 읽는다.

**함정 셋을 같이 막았다.**
- `⌘W` — `focused_app_window` 는 터미널 창을 앱 창으로 치지 않아 "마지막으로 포커스된 탭 창"으로 떨어진다. 그대로 두면 터미널 창에서 누른 ⌘W 가 **남의 창의 탭**을 닫는다. `focused_terminal_window` 를 먼저 물어본다.
- **capabilities** — 창 라벨로 스코프된다(`main`/`tray`/`win-*`). `term-*` 을 빼먹으면 분리 창은 커맨드도 이벤트도 못 쓰는 빈 창이 된다.
- **"마지막 창"** — 분리 터미널이 남아 있는데 종료·상주 전환을 밟으면 방금 떼어낸 터미널이 통째로 사라진다.

**리팩토링 동반.** 터미널 본체를 `TerminalSurface` 로 분리했다 (세 면이 같은 것을 그리므로). 화면 툴바에만 있던 검색·분할 버튼도 탭 줄로 옮겼다 — 툴바에 두면 도크에서만 못 쓰는 조작이 생긴다. 도크의 단축키는 `keyboardScope="focused"` 라, 일지를 읽다 누른 ⌘F 가 스크롤백 검색을 열지 않는다.

**곁다리 2건(선행 조건).** `cargo test` 가 main 에서 이미 깨져 있어 바인딩 생성이 막혀 있었다 — ① `e883dd7` 이 `AcpEvent::Failure`/`Plan` 을 추가하고 `tests/acp_handshake.rs` 의 망라 match 를 안 고침, ② `plugin.json` 이 2.9.0 에 멈춤(v2.10.0 릴리스 누락, `scripts/build-sidecar.mjs` 로 동기).

## 검증

- 게이트 5종 전부 exit 0 직접 확인: `pnpm typecheck` / `test`(873) / `lint` / `build` / `cargo test`(585, +4 신규).
- 신규 테스트 — 프런트 `terminal_dock.test.tsx` 11건(크기 클램프 6, 창 둘의 레코드 소유권 5) + `multi_window.test.tsx` 에 `?term=` 라우트 3건. Rust — 터미널 창 라벨/`is_app_window` 제외, `project_in_use` refcount, `terminal_window_projects` 정렬, `kill_except` 접두사 판정.
- **미검증**: 실제 앱에서의 시각 확인. 병렬 세션의 `tauri dev`(PID 18521)가 이미 떠 있어 두 번째 인스턴스를 띄우지 않았다. Rust 변경은 그 dev 인스턴스 재시작이 필요하다.