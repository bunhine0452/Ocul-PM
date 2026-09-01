---
schema_version: 1
type: bug
slug: terminal-resize-storm-garbles-output
status: done
difficulty: high
created_at: 2026-09-01T19:18:00+09:00
session_id: manual-20260901-191800
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src/features/terminal/ptyResize.ts
    op: create
  - path: src/features/terminal/TerminalInstanceImpl.tsx
    op: update
  - path: src/__tests__/terminal_pty_resize.test.ts
    op: create
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related:
  - .oculpm/journal/20260820/Bugs/2305_bug_terminal-viewport-stale-after-tab-return.md
  - .oculpm/journal/20260825/Features_to_add/1130_feature_pty-host-survive-restart.md
  - .oculpm/journal/20260720/Features_to_add/1957_feature_terminal-overhaul-panes-persist.md
tags:
  - terminal
  - xterm
  - pty
  - resize
  - claude-code
---

[x] 터미널을 줄였다 키우면 글자가 깨지고, claude code 출력이 두 번 찍히던 문제

신고 세 가지 — ① 페인 크기를 줄였다 키우면 텍스트가 깨진다 ② 터미널에서
claude code 를 쓰면 뱉어낸 텍스트가 두 번씩 보인다 ③ 위를 보려고 스크롤하면
제대로 안 보인다. ①·③ 과 ② 의 상당 부분은 **뿌리가 하나**였다.

## 발생 원인

### PTY 크기 통보가 순서 없이 날아갔다 (①·③, ② 의 큰 몫)

분할 막대를 끌면 `pointermove` 마다 페인 `flexGrow` 가 바뀌고
(`TerminalSurface.tsx:998`) `ResizeObserver` 가 프레임마다 깨어난다. 종전 코드는
그때마다 `fit()` 을 돌리고 새 치수를 **fire-and-forget** 으로 던졌다:

```ts
void commands.resizePty(sessionId, term.rows, term.cols);   // ← 순서 보장 없음
```

tauri 비동기 커맨드는 하나하나가 별도 tokio 태스크다. 20 번을 연달아 던지면
`PtyState::client()` 뮤텍스와 호스트 소켓에 닿는 순서는 태스크 스케줄링이
정한다. **마지막에 도착한 것이 중간 크기일 수 있고, 그러면 PTY 는 그 크기로
굳는다.**

여기서부터가 신고 내용 그대로다. PTY 폭과 xterm 폭이 어긋나면 claude code 처럼
커서를 위로 올려 자기 화면을 다시 그리는 TUI 는 전부 틀린다 —
`process.stdout.columns` 로 "몇 줄을 지워야 하나"를 계산하는데 실제 화면은 다른
폭으로 접히니 지웠다고 믿은 줄이 남는다. 그게 **같은 텍스트가 두 번 보이는**
것이고(②), 그 잔해가 그대로 스크롤백에 쌓이니 위로 올려도 깨진 채다(③).

크기가 실제로 바뀔 때마다 `fit()` 이 도는 것 자체도 문제였다. `FitAddon.fit()`
은 치수가 달라지면 `Terminal.resize()` 를 부르고, xterm 은 스크롤백 전체를
접었다 폈다(리플로) 하며 `ydisp` 를 다시 잡는다. 드래그 한 번에 그걸 열몇 번
왕복시키고 그때마다 SIGWINCH 로 전체화면 다시 그리기를 시켰다.

### 재접속 때 seq 걸러내기가 큐에만 걸려 있었다 (② 의 나머지)

`attachPtySession` 스냅샷과 라이브 이벤트의 중복은 `seq` 로 거르게 돼 있는데,
그 필터가 **`attached = true` 이전에 큐에 쌓인 것에만** 걸렸다. 그 뒤 도착하는
청크는 `term.write` 로 직행한다:

```ts
if (!attached) queued.push(e.payload);
else term.write(e.payload.text);        // ← seq 확인 없음
```

스냅샷을 뜨기 전에 방출된 청크가 커맨드 응답보다 늦게 도착할 수 있고, 그러면
스냅샷 꼬리가 화면에 한 번 더 찍힌다. 같은 구멍이 pty-host 재접속 구간에서도
열린다 — 죽은 것으로 표시된 접속의 리더 태스크는 소켓이 실제로 닫힐 때까지
`on_event` 를 계속 부르므로(`commands/terminal.rs:77` 의 `app.emit` 은 전역
브로드캐스트다), 새 접속과 겹치는 동안 **같은 seq 의 청크가 두 번** 온다.

## 해결 방법

### `ptyResize.ts` — 직렬화 + 합치기 (신규)

세션 하나당 하나의 큐. 한 번에 한 요청만 날리고(응답이 와야 다음), 그 사이 쌓인
희망 크기는 **마지막 하나로 접는다**. 중간 크기는 건너뛰거나 곧바로 최종
크기로 덮이므로, 마지막에 PTY 가 받는 것은 언제나 손을 뗀 그 크기다.

