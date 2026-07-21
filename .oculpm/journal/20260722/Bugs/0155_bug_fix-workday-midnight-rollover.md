---
schema_version: 1
type: bug
slug: "fix-workday-midnight-rollover"
status: done
difficulty: medium
created_at: "2026-07-22T01:55:01+09:00"
session_id: "mcp-20260722-015501"
agent:
  id: "claude-code"
  version: "Opus 4.8"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/__tests__/workday_rollover.test.tsx"
    op: create
  - path: "src/__tests__/notion_export_v2.test.tsx"
    op: update
  - path: "scripts/check-no-localstorage.mjs"
    op: update
related: []
tags:
  - "workday"
  - "today"
  - "rollover"
  - "workspace-context"
  - "mcp-tool"
---
[x] 자정을 넘겨도 메인 창이 어제를 가리키던 버그 수정

앱을 계속 켜 두면 00시가 지나도 "오늘" 화면·날짜 라벨·주간 차트가 앱을 껐다 켜기 전까지 전날에 고정되던 문제.

## 발생 원인

메인 창의 "오늘" 기준값은 `state.workdayKey`(폴백 `oculpmStatus.current_workday`) 하나에서 파생된다. 이 값은 App.tsx 의 프로젝트 선택 이펙트에서 `oculpmGetStatus` 를 **딱 한 번** 호출해 채워진다. 백엔드는 `current_workday` 를 `resolver.workday_of(Utc::now())` 로 그 순간에만 계산한다.

즉 프론트에는 workday 를 다시 당겨오는 트리거가 전혀 없었다. 백엔드 세션 액터에 `spawn_boundary_timer` 가 있긴 하나 (1) 활성 세션이 있을 때만 돌고 (2) 세션 마감용이라 프론트로 이벤트를 쏘지 않는다. 그래서 자정을 넘겨도 `workdayKey` 는 실행 당시 날짜에 머물렀고, 앱 재시작(=프로젝트 재선택 → status 재조회) 전까지 갱신되지 않았다. (트레이 팝오버는 열 때마다 재조회하므로 영향 없음.)

## 해결 방법

WorkspaceContext 에 workday 롤오버 워처 이펙트를 추가했다.

- 60초 주기 tick + 창 `focus`/`visibilitychange`(슬립 복귀로 타이머가 throttle 됐던 경우 대비) 에 백엔드 `oculpmApi.getStatus` 를 재조회한다.
- `current_workday` 가 **실제로 바뀌었을 때만** `setOculpmStatus` 로 커밋한다 → 매 tick 리렌더 없이 하루 한 번 경계에서만 트리가 갱신된다. `stateRef` 로 현재 프로젝트/workday 를 읽어 이펙트는 한 번만 마운트된다.
- workday 계산을 백엔드에 위임하므로 프로젝트 tz + `day_starts_at`(00시 아닌 경계)도 그대로 존중된다. `inFlight` 가드 + 요청 도중 프로젝트 전환 시 결과 폐기.

`workdayKey` 가 넘어가면 소비처(Today `useTodayBrief` 의 `[workday]` 의존 재조회, ShellV2 날짜 라벨 재계산, 주간 차트)가 연쇄로 새 날짜를 반영한다.

곁들여, 실제 날짜에 의존해 매주 깨지던 notion_export_v2 테스트의 회고 주간 범위 단언을 `Date` 만 고정(타이머는 실물 유지 → `waitFor` 정상)해 결정적으로 만들었다. 롤오버 테스트가 default state 에서 마운트되도록 localStorage 를 비우므로 그 테스트 파일을 storage-lint 허용목록에 등록.

## 검증

`pnpm typecheck` / `pnpm test`(33파일 208통과, 신규 workday_rollover 3케이스 포함) / `pnpm lint` / `pnpm build` 각각 exit 0 직접 확인. 신규 테스트가 경계 넘김→workdayKey 갱신, 같은 날 무커밋(리렌더 0), 프로젝트 없을 때 무조회를 커버.