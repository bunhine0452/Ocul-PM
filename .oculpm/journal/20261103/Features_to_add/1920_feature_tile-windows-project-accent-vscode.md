---
schema_version: 1
type: feature
slug: "tile-windows-project-accent-vscode"
status: done
difficulty: medium
created_at: "2026-11-03T19:20:29+09:00"
session_id: "20261103-008"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "011dde9e-5e7e-4fbe-b351-fec86b11e9b0"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/window/tile.rs"
    op: create
  - path: "src-tauri/src/commands/window/mod.rs"
    op: update
  - path: "src-tauri/src/menu.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/editor_choice.rs"
    op: update
  - path: "src-tauri/src/commands/external_editor.rs"
    op: update
  - path: "src-tauri/src/vscode_color.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src/features/theme/projectAccent.ts"
    op: create
  - path: "src/contexts/SettingsContext.tsx"
    op: update
  - path: "src/features/shell/TopBar.tsx"
    op: update
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/api/window.ts"
    op: update
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/__tests__/design_tokens.test.ts"
    op: update
  - path: "src/__tests__/project_color.test.tsx"
    op: update
related:
  - ref: "20261103/Features_to_add/0257_feature_project-color-vscode-title-bar.md"
    kind: "followup"
tags:
  - "창"
  - "window"
  - "project-color"
  - "vscode"
  - "mcp-tool"
---
[x] 창: 프로젝트 창을 나란히 세우고 색을 입힌다

## 추가 기능
사용자 요청(11-03 오후): 여러 프로젝트 창을 화면에 잘 띄우고, 프로젝트별 테마를 창과 VS Code 에 입히고, VS Code 도 프로젝트마다 제 창으로 열리게.

- **프로젝트 창 나란히** — `commands/window/tile.rs`. 보이는 앱 창 전부를 지금 창이 있는 화면의 작업 영역에 같은 폭 칸으로 세운다. 지금 놓인 왼→오 순서를 지키고, 칸이 최소 폭(480pt)보다 좁아지면 줄을 늘린다(5개 → 3+2). macOS 창 메뉴 「프로젝트 창 나란히」(⌥⌘T) + 프로젝트 ▾ 목록의 「창 N개 나란히 놓기」(창 2개 이상일 때만). 배치 `tile_layout` 은 순수 함수.
- **프로젝트 색 = 그 창의 강조색** — `features/theme/projectAccent.ts`. TopBar 가 이 창 프로젝트의 색을 스토어에 넣고 SettingsContext 가 설정 강조색보다 앞세운다. 노랑·회색용 `amber` · `slate` 팔레트를 새로 넣었다(흰 글자 대비 AA 통과). 윗줄 바탕도 그 색으로 9% 물든다.
- **VS Code 상태 표시줄 색** — `vscode_color.rs` 가 제목 표시줄에 더해 `statusBar.*` 도 맞춘다. 이미 색을 고른 프로젝트는 색을 한 번 다시 골라야 새 키가 들어간다.
- **VS Code 를 프로젝트 창으로** — `vscode://file/<파일>` 은 그 폴더 창이 없으면 마지막으로 쓴 창(다른 프로젝트)에 파일을 낱장으로 열었다. 이제 앱 번들 안의 `code` · `cursor` 도구에 `<프로젝트> [-g] <파일>:<줄>` 을 셸 없이 넘긴다 — 그 프로젝트 창이 있으면 그 창, 없으면 새 창. 도구를 못 찾으면 예전 주소로. 기동 자리는 `egress_spawn_ledger` 에 로컬로 등록.

## 동작 흐름
⌥⌘T → `menu::handle_event` → `tile_inner` → 모니터 work_area · scale_factor → 칸 계산 → 전체화면·최대화 해제 후 set_position/set_size(장식 몫 빼고).

## 검증
pnpm test 1040 passed · typecheck/lint/build 0 · cargo test 1099 passed · clippy -D warnings 0. 설치본에서 창 세우기 · VS Code 열기는 아직 눈으로 못 봤다.