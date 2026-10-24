---
schema_version: 1
type: bug
slug: "ptyhost-stale-exe-tcc-bundle-clone"
status: done
difficulty: high
created_at: "2026-10-24T10:47:55+09:00"
session_id: "20261024-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/stage_mac.rs"
    op: create
  - path: "src-tauri/src/proc/disclaim.rs"
    op: create
  - path: "src-tauri/src/ptyhost/client.rs"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/proc.rs"
    op: update
  - path: "src-tauri/src/ptyhost/mod.rs"
    op: update
  - path: "src-tauri/src/ptyhost/stage.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "CHANGELOG.md"
    op: update
related:
  - ref: "20261024/Bugs/1024_bug_terminal-fit-bottom-row-clipped.md"
    kind: "followup"
tags:
  - "terminal"
  - "ptyhost"
  - "macos"
  - "tcc"
  - "mcp-tool"
---
[x] 업데이트를 건넌 PTY 호스트가 데스크탑 접근을 잃던 것 — 앱 묶음 복제본 + 책임 분리 기동

## 발생 원인

사용자 보고: 터미널을 켜면 `getcwd: cannot access parent directories: Operation not permitted` + fnm `use.rs` 패닉. PTY 호스트(pid 1829)가 10-04 의 v3.6.0 으로 세션 10개를 쥔 채 v3.13.2 까지 살아 있었고, 업데이트가 `/Applications/Ocul-PM.app` 을 갈아 끼워 그 실행 파일이 사라졌다(`codesign --verify 1829` → No such file). macOS 는 그 호스트를 Ocul-PM 으로 알아보지 못해 데스크탑 접근을 거부했다. 세션을 쥔 옛 호스트는 `is_replaceable` 이 교체하지 않으니 재부팅·수동 kill 전까지 계속된다.

실측(진단 셸을 호스트 소켓에 직접 띄움, responsibility disclaim 으로 iTerm 권한 배제):
- 복제본 묶음(`cp -c`, 서명·공증 유효)에서 띄운 호스트 → 데스크탑 OK.
- 띄운 뒤 **처음 접근하기 전에** 복제본을 지움 → `Operation not permitted` (지금 증상 그대로).
- 접근한 뒤에 지우면 한동안 됨 — 판정이 프로세스에 캐시된다. 옛 호스트가 업데이트 뒤에도 한동안 멀쩡했던 이유.

## 해결 방법

- `ptyhost/stage_mac.rs`: 앱 묶음을 `<app_data>/ptyhost.noindex/<판>-<exe 해시16>/Ocul-PM.app` 에 APFS `clonefile` (임시 폴더 → 이름 바꾸기). 다른 복제본은 그 안의 실행 파일로 도는 프로세스가 없을 때만 지운다(`proc_listallpids`+`proc_pidpath` — macOS 는 돌고 있는 묶음도 지우므로 OS 판정에 못 맡김). 묶음 밖(dev·테스트)이면 복제하지 않는다.
- `proc/disclaim.rs`: `posix_spawn` + `responsibility_spawnattrs_setdisclaim` — 호스트가 스스로 TCC 책임 프로세스(판정 대상 = 복제본). stdio `/dev/null`, `POSIX_SPAWN_CLOEXEC_DEFAULT` 로 fd 상속 없음, 새 프로세스 그룹.
- `client.rs`: macOS 는 복제본에서 먼저, 안 뜨면 원본으로 한 번 더(앱 프로세스당 한 번만 시도). 해시·복제는 `spawn_blocking`.
- 이행: 앱이 켜진 채 터미널을 다 닫으면 옛 판 호스트가 남던 것 — 새 세션 직전에 다시 Hello 해 비었으면 내리고 새로 띄운다(`emptied_since_connect`, `start_pty_session` 은 `starting` 잠금으로 한 줄 — 판정과 Start 사이에 다른 Start 가 끼면 내리며 죽이므로).
- 기동 원장(`egress_spawn_ledger`)에 `spawn_disclaimed(` · `posix_spawn(` 를 기동 호출로 올리고 자리 4개 등록.

## 검증

- 새 단위 테스트 7개(묶음 판정·복제 재사용·원본 교체 뒤 생존·prune 이 돌고 있는 것을 남김·프로세스 목록·disclaim 왕복) + `egress_spawn_ledger` 통과 · clippy 무경고 · 전체 cargo test.
- 실기기(설치본 업데이트 뒤 새 터미널 데스크탑 접근)는 다음 릴리스 설치 후 — 플랜 eyes 항목.