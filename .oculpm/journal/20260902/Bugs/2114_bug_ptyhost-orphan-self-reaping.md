---
schema_version: 1
type: bug
slug: "ptyhost-orphan-self-reaping"
status: done
difficulty: medium
created_at: "2026-09-02T21:14:18+09:00"
session_id: "20260902-010"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/host.rs"
    op: update
  - path: "src-tauri/src/ptyhost/client.rs"
    op: update
  - path: "src-tauri/src/ptyhost/protocol.rs"
    op: update
related:
  - ref: "20260902/Bugs/2101_bug_ptyhost-socket-name-isolation.md"
    kind: "followup"
tags:
  - "terminal"
  - "pty-host"
  - "lifecycle"
  - "safety"
  - "mcp-tool"
---
[x] 고아 PTY 호스트가 스스로 내려간다 — 남을 내리지 않으면서 영원히 살지도 않게

## 발생 원인

소켓 이름에 프로토콜·빌드를 넣어 격리한 직후(선행 일지) 남은 구멍이다. 프로토콜을 올리면 자리가 갈리므로 구버전 호스트에는 **다시는 아무도 붙지 않는다**. 그런데 유휴 자동 종료의 조건은 `클라이언트 0 · 세션 0` 이라, 세션을 쥔 호스트는 그 조건에 영영 닿지 않는다 — 아무도 보지 않는 셸이 로그인 세션이 끝날 때까지 남는다.

앞 라운드에서는 이걸 "받아들인 대가" 로 적었지만, 받아들일 값이 아니었다.

전에 이 자리를 메우던 것은 앱이 보내는 `Shutdown` 이었고, 그게 바로 자기 셸을 죽인 경로였다. 그래서 **남을 내리지 않는다**는 원칙은 유지한 채, 호스트가 자기 수명을 알게 하는 쪽으로 풀었다.

## 해결 방법

`host.rs` 의 유휴 감시를 `Watchdog` 로 분리하고(시계·파일시스템과 떼어 놓아 그대로 테스트한다) 판정을 셋으로 나눴다.

1. **빈 호스트** — 클라이언트 0 · 세션 0 이 2틱 → 종료 (종전 계약 그대로).
2. **밀려난 호스트** — 같은 빌드 종류의 **더 높은 프로토콜 소켓 파일**이 같은 디렉터리에 보이면(`superseded_by_a_newer_socket`) 클라이언트 0 이 2틱만에 종료. 그 버전의 앱이 이미 이 기계에서 떴다는 뜻이고, 내 이름을 부를 앱은 다시 없다.
3. **버려진 호스트** — 그 밖의 경우엔 클라이언트 0 이 `ORPHAN_TICKS`(180틱 = 3시간) 지속되면 종료.

②가 **남의 호스트에 접속하지 않고** 파일 이름만 보는 것이 핵심이다. 접속하는 순간 그쪽의 "붙는 이" 수가 흔들려, 정작 그쪽이 고아일 때 스스로를 못 알아보게 된다. dev 와 설치본은 서로를 세지 않는다 — 나란히 도는 것이 정상이다.

③이 3시간으로 넉넉한 이유: 확실한 고아는 ②가 이미 데려가므로, 여기 걸리는 건 "앱이 영영 돌아오지 않았다" 뿐이다. `ExitRequested` 경로는 일부러 PTY 를 걷어가지 않으므로(호스트가 앱 재시작을 건너는 이유), Cmd+Q 로 껐다 돌아오는 사용자의 세션을 성급히 죽이지 않으려면 이쪽이 느슨해야 한다.

종료 절차는 `Shutdown` 요청과 공유한다 — `vacate()` 로 추출: 소켓 파일을 먼저 지워 자리를 비우고(뒤이어 뜨는 호스트가 bind 에 실패해 물러나는 일을 막는다), 세션을 **실제로** 끝낸 뒤(SIGHUP→유예→SIGKILL), 유예가 끝나기를 기다렸다 내려간다.

## 검증

- `cargo test` 전체 1209 통과 · 0 실패 (exit 0).
- 판정 단위 테스트 7건: 붙어 있으면 절대 안 죽는다 · 빈 호스트 2틱 · 고아 179틱 버티고 180틱에 종료 · 붙는 이가 돌아오면 유예 리셋(앱 재시작을 건너는 계약) · 밀려난 호스트는 2틱 · 이름 파싱(`ptyhost-v13-dev.sock` → `(13, dev)`) · 같은 빌드 종류의 더 높은 버전만 밀어낸다(tempdir 실파일).
- `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` 통과.
- 육안 확인은 보류 — 3시간·2틱 타이머라 실기기 확인은 다음 릴리스 후 로그(`ptyhost.log` 의 `orphaned (...)` 줄)로 하는 편이 정확하다.

## 메모

이번 배포의 **일회성 잔여물**은 이 로직이 못 잡는다: 지금 도는 호스트는 옛 이름(`ptyhost.sock`)에 옛 코드다. 앱을 끄고 `pkill -f -- '--pty-host'` 한 번이면 끝. 다음 프로토콜 상향부터는 ②가 알아서 정리한다.