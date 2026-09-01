---
schema_version: 1
type: bug
slug: index-progress-collides-across-tabs
status: done
difficulty: low
created_at: 2026-09-01T18:58:00+09:00
session_id: manual-20260901-185800
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src/lib/indexProgressStore.ts
    op: update
  - path: src/windows/ProjectTab.tsx
    op: update
  - path: src/features/search/SearchScreenV2.tsx
    op: update
  - path: src/__tests__/polish_phase2.test.tsx
    op: update
related:
  - .oculpm/journal/20260901/Bugs/1849_bug_recent-changes-leak-across-tabs.md
tags:
  - search
  - indexing
  - tabs
  - state
---

[x] 두 프로젝트를 동시에 색인하면 진행률이 서로 덮어쓰이던 문제

## 발생 원인

`recentChangesStore` 와 **같은 병의 두 번째 환자**다 (`related` 참고).
`indexProgressStore` 는 `createStore<IndexProgress | null>` — 창에 슬롯 하나였다.

크롬식 탭에서 프로젝트 A·B 를 동시에 색인하면 두 `ProjectTab` 의 `startIndex`
가 각자 `Channel` 을 열고 같은 슬롯에 쓴다 (`ProjectTab.tsx:253`). 결과는 두
가지다.

- 두 검색 화면의 "n/m 색인 중" 이 나중에 도착한 쪽 숫자로 튄다 — 파일 수가
  다르면 진행률이 앞뒤로 뛴다.
- 먼저 끝난 쪽의 `clear()` 가 **아직 도는 쪽의 진행률까지** 지운다. 남은 탭의
  배너는 그때부터 숫자 없는 `search.indexingNoCount` 로 주저앉는다.

배너 자체는 탭별 컨텍스트(`state.indexingProjectId === projectId`)로 게이트되어
있어서, 한쪽만 색인할 땐 증상이 안 보인다 — 동시 색인에서만 드러난다.

## 해결 방법

`recentChangesStore` 와 같은 수리. 단, 이쪽은 값 하나짜리라
`createStore<ReadonlyMap<number, IndexProgress>>` 로 감싸 기존 원시형을 그대로
쓴다 (Phase 4 의 `createStore` 규약 유지).

- `set(projectId, progress)` · `clear(projectId?)`(생략 = 전부, 테스트 격리용) ·
  `get(projectId)` · `useIndexProgress(projectId)`.
- `clear` 는 없는 버킷이면 **이전 Map 참조를 그대로** 돌려준다 —
  `createStore` 의 `Object.is` 가드에 걸려 구독자가 헛돌지 않는다.
- `useIndexProgress` 는 `useCallback` 스냅샷으로 프로젝트에 묶는다. 남의
  프로젝트가 진행률을 밀어도 이 탭의 스냅샷(`IndexProgress` 객체 또는 `null`)이
  그대로면 React 가 리렌더를 건너뛴다.

## 검증

먼저 실패하는 테스트부터 — 훅 둘(`projectId` 1·2)을 걸고 양쪽에 다른 진행률을
밀면 수정 전엔 한쪽 값이 다른 쪽을 덮었고, `clear(1)` 이 2 의 진행률까지
지웠다. 수정 후 각자 자기 값을 들고 있고 `clear(1)` 은 2 를 건드리지 않는다.

`pnpm typecheck` · `pnpm test`(138 파일 / 1693 통과) exit 0.

## 메모

`codeBuffers` 는 처음부터 `bufferKey(projectId, relPath)` 로 갈라져 있어 무사하다.
남은 모듈 스코프 상태 전반은 별도로 훑는 중.
