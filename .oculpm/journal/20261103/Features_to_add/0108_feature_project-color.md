---
schema_version: 1
type: feature
slug: "project-color"
status: done
difficulty: low
created_at: "2026-11-03T01:08:02+09:00"
session_id: "20261103-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "6fc3a353-b7f3-424c-8f8a-3203b542643e"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db/projects.rs"
    op: update
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/projects.ts"
    op: update
  - path: "src/features/shell/projectColor.ts"
    op: create
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/features/shell/TopBar.tsx"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/project_color.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "창"
  - "shell"
  - "window"
  - "mcp-tool"
---
[x] 창: 프로젝트마다 색을 지정한다

## 추가 기능
창 여럿을 띄워 프로젝트마다 에이전트를 돌리면 Alt+Tab 으로 어느 창인지 가리기 어렵다(사용자 요청 11-03). 프로젝트 ▾ 목록 아래에 「색」 줄(색 없음 + 8색)을 두고, 고른 색은 윗줄 위 3px 띠 · 프로젝트 이름 앞 점 · ⌘O 목록 각 줄의 점으로 보인다.

같은 날 사용자 결정: **11-30 기능 동결 폐지**(「그냥 그거 폐지해버려」).

## 동작 흐름
- 저장은 기존 `projects.color` 칸(migration 027, 읽기만 있고 쓰는 곳이 없었다)에 id 로. 새 명령 `set_project_color` 는 `PROJECT_COLORS` 밖 값을 거절한다.
- 색은 `tokens.css` 의 기존 `[data-pc]` 토큰이 테마별로 푼다(`projectColor.ts`).
- 목록을 열 때 프로젝트 목록을 다시 읽어 다른 창에서 바꾼 색이 따라온다.

## 검증
- pnpm typecheck / lint / build exit 0, pnpm test 1012 passed (새 `project_color.test.tsx` 2건)
- cargo test --lib 932 passed, clippy -D warnings 깨끗
- 실제 창 육안 확인은 아직(설치본이 돌아 dev 빌드 금지)