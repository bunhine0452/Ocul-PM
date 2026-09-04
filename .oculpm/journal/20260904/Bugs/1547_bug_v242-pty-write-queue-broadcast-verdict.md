---
schema_version: 1
type: bug
slug: "v242-pty-write-queue-broadcast-verdict"
status: done
difficulty: superhigh
created_at: "2026-09-04T15:47:37+09:00"
session_id: "20260904-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "a7a49ff0-edf2-49a1-a1f7-e2c9be2e746a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/host.rs"
    op: update
  - path: "src-tauri/src/ptyhost/writer.rs"
    op: create
  - path: "src-tauri/src/ptyhost/scrollback.rs"
    op: create
  - path: "src-tauri/src/ptyhost/mod.rs"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/tests/ptyhost_write_backpressure.rs"
    op: create
  - path: "docs/20260904_v242-load-bearing/perf-baseline.md"
    op: correct
related: []
tags:
  - "ptyhost"
  - "terminal"
  - "lock-scope"
  - "v2.42.0"
  - "mcp-tool"
---
[x] 붙여넣기 한 번이 모든 터미널을 끊던 것 — 그리고 브로드캐스트는 죄가 없었다

## 발생 원인

플랜은 "전역 세션 뮤텍스를 잡은 채 `write_all`+`flush`" 만 지적했지만, **락만 좁혀서는
증상이 안 없어진다.**

`handle_request` 는 `serve_connection` 의 읽기 루프 안에서 **동기로** 돈다. 그래서 막힌
`write_all` 은 락과 무관하게 **그 접속의 뒤에 온 모든 프레임**을 세운다. 그리고 앱의
`REQUEST_TIMEOUT_SECS = 10` 이 지나면 `client.rs` 가 `alive=false` 를 세우고 접속을 통째로
버린다 — 그게 "붙여넣기 한 번이 모든 터미널 연결을 끊는다" 의 기계적 경로다.

**언제 막히는지 직접 재현했다** (macOS 25.6 / Apple Silicon, python3 `pty.fork` 하니스):

| 자식 tty 상태 | 1 MB 쓰기 결과 |
|---|---|
| canonical (기본) | 64 MB 를 1.67 s 에 삼킴, 블록 없음 |
| `stty raw` + 읽지 않는 포그라운드 | **5초 후 0 바이트, 여전히 블록** |

즉 vim·less·도구 호출 중인 에이전트 — 터미널의 **가장 흔한 상태** — 에서만 막히고,
거기서는 **무기한** 막힌다.

## 해결 방법

락 스코프 축소 **와** 쓰기를 요청 처리기 밖으로 내는 것, 둘 다 했다.

- `ptyhost/writer.rs`(신규) — 세션별 PTY 쓰기 큐. 전용 OS 스레드 + `sync_channel(1024)`.
  `enqueue()` 는 **절대 블록하지 않고**, 쓰기 실패는 latch 로 잡아 다음 `enqueue` 에서
  올린다. 순서 계약(키 입력 순서)은 큐가 FIFO 이고 소비자가 하나뿐이라 유지된다.
- `Request::Write` 는 이제 락을 **핸들 복제 동안만** 잡는다. `Request::Attach` 도 같은
  관용구로 통일했다(200 KB 스냅샷을 락 밖으로) — 다만 그건 µs 단위 memcpy 라 **성능
  개선으로 주장하지 않는다.**
- `Request::Resize` 는 **의도적으로 그대로** 뒀다. `TIOCSWINSZ` ioctl 은 블록하지 않는다.

**행동 변화 하나** — `write_to_pty` 의 `Ok` 는 이제 "PTY 가 받았다"가 아니라 "순서대로 갈
자리에 들어갔다"는 뜻이다. 미지의 세션 오류는 **여전히 동기**라 `dispatchTarget.ts:103` 과
`TerminalInstanceImpl` 이 의존하는 계약은 그대로다. PTY 쓰기 자체의 실패만 한 번 늦게
올라온다. `writeDispatchTo` 는 쓰기 전에 `ptyForegroundCommand` 로 생존을 확인하므로
**프런트 변경은 필요 없다.**

## `{#pty-broadcast-scope}` — 전제가 죽었다. 코드를 바꾸지 않았다

플랜은 "열린 모든 웹뷰가 모든 세션의 모든 청크를 역직렬화한다" 고 적었다. **`Cargo.lock`
이 핀한 tauri 2.11.2 소스를 직접 읽어 확인한 결과 그런 일은 일어나지 않는다.**

1. `emit_js_filter` 는 웹뷰마다 `js_listeners.get(label).and_then(|s| s.get(event))` 가
   비면 **그 웹뷰를 통째로 건너뛴다**(`src/event/listener.rs:283`). 이벤트 이름이
   `pty-data-{sid}` 로 **세션별**이므로, 그 세션을 그리지 않는 창에는 스크립트조차 안 간다.
2. `emit_to` 로 바꿔도 **전달이 줄지 않는다.** 프런트 `listen()` 은 target 을 안 주면
   `{kind:'Any'}` 로 등록하고(`@tauri-apps/api` 2.11.0 `event.js:75`),
   `match_any_or_filter` 는 `Any` 를 **필터와 무관하게 통과**시킨다(`listener.rs:310`).
3. 게다가 **한 세션을 두 웹뷰가 동시에 그릴 수 있다** — 도크와 분리된 터미널 창. 라벨
   하나로 좁히면 나머지가 **조용히 청크를 잃는다.**

즉 현행(브로드캐스트)이 정답이다. 근거를 `commands/terminal.rs` 의 `on_event` 자리에
주석으로 못박아 다음 감사가 같은 항목을 다시 올리지 않게 했고, `perf-baseline.md` 의 판정도
"확정(미측정)" → **"죽음"** 으로 정정했다.

**이 판정은 측정이 아니라 소스 판정이다.** 청크 실측률과 동시 웹뷰 수는 여전히 미측정이다.

## 검증

`cargo test --test ptyhost_write_backpressure` 5 passed · `cargo test --test ptyhost_reattach`
5 passed(기존 계약 회귀) · `cargo test --lib ptyhost::` 23 passed ·
`cargo clippy --lib --no-deps` 경고 0 · `cargo check --tests` OK · `pnpm lint:filesize` clean.

**테스트가 헛돌지 않는다는 반증 시도**: `enqueue` 를 임시로 동기 쓰기로 되돌리니 같은
테스트가 **10분 타임아웃까지 매달렸다**. 복원 후 shasum 으로 동일성을 확인했다. 그 경험을
받아 ① 매달리는 대신 실패하도록 `recv_timeout` 을 쓰고 ② 막힌 세션의 큐가 실제로 가득
차는지를 단언해, tty 가 안 막혔으면 픽스처가 죽은 것을 먼저 알려 준다.

래칫: `host.rs` 1,179 → **1,142(−37)**. 처음 편집 뒤 +6 이었는데 주석을 지워 맞추는 대신
`SessionBuf` 를 `scrollback.rs` 로 통째로 옮겼다.

## 확인 못 함 (앱 미실행)

큰 붙여넣기(raw 모드 세션에 수백 KB — 다른 탭이 계속 반응하는지, 나중에 순서대로 온전히
들어가는지) · 한국어 IME 조합/확정 순서 · 리사이즈와 타이핑이 겹칠 때 · `Kill`/`KillPrefix`
뒤 셸이 실제로 죽는지(writer fd 닫힘이 쓰기 스레드로 미뤄졌다) · 큐 포화 오류 문구가 화면에
어떻게 보이는지(영어 그대로 — 기존 `unknown pty session` 과 같은 결).