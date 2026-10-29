---
schema_version: 1
type: feature
slug: "notify-hook-outside-terminal-waiting"
status: done
difficulty: medium
created_at: "2026-10-29T23:45:29+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/hooks/hooks.json"
    op: update
  - path: "src-tauri/src/oculpm/claude_waiting.rs"
    op: create
  - path: "src-tauri/src/oculpm/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/hooks.rs"
    op: update
  - path: "src-tauri/src/commands/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src-tauri/tests/plugin_xplat.rs"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/features/today/todayModel.ts"
    op: update
  - path: "src/features/today/useTodayExceptions.ts"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/terminal/attention.ts"
    op: update
  - path: "src/windows/ProjectWindow.tsx"
    op: update
related:
  - ref: "20261029/Features_to_add/2152_feature_today-claude-waiting-alert.md"
    kind: "followup"
tags:
  - "hooks"
  - "today"
  - "ocul-next"
  - "mcp-tool"
---
[x] 바깥 터미널의 Claude 기다림을 안다 — Notification 훅 → 오늘 · OS 알림

## 추가 기능

앱 안 터미널의 기다림은 OSC 7501 로 이미 알았다. 이번에는 사람이 자기 터미널에서 돌리는 Claude 도 안다.

- **플러그인 훅** — `plugin/oculpm/hooks/hooks.json` 에 `Notification` 과 `UserPromptSubmit` 싱크를 더했다. 같은 인박스 한 줄이고, 추적 가드 · stdin 소비 · 개행 · `oculpm_ts` 를 그대로 쓰며 네트워크는 없다. 둘은 Claude 전용 이벤트로 두어 Codex 판에는 넣지 않았다. 모르는 키가 있으면 Codex 가 훅 설정을 통째로 거부할 수 있어서다. `plugin_xplat` 의 `CLAUDE_ONLY_EVENTS` 에 적었다.
- **워처** — `oculpm/claude_waiting.rs`(새 모듈, `claude_hooks.rs` 가 800줄을 넘지 않게 뗐다).
  - `permission_prompt` 는 「허락」, `idle_prompt` 는 「입력」 기다림으로 세션별로 든다. 다른 알림(auth_success 등)은 기다림이 아니다.
  - 같은 세션의 `UserPromptSubmit` · `Stop` · `StopFailure` · `SessionEnd` · `SessionStart` 에 지운다.
  - 읽을 때 30분 지난 것은 지운다. 터미널을 그냥 닫아 끝을 못 알린 세션이 남지 않게 하려는 것이다.
  - 바뀌면 `ClaudeWaitingChanged` 를 보낸다. 명령은 `claude_waiting`, `claude_waiting_dismiss` 둘이다.
- **오늘** — 「먼저 볼 것」에 「Claude 가 기다려요」 줄이 선다.
  - 제목은 Claude 의 한 줄이다(예: 「Claude needs your permission to use Bash」). 끝에 「바깥 터미널 · 언제부터」가 붙는다.
  - 바깥 터미널이라 앱 안에서 갈 곳이 없으므로, 기본 동작은 「알았어요」(지운다)다.
  - 앱 안 세션이 이미 기다림(OSC 7501)이면 눌러서 그 세션으로 가는 줄만 남긴다. 같은 claude 를 두 번 말하지 않기 위해서다.
- **OS 알림** — 프로젝트 창마다 하나, 창이 뒤에 있을 때 처음 보는 기다림만 알린다. 같은 세션 · 같은 시작 시각이면 한 번이다. 앱을 켜기 전부터 있던 것은 알리지 않는다.

## 남은 것

- 앱 설정 토글로 `.claude/settings.local.json` 에 까는 옛 훅 경로(`HOOK_EVENTS` 3종)에는 넣지 않았다. 플러그인이 기본 경로다.
- 플러그인 판은 앱 판과 함께 올라간다(다음 릴리스). 실제 Claude 에서 Notification 페이로드가 오는지는 설치본에서 확인한다(#eyes-installed).
- 허락 기다림은 사람이 바깥 터미널에서 허락해도 그 턴이 끝날 때(Stop)까지 남을 수 있다. PostToolUse 는 이벤트가 너무 많아 구독하지 않는다.

## 검증

- Rust `notification_waits_until_the_same_session_moves_on` 은 다음을 본다: 허락 · 입력 기다림을 든다, 같은 것이 다시 오면 바뀐 것 없음, 다른 알림은 무시, 다른 세션의 Stop 은 지우지 않음, 입력 · 세션 끝에 지운다, 훅 시각이 없으면 받은 시각을 쓴다.
- `plugin_manifest`(이벤트 7종 · 싱크 5종 계약)와 `plugin_xplat`(Codex 판 일치)를 바꿨다. `cargo fmt --check && cargo clippy -D warnings && cargo test --locked` → 1148 passed.
- `today_v4` 에 훅 기다림 줄 · 「알았어요」 · 앱 안 기다림 우선을, `terminal_attention` 에 처음 보는 기다림만 알리는 것을 더했다. `pnpm test` → 941 passed, lint · build exit 0.