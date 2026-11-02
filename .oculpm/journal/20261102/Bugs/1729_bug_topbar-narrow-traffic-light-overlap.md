---
schema_version: 1
type: bug
slug: "topbar-narrow-traffic-light-overlap"
status: done
difficulty: low
created_at: "2026-11-02T17:29:40+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/shell.css"
    op: update
related:
  - ref: "20261031/Bugs/0017_bug_narrow-topbar-actions-menu.md"
    kind: "followup"
tags:
  - "윗줄"
  - "topbar"
  - "macos"
  - "mcp-tool"
---
[x] 윗줄: 좁은 창에서 이름이 신호등에 붙었다

## 발생 원인
640px 이하 창에서는 `.is-mac .topbar` 의 왼쪽 여백이 84px 에서 76px 로 줄었다. 그런데 macOS 27 신호등은 더 커서 초록 단추의 오른쪽 끝이 약 75px 이다. 그래서 프로젝트 이름 「Ocul-PM」이 초록 단추에 붙어 겹쳐 보였다(사용자 스크린숏 제보).

## 해결 방법
- 신호등 자리 84px 는 어느 폭에서나 줄이지 않는다. 76px 덮어쓰기를 지웠다.
- 늘어난 8px 은 이름 칸에서 덜어 낸다. 640px 이하에서 `.proj-switch-wrap` 은 `flex-shrink: 1; min-width: 56px; max-width: 104px` 이다. 전에는 줄지 않게(shrink 0) 막혀 있어서, 461px 창에서 3px 넘쳤다.
- 460px 이하에서는 오른쪽 여백을 `--space-1` 로 줄였다.

## 검증
- TopBar 를 하네스(Vite + CDP)에 띄워 폭 641 · 640 · 500 · 461 · 460 · 384 에서 쟀다. 이름은 모든 폭에서 84px 에서 시작했다. 넘침은 고치기 전 461 에서 +3px, 고친 뒤 0 이다.
- typecheck 0 · test 991 passed · lint 0 · build 0.