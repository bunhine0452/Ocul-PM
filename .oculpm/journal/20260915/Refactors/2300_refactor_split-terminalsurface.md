---
schema_version: 1
type: refactor
slug: "split-terminalsurface"
status: done
difficulty: medium
created_at: "2026-09-15T23:00:17+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/features/terminal/terminalSurface/useSessionMove.ts"
    op: create
  - path: "src/features/terminal/terminalSurface/useTerminalKeys.ts"
    op: create
  - path: "src/features/terminal/terminalSurface/TerminalSearchBar.tsx"
    op: create
  - path: "src/features/terminal/terminalSurface/useDispatchPrefill.ts"
    op: create
  - path: "src/features/terminal/terminalSurface/usePaneStates.ts"
    op: create
  - path: "src/features/terminal/terminalSurface/useSplitDrag.ts"
    op: create
  - path: "src/features/terminal/terminalSurface/useTerminalSearch.ts"
    op: create
  - path: "src/features/terminal/terminalSurface/TerminalGhost.tsx"
    op: create
  - path: "src/features/terminal/terminalSurface/sessionId.ts"
    op: create
  - path: "src/__tests__/new_tab_intent.test.ts"
    op: update
related: []
tags:
  - "refactor"
  - "file-size-debt"
  - "terminal"
  - "optimization-round-2"
  - "parallel-session"
  - "mcp-tool"
---
[x] TerminalSurface.tsx 1,445 → 756줄 — terminalSurface/ 훅 6·하위 컴포넌트 2, 효과 순서 전역 보존

## 동기

최적화 원장 §2.3 `{#file-size-debt}` 상위 7 중 `TerminalSurface.tsx`(1,445줄) — 타이밍 민감 컴포넌트(xterm fit·PTY resize·크기 마커 재생·IME). 병렬 세션 TS 가 worktree 에서 구현, 커밋 `02eae369`.

## 변경 요약

`TerminalSurface.tsx` **756줄**(오케스트레이터: props·탭/페인 조작·renderPane·JSX) + `terminalSurface/` 9파일: `useSessionMove` 430(세션 이동 드래그: 기하·rAF 히트테스트·고스트 루프·리스너/언마운트 정리) · `useTerminalKeys` 144(⌘W/⌘T 인텐트 체인 + keydown, `rootRef` 소유) · `TerminalSearchBar` 103(⌘F 오버레이, `formatMatchCount` 는 TerminalSurface 에서 재수출해 테스트 import 경로 불변) · `useDispatchPrefill` 75 · `usePaneStates` 69 · `useSplitDrag` 42 · `useTerminalSearch` 40 · `TerminalGhost` 32 · `sessionId` 14.

- 공개 표면(props·export·DOM·CSS 클래스·i18n 키) 불변, `TerminalInstanceImpl` 무변경.
- 옮긴 코드는 `HEAD:` 에서 줄 범위로 잘라 붙였다(재타이핑 아님). 줄 단위 대조에서 의도한 이음새만: import 재배치, `newId` export, `runtime.currentProjectId`→`projectId` 인자 3줄, `{ghostLabel}`→`{label}` prop, 주석 상호참조 1줄, 아래 reap deps.
- **효과 순서 전역 보존** — 각 훅은 자기가 품은 효과가 있던 자리에서 호출된다(pump → agentRuns → ensure-tab → reap → move 리스너/고스트 정리 → close/newTab/keydown → shellActive).
- reap 효과는 본문에 남김(훅으로 옮기면 pump/ensure-tab 앞으로 밀린다). `usePaneStates` 가 돌려주는 setter/ref 를 exhaustive-deps 가 안정으로 못 보므로 deps 에 추가 — 전부 `useState` setter·`useRef` 객체라 재실행 조건은 여전히 `terminalTabs` 뿐(게이트 `--max-warnings=4` 기준선 유지).
- `new_tab_intent.test.ts` 소스 가드 경로만 `terminalSurface/useTerminalKeys.ts` 로.

## 검증

- `pnpm typecheck` 0 · `pnpm lint` 7게이트 0(파일 크기 기준 HEAD 대비 clean, eslint 경고 4 = 기준선).
- `TerminalSurface` 참조 4파일 + `terminal_*` 10스위트 + `dispatch_handoff`·`term_pane_drop`·`close_intent` = **16파일 226 테스트 통과**.
- 미검증: 드래그·확대·IME 타이밍은 실기기 육안(#eyes-split-regression). 본문의 낡은 주석("이 파일은 이미 한계 초과") 은 순수 이동 규칙대로 그대로 둠 — 다음 손질 때 지울 것.