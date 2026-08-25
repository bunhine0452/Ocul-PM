---
schema_version: 1
type: feature
slug: pty-host-survive-restart
status: done
difficulty: superhigh
created_at: "2026-08-25T11:30:00+09:00"
session_id: "manual-20260825-111308"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/mod.rs"
    op: create
  - path: "src-tauri/src/ptyhost/protocol.rs"
    op: create
  - path: "src-tauri/src/ptyhost/host.rs"
    op: create
  - path: "src-tauri/src/ptyhost/client.rs"
    op: create
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/commands/window.rs"
    op: update
  - path: "src-tauri/src/main.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/tests/ptyhost_reattach.rs"
    op: create
  - path: "src/lib/bindings.ts"
    op: update
related:
  - "20260815/Features_to_add/0624_feature_update-without-losing-the-conversation.md"
tags: [terminal, pty, updater, ipc, daemon]
---

[x] PTY 호스트 — 앱 업데이트/재시작에도 터미널 세션(Claude Code)이 끊기지 않는다

## 추가 기능

- **분리된 PTY 호스트 프로세스** (`src-tauri/src/ptyhost/`) — PTY fd 는 프로세스를
  넘어 살릴 수 없으므로, 세션·스크롤백·nonce 를 **별도 프로세스가 소유**하게
  했다. 별도 바이너리가 아니라 **같은 실행파일의 `--pty-host <socket>` 모드**
  (Chrome 헬퍼 방식) — `current_exe()` 는 dev/패키징/업데이트 직후 어디서든
  존재하므로 경로 문제로 스폰이 실패할 일이 없고, externalBin·build-sidecar
  변경도 필요 없다. `main.rs` 가 tauri 빌더 전에 분기한다.
- **wire 프로토콜** — Unix 도메인 소켓(`<app_data>/ptyhost.sock`, 0600) 위에
  기존 `framing.rs`(Content-Length, LSP/DAP 공용) + JSON. 요청/응답(id 짝짓기) +
  자발 이벤트(Data/Exit) 한 접속. `PROTO_VERSION` 불일치 시 클라이언트가
  호스트를 내리고(Shutdown) 새로 띄운다 — 세션은 잃지만 무언의 오동작보다 낫다.
- **호스트** (`host.rs`) — terminal.rs 의 세션 로직(SessionBuf 링버퍼 ·
  drain_utf8 스트리밍 디코드 · 멱등 start · 경합 패자 정리 · EOF 걷어내기 ·
  unknown-write 오류)을 그대로 이식. 이벤트는 tauri emit → broadcast 채널로.
  bind 경합은 "살아있는 호스트가 있으면 조용히 물러남 / 시체 소켓은 걷어내고
  재bind". 유휴(클라이언트 0·세션 0) 2틱(2분) 후 스스로 종료.
- **클라이언트** (`client.rs` + terminal.rs) — 커맨드는 전부 소켓 요청으로,
  호스트 이벤트는 `pty-data-{sid}`/`pty-exit-{sid}` 로 재방출 (전역 브로드캐스트
  — 종전과 동일한 모양). 셸·env(LANG/LC_CTYPE 로케일 fix 포함)·nonce·통합
  스크립트 실체화는 **여전히 앱이** 계산해 넘긴다 (tauri 핸들이 필요하므로).
  detach 스폰은 `process_group(0)` + stdio null + 시체 수거 스레드.
- **kill 의미 보존** — 창/탭 닫힘의 `kill_with_prefix`/`kill_except` 는 그대로
  호스트 요청으로. 마지막 창 닫힘 직후 앱이 종료될 수 있어 **spawn 이 아니라
  800ms 상한의 block_on** — 종료와 경주해 kill 이 유실되면 셸이 유령으로 남는다.

## 동작 흐름

1. 터미널 첫 사용 → `start_pty_session` → 클라이언트가 소켓 접속 시도 → 없으면
   `--pty-host` 로 detach 스폰(50ms×60 재시도) → Hello(버전 확인) → Start.
2. 앱이 업데이트로 재시작 → 호스트는 계속 산다 (별도 프로세스 그룹, 앱 종료는
   자식에게 신호를 보내지 않는다) → 프런트 `terminalTabs` 가 localStorage 에서
   같은 sid 로 복원 → 기존 attach→(miss 면) start 흐름의 **attach 가 이제
   성공** → 스크롤백 리플레이 + nonce/seq 연속 → 셸·Claude Code 세션이 그대로.
   **프런트엔드는 한 줄도 안 바꿨다** (bindings 도 주석만 변화).
3. 창/탭 닫기 → 종전과 동일하게 그 접두사의 세션이 죽는다. ⌘Q·트레이 종료는
   CloseRequested 를 거치지 않으므로 세션이 살아남고, 다음 실행에서 이어받는다
   (tmux 식 — 업데이트 생존과 같은 경로라 의도된 동작).

## 검증

- 통합 테스트 2종 (`tests/ptyhost_reattach.rs`, 실 /bin/sh PTY + 실 소켓):
  ① 클라이언트 A 가 세션 생성·`echo HELLO_$((40+2))` 실행 결과 수신 → 접속 종료
  → 클라이언트 B 가 attach 로 스크롤백(`HELLO_42`)·nonce·seq 를 그대로 이어받음
  + 멱등 start 가 기존 nonce 반환 + unknown write 오류 + KillExcept 전량 종료.
  ② `p1-` 접두사 kill 이 `p12-` 를 잡아먹지 않음 (window.rs 접두사 규격).
- 단위 테스트 이식 9종 (drain_utf8 한글/박스/이모지 경계 · SessionBuf 상한 ·
  is_protected · ps 배관) + 프로토콜 왕복/미지-필드 관용 2종. cargo test 전체
  823+ 그린.
- 바이너리 스모크: `ocul-pm --pty-host <sock>` 가 GUI 없이 소켓(0600)을 물고
  상주, 두 번째 호스트는 살아있는 호스트를 감지하고 exit 0 으로 물러남.
- `pnpm typecheck/test/lint/build` 전부 exit 0.

## 메모

- **미검증 (실기기 육안 필요)**: 실제 앱에서 ⌘Q→재실행·업데이트 재시작 후 셸
  유지, OSC 133 상태줄 연속성, 분리 터미널 창 시나리오. 플래너 `#pty-manual-verify`.
- ACP(AI 패널) 어댑터는 여전히 재시작에 죽는다 — stdio 자식이라 이 방식이 안
  통한다 (related 일지의 결론 그대로). 이번 범위는 터미널 PTY 만.
- dev 와 패키징 앱이 같은 app_data_dir 를 쓰므로 같은 호스트를 공유할 수 있다
  — sid 가 프로젝트 접두사라 실해는 없지만 알아 둘 것.
