---
schema_version: 1
type: bug
slug: "sweep-pre-versioned-pty-host"
status: done
difficulty: medium
created_at: "2026-09-02T23:34:11+09:00"
session_id: "20260902-011"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/client.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/ptyhost_reattach.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
related:
  - ref: "20260902/Bugs/2114_bug_ptyhost-orphan-self-reaping.md"
    kind: "followup"
tags:
  - "terminal"
  - "pty-host"
  - "migration"
  - "release"
  - "mcp-tool"
---
[x] 업데이트가 남긴 옛 PTY 호스트를 앱이 스스로 걷는다 (v2.34.1 긴급)

## 발생 원인

v2.34.0 이 소켓 이름에 프로토콜·빌드를 넣어 자리를 갈랐고, 고아가 된 호스트는 스스로 내려가게 했다. 그런데 **그 자정리 코드는 새 빌드에만 있다.** v2.33 이하에서 올라오는 호스트에는 아무도 붙지 않는데 스스로 내려갈 줄도 몰라, 아무도 보지 않는 셸을 쥔 채 로그인 세션이 끝날 때까지 남는다.

앞선 라운드에서 이걸 "앱을 끄고 `pkill -f -- '--pty-host'` 한 번" 으로 넘겼는데, 사용자가 지적한 대로 **다른 사용자는 그걸 알 리가 없다**. 릴리스 노트에 적어 두는 것으로 해결되는 종류의 일이 아니다.

## 해결 방법

앱이 시작할 때 옛 이름(`ptyhost.sock`) 자리를 한 번 확인한다 — 살아 있으면 `Shutdown` 을 보내 세션을 제대로 끝내고 내려가게 하고(호스트가 소켓 파일도 스스로 비운다), 시체 파일만 남았으면 파일만 걷는다. `lib.rs` setup 에서 백그라운드 태스크 하나, 실패해도 조용하다.

핵심은 **두 겹으로 좁힌 것**이다. 남의 호스트를 내리는 경로는 바로 자기 셸을 죽였던 그 경로이기 때문이다.

1. **릴리스 빌드만** (`cfg!(debug_assertions)` 이면 즉시 반환). dev 가 이 자리를 건드리게 두면, 설치본의 내장 터미널에서 dev 를 띄우는 순간 자기를 띄운 셸을 죽인다 — 이름 격리로 없앤 사고를 한 줄로 되살리는 셈이다.
2. **옛 이름 하나만** 본다. 버전이 붙은 자리(`ptyhost-v*.sock`)는 임자가 있는 자리다.

`PtyHostClient::connect` 를 쓰지 않는다 — 그쪽은 프로토콜이 다르면 물러나는데, 여기서 상대는 정의상 옛 프로토콜이고 우리는 대화가 아니라 한 마디만 보내면 된다. 이행 코드라 `// oculpm-defer:` 로 재방문 트리거(대략 v2.40)를 달았다.

## 검증

- 새 테스트 2건 — 시체 소켓 파일은 걷어내고 "살아 있는 호스트가 아니었다"고 답한다 · **디버그 빌드는 그 자리를 손대지 않는다**(테스트는 늘 디버그 빌드라 안전장치를 그 자리에서 잰다). 살아 있는 호스트에 실제로 `Shutdown` 을 보내는 경로는 테스트하지 않았다 — 호스트의 종료 절차가 `process::exit` 라 테스트 프로세스를 함께 데려간다.
- `cargo test` 1212 통과 · `pnpm typecheck`·`test`·`lint`·`build` exit 0 · fmt · clippy `-D warnings`.
- 릴리스 5면 + 랜딩 배포 (`oculpm.com` 이 2.34.1).

## 메모

첫 푸시에서 CI 가 붉었는데 이번엔 내 변경과 무관한 워처 디바운스 테스트였다. 쓰기 다섯이 100ms 에 걸쳐 있는데 창이 150ms 라 여유가 50ms 뿐 — 러너가 한 번 멈칫하면 배치가 갈린다. 그 테스트가 재려는 것은 스케줄러의 정확도가 아니므로 창을 400ms 로, 정착 대기를 1초로 넓혔다(별도 커밋).