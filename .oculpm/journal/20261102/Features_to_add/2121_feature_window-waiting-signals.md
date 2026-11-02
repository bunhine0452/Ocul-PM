---
schema_version: 1
type: feature
slug: "window-waiting-signals"
status: done
difficulty: medium
created_at: "2026-11-02T21:21:39+09:00"
session_id: "20261102-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "2e16d24e-1a21-4384-b5ea-51a94216db8a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/window/attention.rs"
    op: create
  - path: "src-tauri/src/commands/window/mod.rs"
    op: update
  - path: "src-tauri/src/commands/window/focus.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/window.ts"
    op: update
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/features/shell/projectKeys.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/project_attention.test.tsx"
    op: create
  - path: "src/__tests__/project_keys.test.tsx"
    op: update
  - path: "src/__tests__/shell_v4.test.tsx"
    op: update
related: []
tags:
  - "창"
  - "기다림"
  - "mcp-tool"
---
[x] 창: 기다리는 프로젝트 창을 짚는다

## 추가 기능
프로젝트 창을 여럿 띄워 두면 Claude 가 어느 창에서 기다리는지 하나씩 눌러 봐야 알았다. 기능 동결 중 사용자 예외 둘째(11-02, 「기다림 신호 묶음」). 새 화면은 없고 이미 있는 자리 셋에 같은 수를 싣는다.
- 창 제목 `ai-pm · 기다림 1` (영어 `· 1 waiting`) — macOS 창 메뉴 · Mission Control · ⌘` 에 보인다.
- Dock 배지 — 열린 창 기다림의 합, 0 이면 지운다(`set_badge_count`).
- ⌘O 목록: 기다림이 있는 프로젝트가 위, 그다음 마지막 확인 명령이 실패한 프로젝트. 줄마다 「기다림 N」 · 「확인 실패」 딱지. ⌥⌘ 번호도 같은 순서라 ⌥⌘1 = 기다리는 창.

## 동작 흐름
- `commands/window/attention.rs`: 기다림 = 플러그인 Notification 훅이 든 세션(30분 넘은 것 제외, `claude_waiting` 과 같은 기준) + 답을 기다리는 `ask_user` 질문. 실패 = 오늘 화면이 쓰는 `planner::digest` 의 마지막 판정 ✗.
- 내는 쪽은 고치지 않았다. 이미 나가는 이벤트 셋(`ClaudeWaitingChanged` · `ClaudeQuestionsChanged` · `ProjectWindowsChanged`)을 Rust 에서 `listen_any` 로 한 번 더 듣고 제목 · 배지를 맞춘 뒤 `ProjectAttentionChanged` 를 낸다. 제목 언어는 `apply_menu_language` 가 정한다.
- 커맨드 `project_attention(ids)` — ⌘O 목록이 열릴 때와 바뀔 때 읽는다. 창이 없는 프로젝트의 기다림은 0(감시기가 안 돈다).
- 앱 안 터미널의 「내 차례」(TermsChip)와 겹치지 않게 둘 중 큰 수 하나만 「기다림 N」 으로.

## 검증
- `pnpm typecheck` 0 · `pnpm vitest run` Tests 1008 passed (새 `project_attention.test.tsx` 3 — 정렬 · ⌥⌘1 · 딱지) · `pnpm lint` 0 (기존 경고 1) · `pnpm build` ✓ built
- `cargo test --no-fail-fast` 전 스위트 통과(lib 928 passed, `attention::tests` 포함) · clippy -D warnings 0 · fmt --check 0
- 실기기 미확인: 창 제목 · Dock 배지는 dev 앱에서 훅 이벤트를 넣어 봐야 보이는데, 가짜 이벤트가 이 저장소의 훅 인박스(「일지 없이 끝난 세션」의 원천)를 더럽혀 하지 않았다. 사용자 확인 몫.