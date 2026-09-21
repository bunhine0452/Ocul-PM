---
schema_version: 1
type: bug
slug: "hidden-tab-leaks-cmd-d-and-entry-toast"
status: done
difficulty: medium
created_at: "2026-09-21T23:54:27+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "ae22b7c7-8d5e-44b6-be27-921992fff30a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/terminalSurface/useTerminalKeys.ts"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/api/window.ts"
    op: update
  - path: "src/__tests__/hidden_tab_leaks.test.tsx"
    op: create
related: []
tags:
  - "terminal"
  - "tabs"
  - "toast"
  - "journal"
  - "shortcuts"
  - "mcp-tool"
---
[x] 숨은 프로젝트 탭으로 새던 둘 — 터미널 ⌘D 가 모든 탭을 쪼갬 · 새 일지 토스트 「열기」가 보고 있던 프로젝트의 일지로 감

## 발생 원인

둘 다 같은 뿌리다 — 크롬식 탭은 한 번 연 프로젝트 탭을 **마운트한 채 `display:none` 으로 숨긴다**. 그래서 "창에 하나만 반응해야 하는 것"이 열려 있는 탭 수만큼 발화한다 (`ProjectTab.tsx` 머리말이 경고하던 바로 그 사건).

1. **터미널 ⌘D** — `useTerminalKeys` 의 keydown 리스너는 `keyboardScope="always"`(터미널 화면·분리 창)일 때 포커스를 묻지 않는다. 도크는 `focused` 라 숨은 탭에서 포커스가 잡힐 수 없어 무사했지만, 터미널 **화면**을 열어 둔 배경 탭은 그대로 `window` keydown 을 들었다 → A 탭에서 누른 ⌘D 가 B·C 탭의 터미널까지 함께 쪼갰다.
2. **새 일지 토스트 「열기」** — 토스트는 그 프로젝트의 `WorkspaceProvider`(숨은 탭 B 안에 산다)가 띄우는데, 「열기」는 창 전역 `NAV_BUS.openEntity` CustomEvent 를 쏘고, 그 버스는 `useShellNav` 가 **활성 탭만** 듣는다(`if (!active) return`). 결과: 활성 탭 A 의 셸이 B 의 상대 경로로 A 의 일지 화면을 열었다 — "현재 보고 있는 창의 작업일지로 넘어감".

## 해결 방법

1. `useTerminalKeys` — keydown 에 **"이 면이 레이아웃돼 있는가"** 게이트를 앞에 둔다: `root.getClientRects().length === 0` 이면 무시. 숨은 탭은 `display:none` 이라 사각형이 없다. 코드 화면 `useCodeScreenKeys` 의 `isVisible()` 과 같은 판정이라 새 prop 을 셸→화면→면으로 꿰지 않아도 된다 (병렬 WIP 가 있는 `TerminalSurface.tsx` 도 건드리지 않았다). ⌘W/⌘T 인텐트 사슬은 원래 포커스 기반이라 그대로.
2. 토스트 「열기」 — 창 전역 버스 대신 **프로젝트 앞으로 건 요청**을 쓴다: `requestEntryJump(projectId, path)`(시작 탭 「오늘의 흐름」이 쓰던 `lib/entryJump`, 받는 셸이 project id 로 거르고 `active` 를 보지 않는다) + `windowApi.openProjectTab(projectId, null)` 로 그 탭을 활성화(I1: 이미 열려 있으면 창 포커스 + 탭 활성화). B 의 셸이 요청을 받아 자기 일지 화면·상세를 세팅해 두고, 탭이 앞으로 나온다. `windowApi.openProjectTab` 래퍼를 새로 두어 `lint:bindings` 를 지켰고, `WorkspaceContext.tsx` 는 1222줄 래칫 안에서 ±0.

같은 부류로 남은 것(이번 범위 밖, 보고만): `JournalScreenV2`·`SearchScreenV2` 의 ⌘N/⌘F, `DiffFileList`/`useDiffSearch` 의 j·k·/ , `useSaveFlow` 의 ⌘S 도 `active`/가시성 게이트 없이 `window` keydown 을 듣는다 — 숨은 탭에서 수동 일지 모달이 열리거나 검색 결과가 지워질 수 있다.

## 검증

- `src/__tests__/hidden_tab_leaks.test.tsx` 5건: 고치기 전 코드에서 4건 붉게(stash 로 확인) → 고친 뒤 전부 초록. 숨은 면은 ⌘D 무시, 두 면 중 보이는 쪽만 분할(⇧⌘D 는 col), 도크는 여전히 포커스 양보; 토스트 「열기」는 B 앞 요청 + `openProjectTab(2, null)`, 창 전역 버스 미사용, 셸이 없으면 마운트 회수.
- `pnpm typecheck` · `pnpm test`(220 파일 2748건) · `pnpm lint`(6게이트, 경고 4 = 기존) · `pnpm build` 전부 exit 0.
- 실기기 육안 미확인 — 설치본이 돌고 있어 dev 빌드를 띄우지 않았다.