---
schema_version: 1
type: bug
slug: recent-changes-leak-across-tabs
status: done
difficulty: medium
created_at: 2026-09-01T18:49:00+09:00
session_id: manual-20260901-184900
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src/lib/recentChangesStore.ts
    op: update
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/features/diff/DiffScreenV2.tsx
    op: update
  - path: src/__tests__/recent_changes_store.test.tsx
    op: update
  - path: src/__tests__/diff_v2.test.tsx
    op: update
related:
  - .oculpm/journal/20260901/Bugs/1512_bug_cmd-t-terminal-new-tab.md
tags:
  - diff
  - watcher
  - tabs
  - state
---

[x] 「미기록 변경」이 다른 프로젝트 탭에도 보이던 문제

## 발생 원인

`recentChangesStore` (watcher 파일 변경 버퍼)가 **버킷 없는 모듈 스코프 단일
배열**이었다. v2 U3 에서 이 스토어를 만들 당시엔 창 하나가 프로젝트 하나를
물었으니 맞는 모양이었다.

크롬식 탭 이후 전제가 깨졌다. 한 창이 프로젝트 여럿을 동시에 물고, 탭마다
`WorkspaceProvider` 가 따로 서지만(`TabbedWindow.tsx:565`) **모듈은 웹뷰에
하나뿐**이다. 각 프로바이더의 `oculpmFileChanged` 리스너는
`project_id !== currentProjectId()` 가드로 남의 이벤트를 잘 거르지만, 통과한
이벤트를 전부 같은 배열에 밀어 넣었다 (`WorkspaceContext.tsx:1273`). 읽는 쪽
`DiffScreenV2` 는 `useRecentChanges()` 로 배열 전체를 받아 git status 목록과
머지하므로, A 탭에서 파일이 바뀌면 B 탭의 파일 목록·「미기록 변경」 그룹에
그대로 떴다. 그 행을 열면 `computeDiff(B, A의 경로)` 가 나간다.

`markRead(path)` 도 경로만 키였다 — 프로젝트 둘이 `src/App.tsx` 를 함께 가지면
한쪽에서 본 것이 다른 쪽에서도 읽음으로 바뀌었다. `clear()` 는 "프로젝트 전환
시" 용도로 남아 있었지만 탭 전환은 전환이 아니므로 이제 아무도 부르지 않는다.

## 해결 방법

스토어를 프로젝트별 버킷(`Map<number, RecentChange[]>`)으로 가르고, **모든
진입점이 `projectId` 를 받게** 했다 — 버킷을 빠뜨린 호출이 타입 에러가 되도록.

- `get/push/markRead(projectId, …)`, `clear(projectId?)` (인자 생략 = 전부, 테스트 격리용).
- `useRecentChanges(projectId)` — `useCallback` 으로 스냅샷을 프로젝트에 묶는다.
  빈 버킷은 **동결한 상수 하나**를 돌려준다: 매번 새 `[]` 면 `Object.is` 비교가
  늘 실패해 남의 프로젝트가 push 할 때마다 무한 리렌더에 빠진다.
- 리스너 집합은 창 전역 그대로 두되, 스냅샷이 안 바뀐 탭은 React 가 리렌더를
  건너뛴다 (구독자는 열린 diff 화면 몇 개뿐이라 팬아웃 비용이 무의미하다).
- `WorkspaceContext` 는 `evt.payload.project_id` 를 버킷으로 넘기고,
  `DiffScreenV2` 는 자기 `projectId` 로 읽고 표시한다.

## 검증

`pnpm typecheck` · `pnpm test`(138 파일 / 1692 통과) 모두 exit 0. 먼저 실패하는
테스트부터 썼다 — 탭 두 개(`projectId` 1·2)를 나란히 마운트한 뒤 1 에만 push
하면 수정 전엔 2 의 카운트가 `1` 로 올라갔고(=신고된 증상 그대로), 수정 후 `0`
이다. 화면 단위로도 1 의 변경을 심고 `DiffScreenV2(projectId=2)` 를 그리면
"변경이 없어요"가 나오는지 단언한다. 프로젝트별 `markRead`·`clear` 격리도 함께.

`pnpm lint` 는 `lint:bindings` 에서 붉지만 이 변경과 무관하다 — 병렬 세션의
미추적 WIP(`src/api/declarativeConfig.ts`)를 짚는다.

## 메모

같은 병이 남은 곳: `indexProgressStore` 도 버킷 없는 단일 값이라 색인 진행률이
탭을 가로질러 보인다(검색 화면 하나만 읽고, 표시가 잠깐 틀릴 뿐이라 이번
범위 밖). `codeBuffers` 는 이미 `bufferKey(projectId, relPath)` 로 갈라져 있다.
