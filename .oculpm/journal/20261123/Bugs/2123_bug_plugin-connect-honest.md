---
schema_version: 1
type: bug
slug: "plugin-connect-honest"
status: done
difficulty: high
created_at: "2026-11-23T21:23:13+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "README.en.md"
    op: update
  - path: "README.md"
    op: update
  - path: "plugin/oculpm-codex/bin/oculpm-mcp"
    op: update
  - path: "plugin/oculpm/bin/oculpm-mcp"
    op: update
  - path: "src-tauri/src/commands/claude_plugin/mod.rs"
    op: create
  - path: "src-tauri/src/commands/claude_plugin/reach.rs"
    op: create
  - path: "src-tauri/src/commands/claude_plugin/registry.rs"
    op: create
  - path: "src-tauri/src/commands/claude_plugin/tests.rs"
    op: create
  - path: "src-tauri/src/commands/mcp.rs"
    op: update
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src/__tests__/plugin_connect_settings_planner.test.tsx"
    op: create
  - path: "src/__tests__/plugin_connect_today.test.tsx"
    op: create
  - path: "src/__tests__/todayFixture.ts"
    op: update
  - path: "src/__tests__/today_narrow_empty.test.tsx"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/planner/planner.css"
    op: update
  - path: "src/features/settings/AgentsSection.tsx"
    op: update
  - path: "src/features/settings/ClaudePluginRow.tsx"
    op: create
  - path: "src/features/today/FirstSteps.tsx"
    op: create
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/TodaySide.tsx"
    op: update
  - path: "src/features/today/today.css"
    op: update
  - path: "src/features/today/todayModel.ts"
    op: update
  - path: "src/features/today/useTodayExceptions.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/lib/agentCommands.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/lib/pluginConnection.ts"
    op: create
related:
  - ref: "20261122/Bugs/0419_bug_today-new-rows-seen-and-polished.md"
    kind: "followup"
tags:
  - "플러그인"
  - "love-round"
  - "first-run"
  - "mcp-tool"
---
[x] 플러그인: 켜진 설치만 연결됨으로 본다

## 발생 원인
`claude_plugin_status` 는 마켓플레이스만 추가했거나 다른 프로젝트에만 깐 경우에도 「연결됨」 이라고 했고, 오늘 화면은 플러그인 상태를 창이 열릴 때 한 번만 읽었다. 처음 온 개발자가 깔고 와도 첫 걸음이 그대로였고, 반대로 안 깔렸는데 끝난 것처럼 보였다.

## 해결 방법
- 상태를 `connected · marketplaceOnly · otherProject · disabled · windowsOld · notInstalled · unreachable` 로 나누고(commands/claude_plugin/), 저마다 다른 문장과 복사할 명령 한 줄을 그 자리에 둔다(오늘 첫 걸음 · 설정 ClaudePluginRow · 계획 빈 화면).
- 오늘은 창 포커스 · 화면 재진입 · 「다시 시도」 에 다시 읽는다. 플러그인이 앱보다 새 판, 다른 프로젝트 N곳 옛 판, 앱이 응용 프로그램 폴더 밖(셔틀이 못 찾음)을 사람 말로 짚는다.
- 플러그인 명령 표기를 셸 `claude plugin …` 한 모양으로. 셔틀 후보를 실제 productName `Ocul-PM.app` 으로.

## 검증
vitest `plugin_connect_today` · `plugin_connect_settings_planner` · `today_v4` 50 passed(고침 없이는 새 사례가 빨갛다는 것을 리뷰어가 확인). PR #177 CI 프런트 · Rust 통과(c538bf7e).