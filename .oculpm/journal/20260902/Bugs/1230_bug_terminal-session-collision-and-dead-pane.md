---
schema_version: 1
type: bug
slug: "terminal-session-collision-and-dead-pane"
status: done
difficulty: high
created_at: "2026-09-02T12:30:02+09:00"
session_id: "20260902-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/terminalLaunch.ts"
    op: update
  - path: "src/features/today/TodayTerminal.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstance.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_launch.test.ts"
    op: update
  - path: "src-tauri/src/ptyhost/host.rs"
    op: update
  - path: "src-tauri/src/ptyhost/client.rs"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
related: []
tags:
  - "terminal"
  - "ptyhost"
  - "session"
  - "regression"
  - "mcp-tool"
---
[x] Today 빠른 터미널이 프로젝트를 가로질러 같은 셸을 나눠 쓰던 것 · 끝난 셸이 먹통으로 남던 것

사용자가 「터미널 기능에 버그가 있는지 확인」을 요청해 표면 전체(PTY 호스트 · 커맨드 · xterm 배관 · 화면)를 훑고, 확정된 결함 6건을 고쳤다.

## 발생 원인

**① 고정 세션 id `today-quick`** — 이 위젯은 2026-06-06 것이고 `p<projectId>-` 접두사 규격은 2026-08-13 창·탭 작업에서 생겼다. 그 사이에 낀 유일한 잔재였다. 프로젝트 탭은 한 번 활성화되면 계속 마운트돼 있으므로(`TabbedWindow` 의 `everActive`) A·B 탭에서 각각 펼치면 **같은 sid 로 attach** 해 한 PTY 에 xterm 둘이 붙었다 — B 에 친 명령이 A 의 디렉터리에서 돌고, 이 위젯은 접을 때 세션을 죽이므로(비영속) 그 kill 이 남의 셸을 데려갔다. 접두사가 없어 프로젝트 탭을 닫아도 정리되지 않았다.

**② 끝난 셸이 좀비 페인으로 남았다** — `pty-exit-{sid}` 의 소비처는 `[프로세스 종료됨]` 한 줄을 버퍼에 쓰는 것이 전부였다. 탭은 남고 PTY 만 사라지므로 이후 입력은 `void commands.writeToPty(...)` 로 나가 백엔드의 `unknown pty session` 이 조용히 버려졌다 — 눈에는 그냥 먹통이고, 탭을 닫았다 여는 것 말고 되살릴 길이 없었다.

**③ `Shutdown` 이 세션을 안 죽이고 내려갔다** — `sessions.clear()` 는 맵만 비운다. `terminate_session` 의 SIGHUP→유예→SIGKILL→`wait` 을 안 타므로, 프로토콜 불일치로 구버전 호스트를 회수하는 길에서 HUP 을 무시하는 포그라운드(vim·ssh·도구 호출 중인 claude)가 고아로 남았다. 게다가 소켓 파일을 남긴 채 200ms 뒤 종료해서, 그 창에 뜬 교체 호스트는 bind 에 실패하고 아직 살아 있는 우리에게 접속돼 「이미 호스트가 있다」며 물러났다 — 잠시 뒤 아무도 남지 않는다.

**④ resize 실패가 성공으로 둔갑했다** — `resize_pty` 가 `Ok(Response::Error)` 만 에러로 접고 타임아웃·접속 끊김은 `Ok(())` 로 돌려줬다. 프런트 큐는 그 크기를 「보냈다」로 기억해 같은 값을 다시 보내지 않으므로 PTY 가 옛 폭에 굳는다 — `ptyResize.ts` 가 존재하는 이유인 그 깨진 화면이다. 프런트 쪽에도 짝이 있었다: 생성된 커맨드는 실패해도 봉투로 resolve 하므로 큐가 거부를 볼 수 없었다.

**⑤ 이벤트 리스너 누수** — `unlistenData = await listen(...)` 직후의 `if (!isMounted) return;` 이 리스너를 걷지 않고 빠져나갔다. 정리 함수는 이미 `null` 을 보고 지나간 뒤라 리스너가 영영 남는다.

