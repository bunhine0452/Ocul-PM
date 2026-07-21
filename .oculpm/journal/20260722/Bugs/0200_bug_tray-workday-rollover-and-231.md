---
schema_version: 1
type: bug
slug: "tray-workday-rollover-and-231"
status: done
difficulty: low
created_at: "2026-07-22T02:00:12+09:00"
session_id: "mcp-20260722-020012"
agent:
  id: "claude-code"
  version: "Opus 4.8"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/tray/TrayPopover.tsx"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "landing/index.html"
    op: update
related: []
tags:
  - "workday"
  - "tray"
  - "rollover"
  - "release"
  - "mcp-tool"
---
[x] 트레이 팝오버도 자정 롤오버 + v2.3.1 릴리스

메인 창 자정 롤오버 fix(fix-workday-midnight-rollover)의 후속. 트레이 팝오버를 **연 채로** 경계를 넘기면 같은 방식으로 "오늘"이 전날에 고정되던 것을 마저 막고, 패치 릴리스했다.

## 발생 원인

트레이 팝오버는 열릴 때(`tray-popover-shown`)와 새 일지(`oculpmJournalAdded`)에만 `reload()` 한다. 그래서 대개는 신선하지만, 팝오버를 계속 띄워 둔 상태로 자정을 넘기면 프로젝트별 `current_workday`·"오늘" 수치가 갱신되지 않았다. 메인 창과 동일한 "workday 재조회 트리거 부재" 문제의 트레이판.

## 해결 방법

[TrayPopover.tsx](src/features/tray/TrayPopover.tsx) 에 롤오버 워처를 추가했다.

- 60초 tick + 창 `focus`/`visibilitychange`(슬립 복귀 대비)에 **로컬 달력 날짜(`localDayKey`)** 가 바뀌었는지 확인한다.
- 바뀌면 `reload()` — reload 가 프로젝트별 `current_workday` 를 백엔드에서 재계산하므로 tz/`day_starts_at` 도 그때 반영된다. 날짜가 그대로면 재조회하지 않아 팝오버 숨김 중에도 부담이 없다.
- 메인 창(WorkspaceContext)은 60초마다 status 를 폴링해 tz/day_starts_at 경계를 분 단위로 정확히 잡고, 트레이는 로컬-자정 트리거로 reload 하는 차이 — 트레이는 전 프로젝트 4콜×N 이라 무조건 폴링은 과해서 트리거를 가볍게 뒀다.

## 검증

`pnpm typecheck` / `pnpm test`(33파일 208통과) / `pnpm lint` / `pnpm build` 각각 exit 0. 버전 2.3.0 → 2.3.1 (package.json·tauri.conf.json·Cargo.toml·Cargo.lock·landing softwareVersion) 후 `v2.3.1` 태그 푸시 → release.yml(tauri-action)가 서명 번들+updater 아티팩트 빌드.