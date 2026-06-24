---
schema_version: 1
type: refactor
slug: workspace-context-dead-code
status: done
difficulty: medium
created_at: "2026-06-24T16:40:50+09:00"
session_id: "20260624-m02"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/__tests__/lite_w6_safety_net.test.ts
    op: update
  - path: src/features/shell/ShellV2.tsx
    op: update
related: []
tags: ["cleanup", "dead-code", "workspace-context", "dev-report-followup", "surgical-context-cleanup"]
---

[x] WorkspaceContext 죽은 조각 외과 제거 (surgical-context-cleanup 완료)

## 동기

보고서 01 §1-C 의 마지막 미완 조각. PR-UI 7 에서 사이드 패널·LocalDiffView 가 사라지며 남은 WorkspaceContext API 잔재를 제거한다. 직전 라운드(v1.12.0)는 이 부분을 **의도적 보류**했는데, 보고서가 `openDiffFor`를 "활성 caller 2개"로 적은 게 **오기**(실제로는 ShellV2 의 `openDiffForEntry` 라는 다른 함수가 살아있는 `diffActivePath` 경로를 씀)였기 때문 — 그래서 이번엔 **조각마다 repo-wide grep 으로 production·test 참조를 직접 확인**한 뒤 제거했다.

## 변경 요약 (제거)

- **완전 사망(어디서도 참조 0) 세터 4개**: `setActiveView` / `setWorkdayKey` / `setSidePanelWidth` / `setSidePanelMode`. 타입·구현·context value 에서 제거.
- **production 0 + 죽은-동작 테스트만 핀**: 옛 FileTree→Diff 원샷 핸드오프 `openDiffFor`/`consumeDiffTarget` + `diffTarget` 필드(기본값·휘발성 reset·persist 디스트럭처 포함) — **살아있는 `diffActivePath`(자체 테스트 diff_v2.test.tsx 보유)로 대체됨**. `clearRecentChanges`(caller 0). 핀하던 safety-net 블록 2개(PR6.4 diffTarget 핸드오프, PR8 Part3 clearRecentChanges)도 함께 삭제, 미사용 `act` import 정리.

## 보존 (보고서 지침 "마이그레이션 normalizer 유지")

- `activeView`/`sidePanelWidth`/`sidePanelMode` **필드**와 마이그레이션(`migrateActiveView`/`migrateV1ToV2`/`migrateV2ToV3`/`migrateSidePanelWidth`/`migrateSidePanelMode`) + 그 safety-net 테스트는 **유지** — 영속 스키마 read-compat. `defaultTabUserOverride` 도 유지(이제 persisted 레코드만 set, 주석 갱신).
- `markRecentChangeRead`·`recentChanges`(DiffScreenV2 가 사용) 유지.

## 검증

- repo-wide grep: 제거한 7개 심볼 모두 잔여 참조 0(남은 `openDiffFor`/`diffTarget` 매치는 무관한 `openDiffForEntry` + 산문 주석뿐, 주석은 갱신).
- `diffTarget`는 원래 비영속(persist 시 destructure-strip)이라 사용자 localStorage 에 남은 적 없음 → 마이그레이션 우려 0.
- 프런트 typecheck/lint/build exit 0, 테스트 121 통과(죽은-동작 단언 4개 감소: 125→121). 백엔드 무변경.

## 메모

- 표면 변화 0(순수 내부 정리) → 단독 릴리스 안 함. 다음 사용자 표면 항목(auto-reconcile)과 묶어 배포 예정.
- `#surgical-context-cleanup` 완료([~]→[x]).
