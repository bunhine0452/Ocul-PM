---
schema_version: 1
type: bug
slug: "cmd-w-closes-terminal-first"
status: done
difficulty: low
created_at: "2026-11-03T01:13:43+09:00"
session_id: "20261103-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "6fc3a353-b7f3-424c-8f8a-3203b542643e"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/menu.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/window.ts"
    op: update
  - path: "src/hooks/useWindowKeys.ts"
    op: update
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/__tests__/close_key.test.tsx"
    op: create
  - path: "src/__tests__/app_window.test.tsx"
    op: update
related:
  - ref: "20261031/Bugs/0206_bug_terminal-file-ref-menu-back.md"
    kind: "followup"
tags:
  - "터미널"
  - "terminal"
  - "window"
  - "mcp-tool"
---
[x] 터미널: ⌘W 가 세션부터 닫는다

## 발생 원인
macOS 앱 메뉴의 ⌘W 액셀러레이터가 웹뷰보다 먼저 키를 먹고 `menu.rs` 에서 곧장 `w.close()` 했다. 터미널 세션이 여럿이어도 창째 닫혔다(사용자 지적 11-03).

## 해결 방법
- 메뉴는 창을 닫지 않고 포커스된 창에 `CloseKeyPressed` 를 보낸다. 보내기가 실패하면 예전처럼 창을 닫는다(⌘W 가 죽지 않게).
- 프런트 `useWindowKeys` 가 macOS 에서 그 이벤트를, 그 밖 OS 는 키다운을 `closeByKey` 로 받는다.
- 터미널 화면이 서 있는 동안 `interceptCloseKey` 를 건다. 세션이 둘 이상이면 고른 세션만 닫고, 하나 남으면 창을 닫는다(돌고 있으면 기존 창 닫기 확인이 묻는다).

## 검증
- pnpm test 1015 passed(새 `close_key.test.tsx` 3건, today_v4 한 건은 부하 중 1회 흔들림 → 단독·재실행 통과), typecheck/lint/build 0
- cargo test --lib 932 passed, clippy -D warnings 깨끗
- 설치본 육안 확인은 아직