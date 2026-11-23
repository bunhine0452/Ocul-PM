---
schema_version: 1
type: feature
slug: "keep-awake-sessions"
status: done
difficulty: high
created_at: "2026-11-23T21:24:10+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/src/commands/config.rs"
    op: update
  - path: "src-tauri/src/git/mod.rs"
    op: update
  - path: "src-tauri/src/git/race.rs"
    op: update
  - path: "src-tauri/src/git/race_include.rs"
    op: create
  - path: "src-tauri/src/git/race_include_tests.rs"
    op: create
  - path: "src-tauri/src/keep_awake.rs"
    op: create
  - path: "src-tauri/src/keep_awake_tests.rs"
    op: create
  - path: "src-tauri/src/terminal_tests.rs"
    op: update
  - path: "src/__tests__/settings_keep_awake.test.tsx"
    op: create
  - path: "src/__tests__/terminal_band_pill.test.ts"
    op: create
  - path: "src/__tests__/terminal_close_target.test.ts"
    op: create
  - path: "src/__tests__/terminal_race_include.test.tsx"
    op: create
  - path: "src/__tests__/today_dead_claude.test.ts"
    op: create
  - path: "src/features/settings/DataSection.tsx"
    op: update
  - path: "src/features/settings/KeepAwakeRow.tsx"
    op: create
  - path: "src/features/terminal/RacePanel.tsx"
    op: update
  - path: "src/features/terminal/StatusBand.tsx"
    op: update
  - path: "src/features/terminal/race.ts"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
related: []
tags:
  - "세션"
  - "터미널"
  - "love-round"
  - "settings"
  - "mcp-tool"
---
[x] 세션: 잠자기 막기와 죽은 칸 거르기

## 추가 기능
- **잠자기 막기**(사용자 결정 11-23 — 설정에서 켜고 끄는 스위치, 기본 꺼짐): 설정 · 앱 칸 KeepAwakeRow. 켜면 일하는 Claude 세션이 하나 이상일 때만 프로세스 안 OS 단언(macOS IOPMAssertionCreateWithName · Windows SetThreadExecutionState)을 잡고, 0 이 되거나 앱을 끄면 바로 푼다. 새 자식 프로세스 없음(keep_awake.rs). Linux 는 안내만.
- 오늘의 「Claude 가 기다려요」 줄에서 claude 가 죽고 셸만 남은 칸을 거른다(이월 #today-crashed-claude).
- 터미널 탭 닫기 × 표적 24px(창 번호와 겹치지 않게), 상태 띠는 오른쪽 위 알약이라 전체 화면 TUI 윗줄을 덮지 않는다.
- 나란히 돌리기 레인에 `.worktreeinclude` 의 git 무시 파일(.env 등)을 복사(루트 밖 · 심볼릭 링크 · 파일당 1MB · 총 20MB 넘으면 건너뜀, 이름만 토스트).

## 동작 흐름
켜짐/꺼짐 판정은 순수 함수(working 세션 수 · 설정)로 빼서 시험했고, 설정 저장은 settings_* 백엔드 명령이 바뀔 때 on_setting 을 부른다. 설정에 터미널 칸이 없어 앱 칸에 두었다.

## 검증
vitest 레인 7파일 48 passed + 영향 범위 31파일 209 passed. CI Rust(macOS) 의 `keep_awake::tests::macos_assertion_is_created_and_released_in_process ... ok`. Windows 분기 컴파일은 portability 몫.