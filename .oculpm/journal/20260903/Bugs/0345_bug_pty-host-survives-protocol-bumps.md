---
schema_version: 1
type: bug
slug: "pty-host-survives-protocol-bumps"
status: done
difficulty: high
created_at: "2026-09-03T03:45:02+09:00"
session_id: "20260903-002"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/client.rs"
    op: update
  - path: "src-tauri/src/ptyhost/host.rs"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/ptyhost_reattach.rs"
    op: update
related: []
tags:
  - "terminal"
  - "pty-host"
  - "update"
  - "acp"
  - "mcp-tool"
---
[x] 업데이트가 터미널을 죽이던 것 — 소켓 이름에서 프로토콜을 뺀다

## 발생 원인

PTY 호스트가 앱보다 오래 사는 이유는 **하나**다 — 업데이트 재시작을 건너 셸(안에서 돌던 Claude Code 세션)을 살리기 위해서. 그 이어받기는 새 앱이 **같은 소켓 파일**에 다시 붙어야만 성립한다.

v2.34.0 이 소켓 이름에 프로토콜 번호를 박았다 (`ptyhost-v{PROTO}.sock`, `client.rs`). 같은 판에서 `PROTO_VERSION` 을 1→2 로 올렸으므로:

1. v2.33 호스트는 `ptyhost.sock` 에서 사용자의 셸을 쥔 채 살아 있다.
2. v2.34 앱은 `ptyhost-v2.sock` 을 본다 — 비어 있다. 새 호스트를 띄우고, 프런트의 attach 가 miss → **새 셸을 start.** 하던 세션이 화면에서 사라진다.
3. 옛 호스트는 더 높은 번호의 소켓을 보고 `SUPERSEDED_TICKS = 2` — **2분 뒤 자기가 쥔 셸을 죽이고** 내려간다.

`protocol.rs` 에 "그 세션은 이어받지 못한다"고 적혀 있었다. 사고가 아니라 **의도된 맞바꿈**이었고, 맞바꾼 값이 이 기능의 존재 이유였다. 프로토콜을 올린 이유는 `Foreground` 의 뜻 하나(놀고 있는 셸은 `None`)였다 — 탭 닫기 확인창 한 번과 작업 중인 세션을 바꾼 셈이다. v2.34.1 의 `sweep_legacy_host` 는 그 뒤처리로 옛 호스트에 `Shutdown` 을 보냈다.

## 해결 방법

**자리를 가르지 않고 협상한다.**

- `socket_name()` → `ptyhost[-dev].sock` 고정. `-dev` 접미사는 남긴다 — 그건 프로토콜이 아니라 빌드 종류의 격리고, 자기참수 사고(2026-09-02)를 막는 자리다.
- `socket_candidates()` — 정식 자리 다음에 옛 자리(`ptyhost-v2`)를 둔다. 정식 자리가 비어 있으면 옛 자리를 두드려 **그 호스트를 그대로 이어받는다.** 시체 소켓 파일에 걸려 넘어지지 않는다.
- `PtyHostClient::connect` 는 번호가 달라도 **물러나지 않는다.** 호스트의 proto 를 `host_proto()` 로 기억만 하고, 뜻이 달라진 자리는 부르는 쪽이 맞춘다 — `pty_foreground_command` 가 proto 1 호스트의 `-zsh` 를 `is_the_login_shell` 로 걸러 같은 결론에 닿는다.

**세션을 쥔 호스트를 서둘러 내리는 길을 없앤다.**

- `sweep_legacy_host` · `shutdown_host_at` 삭제 (앱이 `Shutdown` 을 보내는 자리가 이제 하나도 없다). `lib.rs` 의 시작 훅도 함께.
- `superseded_by_a_newer_socket` · `SUPERSEDED_TICKS` · `parse_socket_name` 삭제. 세션을 쥔 호스트의 유예는 `ORPHAN_TICKS`(3시간) 하나뿐이고, 붙는 이가 돌아오면 처음부터 다시 센다.

## 검증

`cargo test` 전부 통과 · `cargo clippy --all-targets -D warnings` 0. 통합 테스트 3건을 새로 세웠다: 옛 자리에 남은 호스트를 이어받아 그 세션에 attach 되는가(`the_app_adopts_a_host_left_at_an_old_address`), 시체 소켓이 살아 있는 호스트를 가리지 않는가, 아무 데도 없으면 오류가 아니라 `None` 인가. 호스트 쪽에는 "세션을 쥔 호스트는 30분 안에 아무도 못 내린다" 를 못으로 박았다. 프런트 게이트(typecheck · vitest 2045 · lint · build) 전부 exit 0.

**남은 한 가지**: 이 판이 정식 자리를 `ptyhost.sock` 으로 되돌리므로, v2.34.x 에서 올라오는 첫 실행은 옛 자리를 이어받는 경로를 탄다 — 실기기에서 한 번 확인해야 한다.