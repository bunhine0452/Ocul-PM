---
schema_version: 1
type: feature
slug: "today-auto-mode-blocked"
status: done
difficulty: high
created_at: "2026-11-22T03:41:50+09:00"
session_id: "20261122-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "fe824e5d-958c-4ffc-9c86-900de7c6682a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/claude_blocked.rs"
    op: create
  - path: "src-tauri/src/oculpm/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/hooks.rs"
    op: update
  - path: "src-tauri/src/commands/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "plugin/oculpm/hooks/hooks.json"
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
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
  - path: "src/__tests__/todayFixture.ts"
    op: update
  - path: "docs/PROMISE.md"
    op: update
related: []
tags:
  - "오늘"
  - "자동-모드"
  - "플러그인"
  - "mcp-tool"
---
[x] 오늘: 자동 모드가 막은 행동이 선다

## 추가 기능

Claude Code 의 자동 모드에서는 명령마다 사람에게 묻지 않고 분류기가 위험해 보이는 행동을 막는다. 그때 Claude 는 멈추지 않으므로 「기다림」 으로는 서지 않았고, 막힌 일은 어느 줄에도 없었다. 이제 오늘 화면 「먼저 볼 것」 에 「자동 모드가 행동 N건을 막았어요」 한 줄이 선다 — 가장 최근 것(도구 · 한 줄)과 시각, 나머지는 수, 전문은 툴팁. 「알았어요」 로 함께 지운다. 30건이 막혀도 한 줄이다.

## 동작 흐름

- 플러그인 `hooks.json` 에 `PermissionDenied` 싱크를 더했다(Claude 전용 이벤트 — 자동 모드의 분류기가 막았을 때만 온다, 훅 문서 확인). 적기만 한다: 분류기의 결정을 뒤집는 출력(`retry`)은 내지 않는다.
- `oculpm/claude_blocked.rs` 가 인박스의 그 이벤트를 프로젝트별로 든다. 드는 것은 도구 이름 · **한 줄**(Bash 명령의 첫 줄 · 파일 도구의 경로 · 웹 도구의 주소) · 분류기의 이유 · 시각뿐이다 — Write 의 내용 같은 인자 전체는 들지 않는다. 한 줄은 비밀 가리기(`redact`, 프로젝트 패턴 포함)를 지나고 제어 · 방향 뒤집기 · 폭 없는 글자를 걷은 뒤 160자에서 잘린다. 같은 세션의 같은 행동이 다시 막히면 한 건이고, 프로젝트당 30건 · 12시간까지 든다. 앱 프로세스 안에만 산다(기다림과 같다).
- 명령 `claude_blocked` · `claude_blocked_dismiss` 와 이벤트 `ClaudeBlockedChanged`. 오늘의 저장소가 그 이벤트에 다시 읽고, 예외 종류 `autoBlocked` 가 판정(실패 · 바뀜 · 다른 기기) 다음 · 일지 없는 변경 앞에 선다.
- `docs/PROMISE.md` 약속 4 의 예외 목록에 한 낱말을 더하고 지키는 테스트를 적었다.

## 검증

- `cargo test --locked`: 35개 스위트 전부 `test result: ok` · 합계 1248 passed · 0 failed (`claude_blocked` 6건 포함)
- `vitest run src/__tests__/today_v4.test.tsx`: `Tests  24 passed (24)`
- `pnpm lint`(pnpm 10.34.9): 여섯 게이트 exit 0
- `cargo clippy --locked --all-targets -- -D warnings`: 경고 없이 `Finished`

## 메모

실제 자동 모드 세션에서 `PermissionDenied` 가 인박스에 떨어지는 것은 보지 못했다 — payload 필드(`tool_name` · `tool_input` · `reason`)는 훅 문서에서 확인했고, 설치본에서 한 번 보는 것이 `#eyes` 에 남는다. VS Code 확장은 이 줄을 보여 주지 않는다.