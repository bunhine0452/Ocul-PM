---
schema_version: 1
type: refactor
slug: workspace-context-split
status: done
created_at: 2026-08-30T16:43:00+09:00
session_id: "manual-20260830-164300"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/features/terminal/TerminalSurface.tsx
    op: update
  - path: src/features/chat/AcpConversation.tsx
    op: update
  - path: src/features/planner/PlannerScreenV2.tsx
    op: update
  - path: src/features/retro/RetroScreenV2.tsx
    op: update
  - path: src/windows/useTabRunningWork.ts
    op: update
  - path: src/__tests__/polish_phase2.test.tsx
    op: update
  - path: src/__tests__/notion_export_v2.test.tsx
    op: update
  - path: scripts/check-no-localstorage.mjs
    op: update
related:
  - .oculpm/journal/20260830/Refactors/1636_refactor_error-convention-and-store-helpers.md
tags: [design, context, terminal, persistence, polish-round]
---

[x] WorkspaceContext 3분할 — 런타임 · 터미널 세션 · UI 취향 조각 + 셀렉터 훅, 터미널 탭 목록의 잃어버린 갱신 제거

## 배경

`WorkspaceState` 하나에 40여 필드가 살고 `useWorkspace()` 의 `value` 가 그 전체에 매여 있었다 — 검색어 하나가 바뀌어도 터미널·플래너·코드·Claude Code 화면이 전부 다시 그려졌다(35개 소비자). 터미널 탭 목록은 앱 창과 분리 터미널 창이 **같은 localStorage 레코드**를 나눠 쓰는 유일한 필드인데, 쓰기는 자기 몫만 쓰도록 고쳐져 있었지만 **읽기**가 없었다: 상대가 탭을 만들어도 이쪽 메모리는 떠날 때의 스냅샷이고, `terminalDetached` 가 늦게 오면 그 낡은 목록이 통째로 저장됐다. `oculpmEnabled` 는 휘발성이라 적혀 있으면서 영속 제외 목록에 없어 디스크에 남았다.

## 설계

단일 진실(`useState<WorkspaceState>` 하나)은 **그대로** — 원자적 갱신·영속 레코드 모양(`aipm:workspace:v2:p<id>`)·기존 테스트 계약을 지킨다. 읽는 쪽을 셋으로 가른다:
- `useProjectRuntime()` — `currentProject*`·`indexingProjectId`·`oculpmEnabled/Status`·`currentSession`·`workdayKey`·`terminalDetached`·`sidebarCollapsed` + 그 세터.
- `useTerminalSessions()` — `terminalTabs`·`terminalActiveId` + `setSessions/selectTab/patchTab/openTab(tab, {view})`.
- `useUiPrefs()` — 나머지 영속 취향 + `setPrefs(prev => partial)`·`setUiV2View`.
각 조각은 `useStableSlice`(키별 `Object.is`) 로 **자기 키가 바뀔 때만** 새 참조가 되므로 조각 훅을 쓰는 화면은 남의 변화에 조용하다. `useWorkspace()` 는 합친 겉면으로 남는다(21개 파일이 `setState` 를 직접 쓴다 — 점진 이관).

옮긴 소비자: `TerminalSurface`(세션+런타임 — 8곳의 `setState` 가 `setSessions` 로), `AcpConversation`(취향 `acp*` 10곳 → `setPrefs`, 「터미널에서」 → `openTab(…, {view:"terminal"})`), `PlannerScreenV2`·`RetroScreenV2` 의 디스패치 핸드오프 읽기, `useTabRunningWork`.

잃어버린 갱신: `storage` 이벤트(다른 문서의 쓰기에만 발화)를 레코드 키로 듣고, 분리 중(또는 분리 창 자신)이면 상대가 남긴 터미널 두 필드를 곧장 받아들인다. 이제 어느 창이 언제 저장하든 최신 목록이다. `oculpmEnabled` 는 영속 제외 + 로드 시 false.

## 검증

`pnpm typecheck` · `lint`(3종) · `vitest`(123 파일 · 1478 — 조각 안정성 3케이스: 취향↔터미널↔런타임 서로 참조 유지, `setPrefs` 무변경 시 조용, storage 이벤트 채택/비채택) · `build` exit 0. `terminal_dock`·`multi_window`·`workday_rollover`·`code_screen_tabs` 는 손대지 않고 통과 — 레코드 모양·`persistScope` 계약 불변.

## 한계 / 후속

- 겉면 `useWorkspace()` 를 쓰는 화면(ShellV2·Search·Diff·Code·Docs·Discussion·Journal 등)은 아직 전체 상태에 매여 있다 — 한 화면씩 조각 훅으로 옮길 때마다 리렌더가 줄어든다.
- 같은 창 안에서 한 디바운스(300ms) 창에 두 창이 동시에 저장하는 경우는 여전히 순서에 달려 있다 — 다만 이제 두 쪽 다 최신 목록을 들고 있어 잃는 것은 없다.
