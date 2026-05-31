---
schema_version: 1
type: feature
slug: pr-ui5-tool-screens
status: done
difficulty: high
created_at: "2026-06-01T01:42:18+09:00"
updated_at: "2026-06-01T01:42:18+09:00"
session_id: "20260601-m02"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/planner/PlannerScreenV2.tsx
    op: create
    bytes_added: 8200
    bytes_removed: 0
  - path: src/features/search/SearchScreenV2.tsx
    op: create
    bytes_added: 7600
    bytes_removed: 0
  - path: src/features/terminal/TerminalScreenV2.tsx
    op: create
    bytes_added: 8400
    bytes_removed: 0
  - path: src/features/chat/AiPanelScreenV2.tsx
    op: create
    bytes_added: 9300
    bytes_removed: 0
  - path: src/__tests__/tools_v2.test.tsx
    op: create
    bytes_added: 6500
    bytes_removed: 0
  - path: src/features/shell/ShellV2.tsx
    op: update
    bytes_added: 900
    bytes_removed: 700
  - path: src/styles/screens.css
    op: update
    bytes_added: 4800
    bytes_removed: 0
  - path: src/components/Icons.tsx
    op: update
    bytes_added: 300
    bytes_removed: 0
  - path: scripts/check-no-localstorage.mjs
    op: update
    bytes_added: 300
    bytes_removed: 0
  - path: docs/Lite-update/Fianl_UI_update_before1.0/05-implementation-checklist.md
    op: update
    bytes_added: 3200
    bytes_removed: 1100
related:
  - "../Features_to_add/0033_feature_pr-ui4-diff-screen.md"
tags: ["ui-v2", "final-ui-update", "pr-ui5", "planner", "search", "terminal", "ai-panel"]
---

## 추가 기능

Final UI Update 라운드 **PR-UI 5 — 도구 4 화면 일괄(코드검색/터미널/AI패널/Planner)**. 이번 라운드 최대 PR. flag-on 일 때 ShellV2 가 4화면을 실제 백엔드 연동으로 마운트. flag-off 의 레거시 PlannerPanel/ChatPanel/TerminalPanel/AiOverlay 는 무변경(0 diff lines).

- `PlannerScreenV2` — goalList/subtaskList/subtaskToggle 실연동, 목업 .goal-card/.subtask, plannerOpen 영속, optimistic 토글.
- `SearchScreenV2` — searchChunks 시맨틱 실연동. scope-chip 3종 중 의미검색만 동작(심볼/정확은 백엔드 단일모드라 disabled + "1.1" 안내). ⌘F 포커스/⌘N 초기화.
- `TerminalScreenV2` — 목업 .term-wrap/.term-tabs/.term-screen + 레거시 TerminalPanel 의 PTY 와이어링 추출(listen pty-data → startPtySession → onData → writeToPty + resize/kill). terminalTabs/terminalActiveId 영속, ⌘T/⌘W, xterm 전부 mount 유지+CSS 토글로 PTY 보존.
- `AiPanelScreenV2` — 목업 .ai-wrap/.ai-models/.ai-thread/.ai-compose + 레거시 ChatPanel 의 chatStream 루프 추출(Channel<ChatEvent> delta 누적). 모델 칩=provider, conversation resolve/create 후 aiThreadId 공유(AiOverlay 와), chatMessageAppend 영속.
- screens.css 에 목업 Planner/Search/Terminal/AI 섹션 포팅(+scope-chip — PR-UI 3 누락분 보강). Icons 에 Activity/Paperclip/Filter/Variable/CaseSensitive 추가.

## 동작 흐름

- ShellV2 라우터: planner/search/terminal/ai 분기 추가(placeholder 는 settings 만 남음).
- thread 공유: AiPanelScreenV2 mount → conversationList → 없으면 create → id 를 aiThreadId(문자열) park → 오버레이가 동일 conversation 읽음. provider 는 aiActiveModel 영속.
- 터미널: 탭 id=PTY session id. 닫기 시 killPtySession. 마지막 탭 닫으면 useEffect 가 새 탭 spawn.

## 검증

- `pnpm typecheck` 0, `pnpm test` **92 passed | 3 todo** (PR-UI 4 의 83 → +9 tools_v2: Planner 3 + Search 4 + a11y 2), `pnpm lint` 0, `pnpm build` 0.
- 토큰 격리 유지: 메인 번들 녹색 0 + 도구 클래스(.search-big/.term-wrap/.ai-wrap/.goal-card) 0 → 전부 ShellV2 청크.
- 백엔드 무변경(0 files). 레거시 ChatPanel/TerminalPanel/AiOverlay 무변경(0 diff lines).
- 터미널(xterm/PTY)·AI(스트리밍 Channel)는 jsdom 단위테스트 불가 → dogfood 런타임 검증 필요. 단위테스트는 Planner/Search 만.

## 메모

- 새 결정 → §0.11 (4화면 V2 신규+로직추출 / 검색 단일모드 / aiThreadId 공유 / 터미널 탭 영속 / 단위테스트 한계).
- 다음 PR-UI 6 (Settings 재구성) — 여기서 ui_v2 모달 패턴 정립 시 보류분(Journal ⌘N ManualEntry, Planner 새 목표 모달, AI 대화기록 drawer) 연결 검토.
- **사용자 요청**: 이 PR 까지만 하고 멈춤. 다음 세션에서 PR-UI 6 부터.
