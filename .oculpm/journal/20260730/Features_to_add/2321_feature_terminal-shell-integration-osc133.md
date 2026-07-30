---
schema_version: 1
type: feature
slug: "terminal-shell-integration-osc133"
status: done
difficulty: high
created_at: "2026-07-30T23:21:15+09:00"
session_id: "mcp-20260730-232115"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/shell_integration/mod.rs"
    op: create
  - path: "src-tauri/src/oculpm/shell_integration/templates/oculpm.zsh"
    op: create
  - path: "src-tauri/src/oculpm/shell_integration/templates/oculpm.bash"
    op: create
  - path: "src-tauri/src/commands/shell_integration.rs"
    op: create
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager.rs"
    op: update
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src/features/terminal/oscShell.ts"
    op: create
  - path: "src/features/terminal/shellStatus.ts"
    op: create
  - path: "src/features/terminal/agentDetect.ts"
    op: create
  - path: "src/features/terminal/useAgentRuns.ts"
    op: create
  - path: "src/features/terminal/fileLinks.ts"
    op: create
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/lib/journalCompose.ts"
    op: create
related: []
tags:
  - "terminal"
  - "osc133"
  - "shell-integration"
  - "agent-detection"
  - "mcp-tool"
---
[x] 터미널 셸 통합(OSC 133/7) — 명령 경계·에이전트 감지·file:line 링크

## 추가 기능

내장 터미널이 **명령의 시작·끝·종료코드·작업 디렉터리**를 알게 됐다. 그 위에 에이전트 실행 감지와 `file:line` ⌘클릭을 올렸다.

- **셸 통합 (OSC 133/7)** — 설정 → 연동에서 옵인. 사용자 rc 에 심는 건 *비활성 한 줄*뿐이고, 그 줄은 `OCULPM_SHELL_INTEGRATION` 이 설정된 ocul-pm 의 PTY 에서만 동작한다. iTerm2·Terminal.app 에서는 아무 일도 하지 않는다.
- **명령 상태바** — 실행 중 / 완료·소요시간 / 실패, `128+N` 은 시그널 이름(`SIGINT`)으로.
- **에이전트 감지** — `claude`/`cursor-agent`/`gemini`/`codex`/`aider` 등을 명령 위치에서 식별해 `hook_agent_active`·`hook_agent_ended` 를 쏜다. 훅 브리지가 없는 에이전트도 세션 경계를 실측으로 갖는다.
- **`file:line` 링크** — `src/lib/foo.ts:42` ⌘클릭 → 외부 편집기의 해당 줄.

## 동작 흐름

1. `start_pty_session` 이 PTY 에 `OCULPM_TERM=1`·`OCULPM_NONCE=<uuid>`·`OCULPM_SHELL_INTEGRATION=<경로>` 를 심고, nonce 를 프런트에 돌려준다.
2. 사용자 rc 의 비활성 한 줄이 그 변수를 보고 스크립트를 source → precmd/preexec 훅이 OSC 133 A/B/C/D 와 OSC 7 을 쏜다.
3. `oscShell.ts` 가 파싱 → nonce 가 맞는 것만 리듀서에 넣는다.
4. `useAgentRuns` 가 명령 전이를 보고 에이전트 실행을 추적한다.

### 설계에서 특히 신경 쓴 것

- **ZDOTDIR 우회를 쓰지 않았다.** VS Code 방식은 실패했을 때 "통합이 안 됨"이 아니라 "터미널을 못 씀" 등급의 사고가 된다(PATH 뒤바뀜·HISTFILE 분기·`${ZDOTDIR:-$HOME}` 를 읽는 프레임워크 오작동). 비활성 한 줄은 최대 피해가 "안 켜짐"으로 묶인다.
- **PS1 을 건드리지 않았다.** precmd/preexec 만 쓰므로 powerlevel10k·starship 과 부딪히지 않는다.
- **nonce 없으면 전부 불신.** 터미널로 흘러드는 바이트는 적대적 입력이다 — `cat evil.txt` 하나로 가짜 명령 경계를 주입할 수 있다. 예외를 두지 않으려고 페이로드가 없는 `133;B` 에도 nonce 를 실었다. OSC 7 은 표준에 nonce 자리가 없어 표시용 힌트로만 쓰고, 경로 해석에는 검증된 `133;A` 의 cwd 만 쓴다.
- **OSC 핸들러는 동기로 `true` 반환.** Promise 를 돌려주면 xterm 파서가 그 시퀀스에서 멈춰 터미널 출력 전체가 정지한다. 소비처 콜백은 microtask 로 밀었다.
- **nonce 를 스크롤백 리플레이보다 먼저 세운다.** 순서가 뒤바뀌면 화면을 떠났다 돌아올 때마다 통합이 꺼진 것처럼 보인다.
- **에이전트 감지는 15초 문턱.** `claude --version` 까지 세션으로 만들면 유령 세션이 쌓인다 — 이미 겪은 실패다. 판정은 명령 *위치의 토큰만* 본다(`echo claude`·`git commit -m "ask claude"` 는 실행이 아니다).
- **자동으로 일지를 쓰지 않는다.** 터미널에서 띄운 에이전트는 transcript 가 없어 요약할 재료가 없다. 1분 이상 돌았을 때 "일지 남기기"를 제안만 한다.

### 정직성 수정

툴바 문구가 "에이전트 실행을 감지해 자동으로 일지를 작성합니다" 였는데, PTY 쪽에 감지 코드가 한 줄도 없었고 `auto_journal_draft` 기본값도 false 였다. 이제 통합이 실제로 켜진 세션에서만 그렇게 말한다.

곁다리로 죽은 경로 하나를 수리했다 — ⌘K 팔레트의 '새 일지'가 이벤트만 쏘고 듣는 곳이 없어 무동작이었다. `journalCompose` 의 sticky one-shot 으로 바꿔 작업 일지 화면이 마운트 전이어도 요청이 살아남는다.

## 검증

- `cargo test` 431 passed / 0 failed (셸 통합 11건 + 편집기 10건 신규), 프런트 `vitest` 38 files / 332 tests passed (OSC 파서 40 · 에이전트 감지 13 · 링크 스캐너 14 신규).
- `pnpm typecheck` / `pnpm lint` / `pnpm build` 전부 exit 0 — 커밋 `5b4f1ec`·`d7fd19c` 를 분리된 git worktree 에 체크아웃해 다른 세션 변경분이 섞이지 않은 상태로 재확인.
- 실기기(앱에서 rc 설치 → 실제 OSC 수신 → 상태바 갱신) 확인은 아직 안 했다.