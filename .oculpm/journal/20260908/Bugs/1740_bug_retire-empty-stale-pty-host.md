---
schema_version: 1
type: bug
slug: "retire-empty-stale-pty-host"
status: done
difficulty: medium
created_at: "2026-09-08T17:40:12+09:00"
session_id: "20260908-005"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "e98f9c75-6f28-4cef-8beb-d157afce0a74"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/protocol.rs"
    op: update
  - path: "src-tauri/src/ptyhost/host.rs"
    op: rename
  - path: "src-tauri/src/ptyhost/host/mod.rs"
    op: update
  - path: "src-tauri/src/ptyhost/host/tests.rs"
    op: create
  - path: "src-tauri/src/ptyhost/client.rs"
    op: update
related: []
tags:
  - "ptyhost"
  - "tcc"
  - "macos"
  - "updater"
  - "mcp-tool"
---
[x] 업데이트를 건너온 빈 PTY 호스트를 조용히 교체한다

## 발생 원인

사용자 보고: 내장 터미널의 Claude Code 가 스크린샷을 찍으려 하자 macOS 가 「'Ocul-PM.app' 이 화면과 오디오를 기록하려 합니다」를 띄웠고, 시스템 설정에서 허용하고 **앱을 껐다 켜도** 계속 다시 물었다.

프로세스 사슬을 따라가니 요청 주체는 `claude` 가 아니라 그 조상인 PTY 호스트였다 (`claude` ← `zsh` ← `ocul-pm --pty-host`, pid 1081). TCC 가 그 프로세스에 귀속시키므로 다이얼로그에 앱 이름이 뜬 것까지는 설계대로다. 문제는 그 프로세스의 **실행 이미지**였다:

```
lsof -p 1081 → txt  /private/var/folders/…/T/tauri_current_appZHgJy0/current_app/Contents/MacOS/ocul-pm
ls 그 경로     → No such file or directory
```

- 09-06 10:10 호스트가 `/Applications/Ocul-PM.app` 에서 뜬다
- 09-08 13:03 앱 업데이트 — updater 가 구 번들을 임시 폴더로 **옮기고** 신 번들을 자리에 놓는다
- 그 뒤 임시 폴더가 지워진다 → 호스트는 경로 없는 orphan inode 를 실행 중
- 09-08 17:17 앱만 재실행. 호스트는 그대로

두 겹으로 막혀 있었다. ① 화면 기록 승인은 **프로세스를 재시작해야** 반영되는데 이 프로세스는 승인보다 이틀 먼저 떴다. ② 앱을 껐다 켜도 호스트는 안 죽는다 — 그게 설계다 (`connect_or_spawn` 이 옛 자리까지 두드려 이어받고, 앱이 `Shutdown` 을 보내는 자리는 0). 결과적으로 디스크에 없는 번들이 권한을 요청하니 `/Applications` 앞으로 적힌 승인과 영영 매칭되지 않아, 몇 번을 허용해도 다시 물었다.

뿌리는 **호스트를 은퇴시키는 경로가 없다**는 것이다. 세션을 살리려 이어받는 것은 맞는데, 그 뒤로 호스트는 재부팅 전까지 옛 실행파일로 돈다. 유휴 수거(`Watchdog`)는 클라이언트가 붙어 있는 한 걸리지 않으므로, 앱이 켜져 있는 동안에는 빈 호스트조차 수거되지 않는다.

## 해결 방법

**잃을 것이 없을 때만** 갈아 치운다 — 판이 다르고 세션이 0 인 호스트.

- `protocol.rs` — `Response::Proto` 에 `build`(`APP_BUILD` = `CARGO_PKG_VERSION`)와 `sessions` 를 **둘 다 `Option`** 으로 추가. 구버전 호스트는 말하지 않으므로 `None` 이고, `None` 은 "모른다" 지 0 이 아니다. 여기를 기본값 0 으로 접으면 앱이 사용자의 셸을 쥔 옛 호스트를 "비었으니 교체" 로 내린다 — 이 기능이 막으려던 사고가 그대로 돌아온다.
- `host` — `Hello` 가 자기 판과 지금 쥔 세션 수를 같이 답한다. 판만 말하면 앱이 세션을 쥔 호스트를 내릴 수 있고, 세션 수만 말하면 지금 판의 멀쩡한 호스트까지 매번 갈아 치운다.
- `client.rs` — 순수 함수 `is_replaceable(build, sessions)` 가 `(Some(b), Some(0)) if b != APP_BUILD` 일 때만 참. `connect_or_spawn` 은 그런 호스트를 만나면 `Shutdown` 을 보내고(`retire`) 정식 자리에 새로 띄운다. 응답이 오면 `host::vacate` 가 소켓 파일을 이미 지운 뒤라 bind 가 부딪히지 않는다.
- 세션을 쥔 옛 판 호스트는 **그대로 이어받는다** — 그 계약은 손대지 않았다. 대신 그때 `info` 한 줄을 남긴다(판·세션 수). 이번 진단을 `lsof` 로 캔 것이 아까워서다.
- `spawn_if_missing == false` 인 호출에서는 손대지 않는다. "있으면 말만 걸겠다" 는 길이라, 내려놓고 안 띄우면 다음 호출이 만날 호스트가 사라진다.

곁들여 `host.rs`(1143줄)가 파일 크기 래칫에 걸려, `frontmatter/tests.rs` 선례대로 테스트 모듈을 `host/tests.rs` 로 갈랐다 (`host.rs` → `host/mod.rs` 809줄 + `tests.rs` 379줄). 동작은 그대로, 한 단 내어쓰기만.

## 검증

`cargo test` 전량 통과(lib 1439). 새 테스트 4개 — `is_replaceable` 의 진리표 둘(판·세션 두 조건, 그리고 `None` 을 0 으로 읽지 않는다), `Hello` 가 판과 세션 수를 말한다, 세션을 쥔 호스트를 빈 것으로 말하지 않는다(실제 셸 1개를 띄워 확인). 프로토콜 테스트로 구버전 응답 `{"kind":"proto","proto":2}` 가 `build: None`·`sessions: None` 으로 읽히는 것을 못박았다. `cargo fmt --check` · `cargo clippy --all-targets -D warnings` · `pnpm typecheck/test(2480)/lint(6게이트)/build` 전부 exit 0.

## 메모

이 수정은 **다음다음 업데이트부터** 효과가 난다. 지금 도는 호스트는 자기 판을 말할 줄 모르므로(`None`) 판단 대상이 아니고, 이 코드가 담긴 판을 설치한 뒤 그 호스트가 뜬 다음, 그 위로 업데이트가 한 번 더 지나가야 교체가 걸린다.

사용자의 현재 pid 1081 은 **세션을 쥐고 있어** 이 길로도 안 바뀐다 — 손으로 `kill` 해야 한다. 세션을 쥔 채 옛 실행파일로 도는 호스트를 어떻게 할지는 열린 문제다(사용자에게 알리기? 세션이 다 닫히는 순간을 노리기?). 지금은 로그 한 줄만 남긴다.