**⑥ 죽은 호스트 접속이 안 닫혔다** — 요청 타임아웃은 `alive=false` 만 세우고 클라이언트를 슬롯에서 뺀다. 읽기 태스크가 `read()` 에 파킹된 채 살아 있어 소켓이 열린 그대로 남고, 호스트의 클라이언트 수가 줄지 않아 **유휴 자동 종료(클라이언트 0 · 세션 0)가 영영 안 걸렸다.**

함께 고친 방어 2건: 컨테이너가 0 크기일 때 `term.open()` 재시도 경로가 없어(옵저버 둘 다 `openedRef` 를 먼저 본다) 영구 빈 터미널이 될 수 있었고, `term.onData` 등록이 attach/start 왕복 **뒤**라 그 사이 키 입력이 사라졌다.

## 해결 방법

- `todayQuickSessionId(projectId)` 신설 (`p<id>-today`) — 프로젝트마다 자기 셸. `TodayTerminal` 이 `projectId` 를 받는다.
- `onExit` 프롭 → 화면이 `ended` 를 들고 페인 위에 «다시 시작» 알약(`.term-ended`)을 얹는다. 다시 시작은 `restartNonce` 를 올려 **제자리 재마운트** — sid 가 그대로라 attach→(없음)→start 로 새 셸이 선다. 죽은 셸의 shellState·신호는 함께 걷는다.
- `shutdown_sessions()` 추출 — Kill 과 같은 종료 계약. Shutdown 은 ① 소켓 파일을 먼저 지워 자리를 비우고 ② 세션을 실제로 끝내고 ③ 유예(KILL_GRACE+700ms)가 지난 뒤 exit 한다. `HostState.socket` 에 점유한 경로를 기억한다.
- `resize_pty` 는 전송 실패를 `?` 로 올린다. 프런트 sender 는 봉투를 풀어 `throw` 한다.
- 리스너는 `if (!isMounted) return off();` 로 직접 걷는다.
- `PtyHostClient` 에 `Drop` 추가 — 읽기 태스크를 abort 해 소켓을 놓는다.
- `openTerminal()` 을 컴포넌트 스코프로 빼고 ResizeObserver·IntersectionObserver 가 같은 함수를 부른다(크기가 생기는 순간 연다). `term.onData` 는 마운트 즉시 등록하고 PTY 가 설 때까지 최대 256청크를 큐에 받아 뒀다 흘린다.

## 검증

- `cargo test` 전체 통과(신규 3건 포함: shutdown 이 포그라운드까지 죽이고 회수하는지, serve 가 소켓 경로를 기억하는지). `cargo fmt` · `clippy -D warnings` 초록.
- 프런트: 터미널·Today·i18n 10개 스위트 141건 통과, 신규 `todayQuickSessionId` 3건 포함. `pnpm lint` 3종 통과.
- 반증 시도: 「Write 가 전역 락을 쥔 채 블로킹해 호스트 전체를 멈춘다」는 가설은 실제 호스트·PTY·소켓으로 재현 테스트를 붙여 확인했으나 **재현되지 않아**(tty 입력 큐는 차면 버리지 writer 를 막지 않는다) 결함 목록에서 뺐다. 임시 테스트는 지웠다.

## 메모

- `pnpm typecheck` 와 `pnpm test` 전량은 **다른 세션이 동시에 진행 중인 디자인 라운드**(Icons `Sparkles`/`FolderPlus` 미노출, `today.subhead`→`subheadIdle` 키 개명) 때문에 붉다. 내가 손댄 파일에는 오류가 0건이고, 실패 스위트 3개(start_screen·mcp_settings·claude_hooks_settings)는 전부 그쪽 미완 편집이 원인이다 (`ReferenceError: FolderPlus is not defined`).
- 남은 이월: 컨테이너 0 크기 마운트의 실사용 재현 경로는 끝내 특정하지 못했다 — 고친 것은 경로 자체이고 증상 재현은 아니다.