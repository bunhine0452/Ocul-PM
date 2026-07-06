---
schema_version: 1
type: refactor
slug: workspace-render-surgery
status: done
difficulty: high
created_at: "2026-07-06T21:43:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/lib/recentChangesStore.ts
    op: create
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/features/diff/DiffScreenV2.tsx
    op: update
  - path: src/__tests__/diff_v2.test.tsx
    op: update
  - path: src/__tests__/recent_changes_store.test.tsx
    op: create
related: []
tags: ["v2-release", "U3", "performance", "workspace-context", "render"]
---

[x] U3 WorkspaceContext 리렌더 수술 — recentChanges 스토어 분리 + value 메모 + persist 디바운스

## 동기

에이전트가 활발히 코딩하는 동안(=이 앱의 핵심 시나리오) watcher `oculpm:file_changed` 이벤트마다 ① 컨텍스트 setState 로 전 소비자(셸 전체) 리렌더, ② `useEffect([state])` 가 최대 1000건 recentChanges 를 포함한 전체 blob 을 동기 `JSON.stringify` → localStorage 기록. 게다가 provider `value` 가 매 렌더 새 객체 리터럴이라 memo 최적화가 원천 차단되어 있었다.

## 변경 요약

- **`src/lib/recentChangesStore.ts` 신설**: 모듈 스코프 링 버퍼(cap 1000) + `useSyncExternalStore` 훅. `push`/`markRead`(no-op 시 무알림)/`clear`. watcher 이벤트는 이 스토어에만 기록 → 구독 화면(변경 diff)만 리렌더. `ChangeOp`/`RecentChange`/`pushRecentChange`/`RECENT_CHANGES_CAP` 을 이 모듈로 이동, WorkspaceContext 가 재수출(기존 임포트 경로 호환 — lite_w6 안전망 테스트 무수정 그린).
- **WorkspaceState 에서 `recentChanges` 제거**: 영속 blob 에서도 제외(세션 휘발). 근거 — diff 화면 파일 목록은 git status 가 영속 소스(Bug 1 fix)라 재시작 후에도 채워지고, read/unread 는 "이번 세션 신선도" 의미라 세션 리셋이 정확. 과거 레코드의 배열은 load 시 drop(일방향).
- **persist 300ms 트레일링 디바운스** + beforeunload/unmount flush (`stateRef` 로 최신 상태 보장).
- **provider `value` useMemo** — 콜백 전부 `useCallback([])` 안정이라 사실상 state 종속.
- `markRecentChangeRead` 컨텍스트 API 제거 → `recentChangesStore.markRead` (소비처 DiffScreenV2 1곳 이전). setProject/resetWorkspace 가 프로젝트 전환 시 스토어 clear (기존 규칙 유지).

## 검증

- 신규 `recent_changes_store.test.tsx`: **store.push 가 컨텍스트 소비자 리렌더 0 회** (격리 계약 — 렌더 카운터), markRead no-op 무알림(구독 알림 카운트), clear 멱등.
- diff_v2 테스트 시딩을 localStorage 엔벨로프 → 스토어 push 로 이전, 전 케이스 그린.
- 게이트: typecheck=0 / test=0 (18파일 132) / lint=0 / build=0 직접 확인.
