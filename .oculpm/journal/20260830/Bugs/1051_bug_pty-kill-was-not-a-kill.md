---
schema_version: 1
type: bug
slug: pty-kill-was-not-a-kill
status: done
created_at: 2026-08-30T10:51:00+09:00
session_id: "manual-20260830-105100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src-tauri/src/ptyhost/host.rs
    op: update
  - path: src-tauri/Cargo.toml
    op: update
  - path: src-tauri/Cargo.lock
    op: update
related: []
tags: [terminal, pty-host, process-lifecycle, audit-round]
---

[x] PTY 호스트의 Kill 이 셸을 죽이지 않았고, 끝난 셸은 아무도 회수하지 않아 좀비가 쌓였다

## 발생 원인

`ptyhost/host.rs` 의 `Request::Kill` 은 세션을 맵에서 `remove` 하는 것이 전부였고, 주석은 "HostSession drop → master 닫힘 → 자식에 SIGHUP" 이라 적혀 있었다. 두 가지가 그 가정을 깨뜨렸다.

1. **master 가 닫히지 않는다.** 읽기 스레드가 `try_clone_reader()` 로 받은 master 의 **dup** 을 EOF 까지 쥐고 있다. `HostSession` 을 떨어뜨려도 fd 하나가 남으므로 커널은 SIGHUP 을 보내지 않는다. 실제로 자식에게 가던 것은 writer drop 이 흘리는 `\n`+^D 뿐 — 유휴 셸은 EOF 로 나가지만 ^D 를 무시하는 포그라운드(vim·ssh·도구 호출 중인 claude)는 살아남았다. 같은 sid 로 새 세션이 뜨면 죽지 않은 옛 세션의 출력이 같은 sid 로 broadcast 돼 한 화면에 두 프로세스의 출력이 섞였다.
2. **아무도 `wait()` 하지 않는다.** `spawn_command` 의 반환값을 `let _child =` 로 즉시 버렸다. `portable_pty` 의 Child 는 drop 에서 회수하지 않으므로 셸이 끝날 때마다 호스트 프로세스 안에 좀비가 하나씩 남았다 — 호스트는 앱 업데이트를 넘어 상주하는 데몬이라 재부팅 전까지 누적된다.

## 해결 방법

- `HostSession` 이 `child` 와 `gone: Arc<AtomicBool>` 을 갖는다.
- 새 `terminate_session`: `gone` 을 세우고 → 포그라운드 프로세스 그룹(`master.process_group_leader()`)과 셸 pid 에 **SIGHUP** → master/writer 를 닫아 슬레이브 쪽 read 가 EIO 로 깨어나게 → 1.5초 유예 동안 `try_wait` → 안 내려오면 **SIGKILL** → `wait()` 로 회수. 블로킹이라 전용 스레드에서 돈다. 포그라운드와 셸을 따로 겨누는 이유: 잡 컨트롤로 포그라운드 작업은 셸과 다른 프로세스 그룹에 있다.
- `Kill`·`KillPrefix`·`KillExcept` 는 락을 쥔 채 종료하지 않는다 — `take_sessions` 로 꺼낸 뒤 락 밖에서 하나씩 종료(한 세션이 늦어도 다른 요청이 안 막힌다).
- 읽기 스레드의 EOF 경로: **내 세션일 때만**(`Arc::ptr_eq(&entry.gone, &mine)`) 맵에서 지우고 `terminate_session` 으로 회수 + Exit 이벤트. Kill 이 지나간 뒤 같은 sid 로 새로 뜬 세션을 지우거나 유령 Exit 를 내지 않는다.
- 신호는 `libc::kill/killpg` — `libc` 를 직접 의존성에 추가(락파일엔 이미 있던 크레이트).

## 검증

새 통합 테스트 `kill_terminates_shell_and_foreground_and_reaps`: `/bin/sh` 를 띄우고 `trap '' HUP; sleep 300` 을 포그라운드에 앉힌 뒤(HUP 을 무시하는 셸 + 별도 프로세스 그룹의 sleep) Kill → 유예+3초 안에 `kill(pid, 0)` 이 sleep·셸 모두 ESRCH. 회수가 안 됐으면 좀비는 "살아 있다"고 보고되므로 이 단언이 곧 회수 증명이다. `cargo test` 866 그린.

## 메모

호스트 `Write` 가 세션 맵 락을 쥔 채 블로킹 write 를 하는 문제(한 세션 정체 → Attach/Kill 전부 대기)는 감사에서 함께 지적됐으나 이 라운드 범위 밖 — 별도 항목으로.
