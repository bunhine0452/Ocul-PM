---
schema_version: 1
type: feature
slug: "today-claude-waiting-alert"
status: done
difficulty: medium
created_at: "2026-10-29T21:52:59+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/attention.ts"
    op: create
  - path: "src/features/terminal/focusRequest.ts"
    op: create
  - path: "src/features/terminal/status.ts"
    op: update
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/today/todayModel.ts"
    op: update
  - path: "src/features/today/useTodayExceptions.ts"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/windows/ProjectWindow.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/capabilities/default.json"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
  - path: "src/__tests__/terminal_attention.test.ts"
    op: create
  - path: "src/__tests__/terminal_screen.test.tsx"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - ref: "20261029/Features_to_add/2131_feature_terminal-program-status-close-guard.md"
    kind: "followup"
tags:
  - "terminal"
  - "today"
  - "ocul-next"
  - "mcp-tool"
---
[x] 「Claude 가 기다려요」 — 오늘 맨 위 한 줄과, 창이 뒤에 있을 때만 OS 알림

## 추가 기능

- **오늘 「먼저 볼 것」의 맨 위 줄** — 예외 종류 `waiting` 을 더했고 심각도는 맨 위다(지금 멈춰 있는 일이라서). 이 창의 세션 가운데 살아 있고 상태가 `blocked` 인 것마다 한 줄씩 선다. 제목은 프로그램이 붙인 한 줄(「approve Write: …」)이고, 없으면 상태 말(허락을 / 답을 / 로그인을 기다려요)을 쓴다. 딱지는 「Claude 가 기다려요」. 기본 동작 「터미널에서 보기」는 터미널 탭으로 가서 그 세션을 고른다. 윗줄 오늘 배지도 이 줄을 센다(`first` 에 들어간다).
- **그 세션으로 가기** — `features/terminal/focusRequest.ts`. 터미널 화면은 늦게 실리는 덩어리라, 요청 id 를 받아 두었다가 화면이 설 때 꺼낸다. 화면이 이미 서 있으면 사건으로 바로 받는다. xterm 을 들이지 않는다.
- **OS 알림** — `features/terminal/attention.ts`. 상태가 기다림으로 **막 들어섰고**, 그 창이 앞에 없을 때(`document.hasFocus()` 가 거짓)만 울린다. 앞에 있으면 화면 표시로 충분하다(Orca 의 알림 규칙). 제목은 「{프로젝트} · Claude 가 기다려요」, 본문은 「세션 이름 · 그 한 줄」이다. 권한은 처음 울릴 때 한 번 묻는다. 같은 기다림에서 한 줄만 바뀌면 다시 울리지 않는다.
- **의존성** — `tauri-plugin-notification` 2.8 · `@tauri-apps/plugin-notification` 2.8 · capability `notification:default`. 알림은 macOS 알림 센터 · Windows 토스트 · D-Bus 로만 가고 기기 밖으로는 나가지 않는다.

## 동작 흐름

PTY → OSC 7501 blocked → (백엔드) 세션 표 · `TermSessionsChanged` → ① 오늘이 `term_list` 를 다시 읽어 줄을 세운다. ② 그 창의 termStore 가 `status` 사건을 받아 알림감인지 가린다.

## 남은 것

- 바깥 터미널 세션의 기다림은 아직 모른다 — 플러그인 Notification 훅(#notify-hook).
- 프로젝트마다 읽지 않음 표시(#orca-attention 의 뒷절반).

## 검증

- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 파일 73개 · 테스트 900개 통과, lint · build exit 0.
- `cargo fmt --check && cargo clippy -D warnings && cargo test --locked && cargo deny check licenses bans sources` → exit 0, 1146 passed, 「bans ok, licenses ok, sources ok」.