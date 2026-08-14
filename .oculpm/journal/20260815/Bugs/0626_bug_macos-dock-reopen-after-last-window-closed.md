---
schema_version: 1
type: bug
slug: "macos-dock-reopen-after-last-window-closed"
status: done
difficulty: low
created_at: "2026-08-15T06:26:36+09:00"
session_id: "mcp-20260815-062636"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/lib.rs"
    op: update
related: []
tags:
  - "window"
  - "macos"
  - "bug"
  - "mcp-tool"
---
[x] ⌘W 로 마지막 창을 닫으면 Dock 을 눌러도 안 열리던 것

## 앱은 살아 있는데 들어갈 문이 없었다

⌘W 로 마지막 탭을 닫으면 창이 닫힌다. 앱은 그대로 살아 있다 — 트레이·메뉴바가 있어서 종료하지 않는 것이 맞다. 그런데 그 상태에서 **Dock 아이콘을 눌러도 아무 일도 안 났다.** 사용자 눈에는 앱이 죽은 것이고, 메뉴바로 들어가는 길 하나만 남는다.

macOS 는 이때 앱에게 "다시 열어 달라"고 말한다(`applicationShouldHandleReopen`). Tauri 는 그것을 `RunEvent::Reopen` 으로 준다. 우리는 `ExitRequested` 만 보고 있어서 그 말을 흘리고 있었다.

받아서 표준 동작을 한다.

- 창이 하나라도 살아 있으면 **앞으로 가져오기만** 한다(최소화돼 있으면 풀어 준다).
- 하나도 없으면 새로 연다.

`is_app_window` 로 거른다 — 트레이 팝오버는 창 수에 넣으면 안 된다. 그것이 떠 있다고 "창이 있다"고 판단하면 Dock 을 눌러도 아무 것도 안 열린다.

## 검증

typecheck 0 · 프런트 835 · lint 0 · build 0 · 백엔드 전 스위트.

**미확인**: 실제 Dock 클릭은 패키징된 앱에서 눌러 봐야 안다 — `dev` 실행은 Dock 아이콘이 다르게 동작한다.