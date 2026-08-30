---
schema_version: 1
type: bug
slug: watcher-state-always-off
status: done
created_at: 2026-08-30T15:11:00+09:00
session_id: "manual-20260830-151100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: verylow
files_touched:
  - path: src-tauri/src/oculpm/manager/lifecycle.rs
    op: update
related: []
tags: [watcher, status, polish-round]
---

[x] 터미널 상태바의 워처 표시기가 항상 "감시 꺼짐"이었다 — `get_status` 가 `Stopped` 를 하드코딩

## 발생 원인

`manager/lifecycle.rs get_status` 가 `watcher_state: WatcherStateView::Stopped` 를 박아 두고 "W2 swaps this to Running once the watcher boots" 라는 주석만 남겨 둔 채 W2 가 지나갔다. 진짜 상태를 주는 `watcher_status` 커맨드는 프런트 호출처가 0 이라, 상태바(`TerminalSurface.tsx`) 는 워처가 멀쩡히 돌 때도 "감시 꺼짐" 을 회색으로 그렸다. 2026-07-16 의 "실제 워처 상태 그대로" 수정은 프런트만 고친 것이었다.

## 해결 방법

`get_status` 가 `entry.watcher.as_ref().map(|w| w.status().state)` 로 실제 상태를 낸다 — 워처 없음이면 그대로 `Stopped`.

## 검증

`cargo test` 869 그린(워처 통합 테스트 포함). 실기기: 프로젝트 탭을 연 뒤 터미널 상태바가 "감시 중" 초록으로 — 앱 꺼진 뒤 몰아서.
