---
schema_version: 1
type: bug
slug: "update-waits-for-terminal-resumes-claude"
status: done
difficulty: medium
created_at: "2026-10-31T01:56:46+09:00"
session_id: "20261031-001"
agent:
  id: "claude-code"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/terminal_tests.rs"
    op: create
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/commands/window/session.rs"
    op: update
  - path: "src/lib/updater.ts"
    op: update
  - path: "src/features/terminal/resumeAfterUpdate.ts"
    op: create
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/features/settings/DataSection.tsx"
    op: update
related:
  - ref: "20261024/Bugs/1047_bug_ptyhost-stale-exe-tcc-bundle-clone.md"
    kind: "followup"
tags:
  - "update"
  - "terminal"
  - "mcp-tool"
---
[x] 업데이트: 터미널을 묻고 claude 를 잇는다

## 발생 원인
사용자 제보: 업데이트하면 터미널의 에이전트 세션이 끊긴다. 원인은 둘이다.
- **설계:** 4.0 터미널의 세션은 앱 프로세스 안에 산다. PTY 호스트는 10-28 에 걷었다(옛 판 호스트의 TCC 상실 · 소켓 결함). 그래서 업데이트 재시작이 세션을 끝낸다.
- **결함:** 업데이트는 재시작 전에 `busyGuard` 에 「끊으면 안 되는 일」 을 묻는다. 그런데 거기 등록하던 것은 3.x ACP 채팅뿐이었고, b00a0bb7 에서 ACP 와 함께 사라졌다. 10-29 에 돌아온 터미널은 등록하지 않았다. 그래서 창 닫기 · ⌘Q 는 묻는데 업데이트만 묻지 않고 끊었다. `relaunch()` 는 종료 코드가 있어 `ExitRequested` 의 묻기도 지나간다.

## 해결 방법
사용자 결정(10-31): 「묻기 + 다시 뜨면 claude 이어가기」.
- **묻기:** 백엔드 `TermSessions::busy_all()` 이 모든 창의 세션을 센다(`term_busy_all`, 창 닫기 확인과 같은 기준). 업데이트는 깐 뒤 무언가 돌면 `awaiting` 으로 기다린다(「터미널 세션 N개가 실행 중이에요」). 터미널 사건과 10초 재확인으로, 다 끝나면 저절로 재시작한다. 설정 › 데이터에도 사유와 「지금 재시작」 을 띄운다(배너만 있던 것).
- **잇기:** 재시작 직전 `save_window_session` 이 창마다 claude 가 돌던 세션(프로젝트 · 레인)을 `SessionWindow.resume` 에 싣는다. 복원은 창보다 먼저 `set_pending_resume` 으로 맡기고, 다시 뜬 창(ShellV2)이 `term_take_resume` 으로 한 번 가져가 `claude --continue` 세션을 연다. 터미널 화면으로 가서 토스트를 띄운다.
- `term_open` 에 `resume` 을 더하면서 specta 인자 상한(10)에 걸려 `app` 인자를 창에서 꺼내 쓰게 했다. terminal.rs 가 800줄을 넘어 테스트를 `terminal_tests.rs` 로 옮기고 기동 원장을 맞췄다.
- 한계: 업데이트를 실행하는 것은 깔려 있던 판이라 이 고침은 이 판 **다음** 업데이트부터 듣는다. Windows 는 설치 파일이 곧 앱을 끝내 묻지 못하고 잇기만 된다. 한 폴더에 claude 가 둘이면 둘 다 가장 최근 대화를 연다.

## 검증
- `pnpm typecheck && pnpm test && pnpm lint && pnpm build && cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings && cargo fmt --check` → exit 0, Tests 977 passed, rust passed 1170 failed 0
- 새 테스트: `a_resumed_session_types_claude_continue` · `busy_all_counts_every_window_and_only_claude_sessions_are_resumable` · `claude_sessions_resume_only_in_a_window_that_returns_to_their_project` · `update_terminal_wait.test.tsx` 4건