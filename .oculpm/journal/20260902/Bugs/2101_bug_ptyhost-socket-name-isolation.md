---
schema_version: 1
type: bug
slug: "ptyhost-socket-name-isolation"
status: done
difficulty: low
created_at: "2026-09-02T21:01:32+09:00"
session_id: "20260902-010"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/client.rs"
    op: update
  - path: "src-tauri/src/ptyhost/mod.rs"
    op: update
  - path: "src-tauri/src/ptyhost/protocol.rs"
    op: update
related:
  - ref: "20260902/Bugs/1747_bug_pty-host-proto-2-idle-shell.md"
    kind: "followup"
tags:
  - "terminal"
  - "pty-host"
  - "protocol"
  - "safety"
  - "mcp-tool"
---
[x] PTY 호스트 소켓 이름에 프로토콜·빌드를 넣어, 불일치 Shutdown 경로를 없앴다

소켓 자리를 버전마다 갈라 두면, 짝이 안 맞는 둘은 애초에 만나지 않는다.

## 발생 원인

`PROTO_VERSION` 을 2 로 올린 뒤(선행 일지) 남은 위험은 **불일치를 처리하는 방식**이었다. 클라이언트는 `Hello` 응답이 다르면 그 호스트에 `Shutdown` 을 보내 내렸는데, 이 파괴적 경로가 실제로 발화하는 조건이 앱 업데이트만이 아니었다. 설치본(구 proto)의 내장 터미널에서 dev 빌드(신 proto)를 띄우면 둘이 **같은 `ptyhost.sock`** 에서 만난다 → dev 앱이 설치본의 호스트를 내린다 → 그 호스트가 쥐고 있던 셸이 곧 자기를 띄운 그 터미널이었다. 로그도 크래시 리포트도 남지 않고 셸만 사라졌다.

원인은 불일치 판정이 아니라 **한 자리를 공유한 것**이다. 이름이 하나뿐이면, 서로 말이 안 통하는 두 짝이 반드시 같은 문 앞에서 마주친다.

## 해결 방법

이름을 격리로 쓴다 — `client::socket_name()` 이 `ptyhost-v{PROTO_VERSION}[-dev].sock` 을 만든다.

- 프로토콜 축: `PROTO_VERSION` 이 이름에 들어가므로, 버전을 올리는 것만으로 신·구 짝의 자리가 갈린다.
- 빌드 축: `#[cfg(debug_assertions)]` 접미사 `-dev` — dev 로 띄운 앱은 설치본의 호스트 자리에 앉지 않는다.

그 위에서 `Shutdown` 요청을 클라이언트에서 **제거**했다. 이제 앱은 어떤 경우에도 호스트를 내리지 않는다. 남은 `Hello` 검사는 방어선으로만 남겨, 불일치를 보면 접속만 놓고 물러난다 — 이름이 갈라 놓은 자리에 다른 짝이 있다면 그것은 우리 것이 아니고, 남의 호스트를 내리는 것은 남의 셸을 죽이는 것이기 때문이다. 재시도 루프는 마지막 실패 사유를 들고 나가게 해(`did not come up in time: {last}`), 그 방어선이 발화했을 때 진단이 사라지지 않게 했다.

대가는 문서에 적어 두었다: 프로토콜을 올리면 구버전 호스트가 아무도 붙지 않은 채 남는다. 세션을 쥐고 있으면 유휴 자동 종료(클라이언트 0 · 세션 0)도 걸리지 않는다. 남의 세션을 말없이 죽이는 쪽보다 낫다고 보고 받아들인 값이다.

## 검증

- `cargo test` 전체 1202 통과 · 0 실패 (exit 0). `ptyhost_reattach` 통합 2건(재접속으로 세션·스크롤백·nonce 보존) 포함.
- 새 단위 테스트 2건: 이름이 `ptyhost-v{PROTO_VERSION}` 으로 시작할 것 · 디버그 빌드는 `-dev.sock` 으로 끝날 것(테스트는 늘 디버그 빌드라 사고의 조건을 그대로 잠근다).
- `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` 통과.
- 육안 확인은 아직 — 설치본이 도는 중 dev 빌드 금지 규율에 따라 보류.

## 메모

배포 후 한 번은 구 `ptyhost.sock` 의 호스트가 남는다(이름이 바뀌므로 아무도 붙지 않는다). 세션을 쥔 채라 스스로 내려가지 않으니, 신경 쓰이면 `pkill -f -- '--pty-host'` 로 한 번 걷어내면 된다.