- 직전에 보낸 것과 같은 크기는 보내지 않는다 — SIGWINCH 한 번이 전체화면
  TUI 에게는 화면 전체 다시 그리기라, 의미 없는 통보가 곧 깜빡임이다.
- 실패하면 "보낸 크기" 기억을 지운다. 같은 크기가 다시 밀려오면 그때 한 번 더
  시도하되, **여기서 스스로 재시도 루프를 돌지는 않는다** — 죽은 호스트를
  상대로 무한히 두드릴 이유가 없다.
- `reset()` 은 세션이 새로 뜬 직후에 부른다. PTY 가 바뀌면 그 기억은 남의 것이다.
- 0·음수·NaN 은 내보내지 않는다 (렌더러가 준비되기 전 `fit()` 이 내놓는 값).

커맨드를 직접 잡지 않고 sender 를 주입받는다 — 순수하게 테스트할 수 있고,
`lint:bindings` 규약(신규 모듈의 `commands` 직접 import 금지)도 지킨다.

### `TerminalInstanceImpl.tsx`

- `resizePty` 직접 호출 5곳을 전부 큐로 돌렸다.
- `ResizeObserver` 는 **처음 한 번 즉시 + 멎은 뒤 한 번**(`RESIZE_SETTLE_MS`
  60ms)으로 묶는다. 창 크기 조절·도크 토글·⌘+/⌘- 같은 한 방 변화는 굼떠
  보이지 않고, 드래그 중의 중간 치수는 리플로도 SIGWINCH 도 타지 않는다.
- `writeChunk()` 를 세워 **큐를 비운 뒤에도 seq 걸러내기를 유지**한다. 늦게
  도착한 스냅샷 구간 청크도, 겹친 호스트 접속이 두 번 보낸 청크도 여기서 걸린다.

`IntersectionObserver` 되맞춤 경로(2026-08-20 일지)는 즉시 `fit()` 그대로 뒀다 —
한 방 사건이라 묶을 이유가 없고, `resyncViewport` 순서를 건드리면 안 된다.

## 검증

`pnpm typecheck` exit 0 · `pnpm test` 141 파일 / **1722 통과** ·
`check-no-hardcoded-korean` 통과.

새 테스트 `terminal_pty_resize.test.ts` 8건이 큐 규약을 못박는다 — 응답 전 다음
통보 없음 / 쌓인 것은 마지막 하나로 접힘 / 80→120 을 41번 밀어도 PTY 가 받는
마지막은 120 / 같은 크기 재전송 없음 / `reset` 후엔 같은 크기도 다시 감 /
실패 시 기억 삭제 / 0·NaN 차단 / `dispose` 후 무전송.

`pnpm lint` 는 `lint:bindings` 에서 붉지만 **이 변경과 무관**하다 — 병렬 세션의
미추적 WIP(`src/api/plugins.ts`, `src/features/deeplink/DeepLinkSheet.tsx`)를
짚는다. 신규 `ptyResize.ts` 는 `commands` 를 import 하지 않는다.

**육안 확인 미완** — 설치본이 도는 동안 dev 빌드를 띄우지 않는다는 규율에 따라,
실제 드래그 리사이즈와 claude code 세션에서의 확인은 사용자 몫으로 남긴다.

## 메모

같이 확인했지만 **이번에 손대지 않은** 것:

- **스티키 명령 헤더가 첫 줄을 가린다.** `.term-block-sticky` 는
  `position:absolute; top:0` 로 `.term-pane` 위에 뜬다(`screens.css:1508`). 셸
  통합이 켜진 세션에서 스크롤을 올리면 뷰포트 맨 윗줄 ~1.3행을 덮는다. 신고
  ③ 의 다른 해석일 수 있으나, 레이아웃을 차지하면 페인 높이가 줄어 PTY 가
  resize 된다는 이유로 **의도적으로** 떠 있는 설계라(`screens.css:1415` 주석)
  임의로 뒤집지 않았다. 사용자 확인이 필요하다.
- **`FitAddon` 이 오버뷰 룰러 폭을 14px 로 가정한다.** 우리는
  `overviewRulerWidth: 10` 인데 xterm 5.5 에는 fit 이 읽는
  `options.overviewRuler` 키가 없어 기본값 14 로 떨어진다. 폭이 4px 남을 뿐
  깨짐은 아니라 그대로 뒀다.
- **호스트 쪽 겹침의 근본 수리는 안 했다.** 죽은 접속의 리더 태스크는
  `OwnedWriteHalf` drop → `shutdown(Write)` → 호스트 EOF 로 스스로 정리되지만,
  그 사이 창에서는 이벤트가 두 번 나간다. 프런트 seq 필터가 그걸 흡수한다.
