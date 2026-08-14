---
schema_version: 1
type: bug
slug: "collapsed-sidebar-toolbar-traffic-light-inset"
status: done
difficulty: low
created_at: "2026-08-15T04:12:30+09:00"
session_id: "mcp-20260815-041230"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/shell.css"
    op: update
related: []
tags:
  - "ui"
  - "bug"
  - "css"
  - "window"
  - "mcp-tool"
---
[x] 사이드바를 접으면 툴바 왼쪽에 84px 빈 칸 — 크롬식 탭 이후 남은 신호등 인셋

## 남은 인셋

사이드바를 접으면 툴바(=Claude Code 의 세션 탭 줄) 왼쪽에 빈 칸이 생겼다.

원인은 `.app.is-mac.sidebar-collapsed .toolbar { padding-left: 84px }`. 사이드바가 접히면 툴바가 창 최상단 x=0 에 닿아 macOS 신호등 밑으로 들어가던 시절의 규칙이다(titleBarStyle Overlay).

크롬식 탭(v2.9.0) 이후로 **탭 스트립이 최상단을 차지하고 신호등 자리를 책임진다**. 셸은 `ProjectTab` → `ShellV2` 로만 마운트되고 그 위에는 언제나 스트립이 있다 — 같은 이유로 사이드바 상단 인셋은 이미 0 으로 내려가 있었는데(`tabs.css`) 툴바 쪽만 안 지워졌다. 툴바는 신호등과 만날 일이 없어졌는데 자리만 비워 두고 있었던 것.

규칙을 지우고 그 자리에 **이유를 남겼다**. 안 지우면 다음에 보는 사람이 "여기 신호등에 겹치겠는데?" 하고 다시 넣는다 — 빈 줄만 남기면 그 판단의 근거가 사라진다.

## 검증

typecheck 0 · 프런트 806 · lint 0 · build 0.