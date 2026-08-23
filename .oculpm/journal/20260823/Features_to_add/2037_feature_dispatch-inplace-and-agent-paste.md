---
schema_version: 1
type: feature
slug: dispatch-inplace-and-agent-paste
status: done
difficulty: medium
created_at: "2026-08-23T20:37:00+09:00"
session_id: "manual-20260823-203700"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/src/commands/retro.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/terminal/dispatchTarget.ts"
    op: create
  - path: "src/features/terminal/activePane.ts"
    op: create
  - path: "src/features/terminal/dispatchBus.ts"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/retro/RetroScreenV2.tsx"
    op: update
  - path: "src/features/onboarding/GreenfieldWizard.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/dispatch_handoff.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags: [terminal, planner, dispatch, dogfooding]
---

[x] 플래너 ▶실행 — 열려 있는 터미널 자리에 꽂고, 돌고 있는 에이전트에는 본문을 붙여넣기

## 추가 기능

디스패치(IN2)는 지금까지 한 가지 동작뿐이었다: 터미널 **화면**으로 데려간 뒤 셸
프롬프트에 `claude "$(cat '…')"` 를 프리필. 도그푸딩에서 두 군데가 걸렸다.

1. **⌘J 도크를 열어 둔 사람의 화면을 빼앗는다.** 셸은 이미 눈앞에 있는데 ▶실행이
   플래너를 걷어내고 터미널 화면으로 점프했다. 이제 터미널이 이미 보이면
   (도크·터미널 화면·분리 창) **화면을 옮기지 않고** 그 자리에 프리필한다.
2. **돌고 있던 Claude Code 세션을 무시한다.** 대화 중인 세션에 한 줄 명령을 밀어
   넣으면 에이전트가 그걸 텍스트로 받거나, 사용자가 세션을 끝내고 `claude` 를 새로
   띄워야 했다. 이제 대상 페인에서 코딩 에이전트가 돌고 있으면 **프롬프트 본문을
   그대로 붙여넣는다** — 쌓아 둔 맥락을 버리지 않는다.

어느 쪽이든 **실행(Enter)은 사용자가 한다**는 계약은 그대로다.

## 동작 흐름

- 백엔드 `pty_foreground_command` 신설 — tty 의 포그라운드 프로세스 그룹
  (`tcgetpgrp`, portable-pty `process_group_leader`)을 보고 `ps -o args=` 로 명령줄을
  돌려준다. **셸 통합(OSC 133)이 꺼져 있어도** 답할 수 있어야 해서 이 신호를 골랐다
  (iTerm2·VS Code 와 같은 근거). 판정은 프런트 `agentDetect.ts` 가 — 셸 통합 경로와
  규칙을 하나로 유지한다.
- `DispatchPrompt` 에 `prompt`(본문) 추가. plan·retro 두 생산자가 함께 쓴다.
- `dispatchTarget.ts` — `choosePayload`(에이전트면 bracketed paste, 아니면 한 줄 명령),
  `handoffDispatch`(살아있는 sid 에 직접 write, 없으면 대기열), `terminalOnScreen`
  (화면 이동이 필요한가).
- 본문은 `ESC[200~ … ESC[201~` 로 감싼다. 안 감싸면 줄마다 Enter 로 읽혀 프롬프트가
  조각난 채 전송된다. 본문에 섞이는 일지 발췌는 남의 파일에서 온 바이트라 ESC 를
  포함한 제어문자를 걷어낸다(개행·탭만 남김).
- `dispatchBus` 에 구독 추가 — 예전엔 마운트 시점만 봐서, 도크를 **열어 둔 채**
  대기열로 간 건은 아무도 집어가지 않았다. `activePane.ts` 로 sid 계산을 공용화해
  터미널을 그리지 않는 화면도 대상 페인을 안다.

## 검증

- `pnpm vitest run src/__tests__/dispatch_handoff.test.ts` 18/18 — payload 선택,
  ESC 정제, 화면 이동 판정, sid 해석, 핸드오프 4경로, 버스 구독.
- `cargo test` 742+ 전부 통과 (`ps` 배관 테스트 2건 신규). `pnpm typecheck` / `pnpm lint`
  / `pnpm build` exit 0.
- bracketed paste 가정을 실측으로 확인: pty 에 `claude` 를 띄워 시작 출력에
  `ESC[?2004h`(붙여넣기 모드 켬)가 있음을, 그리고 `tcgetpgrp` → `ps -o args=` 가
  `…/bin/claude` 를 돌려줌을 확인 (basename 이 `claude` 라 `detectAgent` 가 잡는다).

## 메모

- 프런트 전체 스위트에서 `code_screen.test.tsx` 가 실패하지만 이 작업과 무관하다 —
  병렬 세션이 작업 중인 `CodePane.tsx` 의 `refreshGutter` TDZ 오류다.
- 셸 통합이 꺼져 있어도 동작하지만, `ps` 를 못 읽는 환경(윈도우)에서는 `None` 을
  돌려 **종전 동작(한 줄 명령)** 으로 조용히 되돌아간다.
