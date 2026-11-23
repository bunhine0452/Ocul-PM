---
schema_version: 1
type: bug
slug: "first-run-honest-empty"
status: done
difficulty: high
created_at: "2026-11-23T21:23:32+09:00"
session_id: "20261123-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "9db3a5f7-812f-4644-aa3a-8b45252c03a5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/PROMISE.md"
    op: update
  - path: "docs/launch/agent-report-card.py"
    op: update
  - path: "extension/src/model/evidence.ts"
    op: update
  - path: "src-tauri/src/commands/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/git/mod.rs"
    op: update
  - path: "src-tauri/src/git/receipt_cases.json"
    op: update
  - path: "src-tauri/src/git/repo_status_tests.rs"
    op: create
  - path: "src-tauri/src/git/status.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/oculpm/agent_link.rs"
    op: create
  - path: "src-tauri/src/oculpm/agent_link_tests.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/evidence_regrade_tests.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/write.rs"
    op: update
  - path: "src-tauri/src/oculpm/evidence.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/terminal_env.rs"
    op: update
  - path: "src-tauri/src/terminal_launch_tests.rs"
    op: update
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: "src/__tests__/diff_no_repo.test.tsx"
    op: create
  - path: "src/__tests__/first_run_link_health.test.tsx"
    op: create
  - path: "src/__tests__/terminal_launch_locale.test.ts"
    op: create
  - path: "src/__tests__/today_init_receipt.test.tsx"
    op: create
  - path: "src/__tests__/watcher_offline_cause.test.ts"
    op: create
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/diff/NoRepoState.tsx"
    op: create
  - path: "src/features/diff/useDiffChanges.ts"
    op: update
  - path: "src/features/oculpm/watcherCause.ts"
    op: create
  - path: "src/features/oculpm/watcherToast.ts"
    op: create
  - path: "src/features/settings/JournalHealth.tsx"
    op: create
  - path: "src/features/settings/prefs.css"
    op: update
  - path: "src/features/start/ClaudeUnseen.tsx"
    op: create
  - path: "src/features/start/StartWindow.tsx"
    op: update
  - path: "src/features/start/start.css"
    op: update
  - path: "src/features/terminal/claudeWorked.ts"
    op: create
  - path: "src/features/terminal/launchCheck.ts"
    op: update
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/today/InitReceipt.tsx"
    op: create
  - path: "src/windows/ProjectWindow.tsx"
    op: update
related:
  - ref: "20261115/Bugs/1134_bug_launch-line-ctrl-c-hidden-chars.md"
    kind: "followup"
tags:
  - "첫-실행"
  - "love-round"
  - "first-run"
  - "mcp-tool"
---
[x] 첫 실행: 볼 수 없는 것을 없음이라 안 한다

## 발생 원인
처음 온 개발자의 첫 10분에서, 앱이 볼 수 없는 것을 「없음」 으로 말했다. git 저장소가 아니거나 git 이 없어도 변경 화면은 「변경이 없어요」, 실시간 갱신이 꺼진 이유는 원인과 상관없이 늘 「다른 창이 감시 중」, claude 를 못 찾은 감지는 영어 셸 메시지에만 걸렸고, 첫 활성화가 폴더에 쓴 것을 알리는 카드는 화면에 닿지 않았다. 「설치본에서 눈으로 보지는 않았다」 고 스스로 적은 검증도 「✓ 명령 있음」 이 됐다.

## 해결 방법
- 변경 화면: 저장소 아님 → git init 복사, git 없음 → 설치 안내(NoRepoState). 워처 토스트는 잠금 · 감시 한도 · 권한 · 폴더 없음별 문장(watcherCause).
- claude 실행 실패를 종료 코드 127 표지로 셸 언어와 무관하게 알아보고 설치 줄을 건넨다. 시작 창은 Claude Code 흔적이 없으면 말한다(agent_link).
- 오늘 「첫 기록까지」 바닥에 첫 활성화 영수증(InitReceipt), 설정에 「일지가 안 와요」 진단 줄(JournalHealth — 새 화면 아님).
- `receipt_cases.json` 에 자기 미검증 문장 사례를 더해 Rust · TS · 확장이 함께 문다.

## 검증
vitest `first_run_link_health` · `terminal_launch_locale` · `watcher_offline_cause` · `diff_no_repo` · `settings_status` 51 passed. PR #177 CI Rust 통과(c538bf7e) — 원장 두 곳은 합류에서 고쳤다(git-scm.com · claude.ai 줄, 기동 자리).