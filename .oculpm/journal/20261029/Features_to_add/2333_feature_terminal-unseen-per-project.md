---
schema_version: 1
type: feature
slug: "terminal-unseen-per-project"
status: done
difficulty: low
created_at: "2026-10-29T23:33:51+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/commands/window/lifecycle.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/terminal/status.ts"
    op: update
  - path: "src/features/terminal/TermsChip.tsx"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_close_guard.test.tsx"
    op: update
related:
  - ref: "20261029/Features_to_add/2152_feature_today-claude-waiting-alert.md"
    kind: "followup"
tags:
  - "terminal"
  - "ocul-next"
  - "mcp-tool"
---
[x] 프로젝트마다 읽지 않음 — 창이 뒤에 있는 동안 Claude 가 끝내면 「새 소식」

## 추가 기능

Orca 의 알림 규칙(agent-attention-policy) 뒷절반이다. 앞절반(창이 앞에 있으면 알림 대신 표시만)은 「Claude 가 기다려요」 때 들어갔다.

- **백엔드**
  - `TermSessions` 가 읽지 않은 소식이 있는 창 라벨을 들고 있고, 목록을 줄 때 `TermInfo.unseen` 으로 싣는다.
  - `term_open` 의 사건 손잡이: 상태가 기다림 · 끝냄 · 오류로 바뀌었는데 그 창이 앞에 없으면(`is_focused` 거짓) 그 창에 단다.
  - 창 훅의 `Focused(true)`: 그 창의 소식을 지우고, 지운 게 있었으면 `TermSessionsChanged` 로 다른 창의 목록이 다시 세게 한다.
  - 창을 닫으면 그 창의 소식도 없앤다.
- **프런트**
  - `countByProject` 가 `unseen` 을 센다. 빈 셸이 됐어도(claude 가 끝내고 나감) 소식은 남는다.
  - `TermsChip` 의 우선순위: 「내 차례」(기다림, 정한 대로 중립 딱지) → 「새 소식」(파란 점 + 딱지, 툴팁 「그 창을 열면 사라져요」) → 「실행 중 N」.

## 검증

- Rust `unseen_news_is_per_window_and_clears_once_when_the_window_comes_to_front`: 창마다 한 번 지우고, 닫으면 없다. `cargo clippy -D warnings && cargo test --locked` → exit 0, 1147 passed.
- `terminal_close_guard.test.tsx` 에 「읽지 않은 소식은 claude 가 끝나고 나가도 남는다」를 더했다. `pnpm test` → 939 passed, lint · build exit 0.