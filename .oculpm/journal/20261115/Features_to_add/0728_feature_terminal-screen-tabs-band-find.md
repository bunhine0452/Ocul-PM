---
schema_version: 1
type: feature
slug: "terminal-screen-tabs-band-find"
status: done
difficulty: high
created_at: "2026-11-15T07:28:29+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/__tests__/convenience_keys.test.tsx"
    op: update
  - path: "src/__tests__/send_dialog_reopen.test.tsx"
    op: create
  - path: "src/__tests__/send_dialog_v2.test.tsx"
    op: create
  - path: "src/__tests__/terminal_chrome.test.tsx"
    op: create
  - path: "src/__tests__/terminal_close_guard.test.tsx"
    op: update
  - path: "src/__tests__/terminal_file_menu.test.tsx"
    op: update
  - path: "src/__tests__/terminal_find_v2.test.tsx"
    op: create
  - path: "src/__tests__/terminal_keyboard.test.tsx"
    op: create
  - path: "src/__tests__/terminal_lane_links.test.tsx"
    op: create
  - path: "src/__tests__/terminal_race.test.tsx"
    op: update
  - path: "src/__tests__/terminal_race_strip.test.tsx"
    op: create
  - path: "src/__tests__/terminal_screen.test.tsx"
    op: update
  - path: "src/__tests__/terminal_status_band.test.tsx"
    op: create
  - path: "src/__tests__/terminal_tab_mouse.test.tsx"
    op: create
  - path: "src/__tests__/terminal_tabs.test.tsx"
    op: create
  - path: "src/features/terminal/PaneTree.tsx"
    op: update
  - path: "src/features/terminal/RacePanel.tsx"
    op: update
  - path: "src/features/terminal/SendToClaudeHost.tsx"
    op: update
  - path: "src/features/terminal/SessionTabs.tsx"
    op: create
  - path: "src/features/terminal/StatusBand.tsx"
    op: create
  - path: "src/features/terminal/TermFileMenu.tsx"
    op: update
  - path: "src/features/terminal/TermFindBar.tsx"
    op: update
  - path: "src/features/terminal/TermImagePeek.tsx"
    op: update
  - path: "src/features/terminal/TermToolbar.tsx"
    op: create
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/terminal/menuKeys.ts"
    op: create
  - path: "src/features/terminal/paneLayout.ts"
    op: update
  - path: "src/features/terminal/race.css"
    op: update
  - path: "src/features/terminal/race.ts"
    op: update
  - path: "src/features/terminal/send.css"
    op: update
  - path: "src/features/terminal/status.ts"
    op: update
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
  - path: "src/features/terminal/useTermCloseGuard.tsx"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
related: []
tags:
  - "터미널"
  - "terminal"
  - "quality-round"
  - "mcp-tool"
---
[x] 터미널: 탭 · 상태 띠 · 찾기를 다시 짰다

## 추가 기능

업그레이드 라운드 레인 「터미널 화면」(계획 quality-round-20261115). 터미널 탭에서 보이는 모든 것.

- **탭은 이름과 예외만(TS-01)**: 세션 이름은 대화 제목(엔진의 OSC 0/2) → 없으면 라벨. 번호는 다시 쓰지 않는다. 점 모양 · 예외 말 · 색은 `status.ts` 의 `sessionView` 한 곳에서 정해 탭 · 칸 머리 · 레인 띠가 같은 모양.
- **상태 띠(TS-02)**: 칸 위에 겹쳐 서는 띠(격자 크기를 바꾸지 않음) — 기다림 · 일지 없이 끝남 · 끝난 세션 「다시 열기」 · 빈/여는 중/실패. 세션이 하나여도 「일지 없음」 이 선다.
- **찾기(TS-03)**: 전체 화면 Claude 에서는 「보이는 화면만 · Ctrl+O 로 넘겨 보기」 안내, 정규식 · 칠(토큰에서 만든 색, 색칠된 글자 위에서도 보이게) · 재포커스.
- **키보드(TS-04)**: 대화상자 · 파일 메뉴 · 팔레트가 떠 있으면 터미널 키가 물러난다. 탭은 roving(←/→/Home/End, Delete 로 닫기).
- **레인 링크(TS-05)**: 여럿에서 돌린 시도(worktree) 세션의 상대 경로 ⌘클릭이 원래 폴더가 아니라 그 시도의 파일을 연다. 파일 메뉴 머리는 이름:줄을 자르지 않는다.
- **레인 띠 한 줄(TS-06)**: 「나란히 3 · 기다림 1 · 추천 시도 2 ›」 로 접힌다. 화면 말을 「레인」 에서 「시도」 로.
- **보내기 대화상자(TS-07)**, **크롬 정리(TS-08)**: 「새 세션 ⌘T | ▾」 한 벌 단추에 나누기 · 풀기 · 나란히 돌리기.

## 동작 흐름

`TerminalScreen.tsx` 를 `SessionTabs.tsx` · `StatusBand.tsx` · `TermToolbar.tsx` 로 나눠 800줄 아래를 지킨다. `termStore.ts` 는 찾기 구역(FindOptions · findDecor · isAltScreen · clearFindDecor)만 고쳤다.

## 검증

- 레인 게이트: vitest 117 files passed · typecheck · lint · build exit 0. 리뷰 둘(blocker 1 · major 3) 반영 — 그중 「Claude 에서 찾기」 가 Claude 에 Ctrl+O · / 를 치던 것은 CLAUDE.md 의 「앱이 터미널에 치는 줄」 목록 밖이라 걷고 안내로 바꿨다.
- 합류 뒤: `pnpm test` 1652 passed · typecheck · lint exit 0. 설치본에서 눈으로 보지는 않았다.

## 메모

- 이음 레인으로 넘긴 것: 「최근 소식 없음」 배선(termStore 의 noteTermActivity), 보내기 토스트의 「터미널 n」 을 탭 번호로, 탭 닫기 × 표적 15px(넓히면 창 번호를 덮어 이번엔 둠 — 키보드는 Delete · ⌘W).
- 상태 띠는 칸 맨 위 약 31px 를 덮는다(격자를 줄이지 않기로 한 설계). 전체 화면 TUI 의 첫 줄이 가려질 수 있다.