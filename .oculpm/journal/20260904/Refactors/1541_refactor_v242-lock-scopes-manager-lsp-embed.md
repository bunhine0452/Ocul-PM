---
schema_version: 1
type: refactor
slug: "v242-lock-scopes-manager-lsp-embed"
status: done
difficulty: superhigh
created_at: "2026-09-04T15:41:07+09:00"
session_id: "20260904-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "a7a49ff0-edf2-49a1-a1f7-e2c9be2e746a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/manager/lifecycle.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/watcher_commit.rs"
    op: create
  - path: "src-tauri/src/lsp/state.rs"
    op: update
  - path: "src-tauri/src/embedding.rs"
    op: update
  - path: "src-tauri/tests/oculpm_lock_scope.rs"
    op: create
related: []
tags:
  - "lock-scope"
  - "manager"
  - "lsp"
  - "embedding"
  - "v2.42.0"
  - "mcp-tool"
---
[x] 락을 IO 너머로 잡지 않는다 — 셋 다 같은 파일에 옳은 모양이 있었다

## 동기

세 자리가 같은 병리였다 — **락을 쥔 채 `.await`·프로세스 fork·블로킹 추론까지 간다.**
그리고 셋 다 **같은 파일 안에 옳은 모양이 이미 있었다**. 새 관용구를 발명할 일이 아니라
이미 있는 것을 따르지 않은 자리를 맞추는 일이었다.

## 변경 요약

**`{#manager-write-lock}`** — `watcher_start_with` 가 전역 `projects` write 락을 쥔 채
파일 락 획득·`ps` fork·워처 등록까지 갔다. 그동안 다른 모든 프로젝트의 manager 접근이
read 조차 막힌다. 3단계로 가른다: **스냅샷 → 락 밖에서 느린 일 → CAS 커밋.**

**`{#lsp-status-lock}`** — `status()` 가 서버 맵 락 안에서 `resolve_binary().await` 를
불렀다. 그 안에 `login_shell_path()` 가 있어 PATH 에 없는 서버마다 **로그인 셸을 fork**
한다. 같은 파일 `running_clients` 의 관용구로 바꿨다 — 맵에서 슬롯 `Arc` 만 복사하고
락을 놓은 뒤 해석한다.

**`{#embedder-mutex}`** — 전역 std 뮤텍스를 `spawn_blocking` **안**에서 잡아 N 동시
호출자가 N 개 OS 스레드를 파킹했고, 그 풀은 git·히스토리·코드 검색과 **공유**된다.
`Semaphore(1)` 로 줄서기를 blocking 풀 밖으로 옮겼다. 모델이 한 번에 하나인 것은 그대로 —
바뀐 것은 **어디서 기다리는가**다.

## 락을 놓았다 잡는 사이의 경합 — 두 겹으로 막았다

이 수정이 만들 수 있는 새 버그가 여기 있어서, 방어를 두 겹으로 했다.

**(a) 프로젝트 단위 `lifecycle_lock`** (`plan_write_locks` 와 같은 모양) 이
`watcher_start_with`·`init_project`·`set_config`·`on_project_closed` 를 직렬화한다.
획득 순서는 **언제나 `lifecycle_lock` → `projects`**, 역순은 한 곳도 없다.

이게 없으면 느린 구간에서 새 `LockGuard` 를 잡는 사이 `on_project_closed`+`init_project`
가 끼어 **한 프로세스 안에 같은 `.lock` 경로의 가드가 둘** 생긴다. `LockGuard::drop` 은
"디스크의 pid == 내 pid" 로만 소유를 판정하므로 **나중에 떨어지는 쪽이 살아 있는 가드의
락 파일을 지운다.**

**(b) `watcher_epoch` CAS** — `watcher_stop`·`yield_evicted_locks`·
`watcher_drop_unresponsive` 는 "기다리지 않는다" 가 계약이라 (a) 에 넣을 수 없다. 대신
셋 다 전역 단조 카운터에서 새 세대를 받고, 커밋은 **떠날 때 본 세대와 같을 때만** 설치한다.
다르면 방금 세운 워처를 `abort()`(새 세션이었으면 `shutdown().await`) 한다 — **덮어쓰지
않는다. 나중 의도가 이긴다.** 세대를 전역에서 받으므로 "엔트리를 지웠다 다시 만든" 경우도
값이 달라져 하나로 둘을 잡는다. 버릴 워처는 맵 락 **밖**에서 정리한다.

## 검증

`cargo test --test oculpm_lock_scope` 7 passed · `cargo test --lib oculpm::manager::tests`
66 passed · `cargo fmt --check` exit 0 · `pnpm lint:filesize` clean.

**음성 대조를 돌려 무엇이 실제로 무는지 확인했다** (둘 다 되돌림):
`commit_watcher_start` 의 락 설치를 막으니 `takeover_...` 가 붉어졌다 — 이쪽은 문다.
반면 `on_project_closed` 의 `lifecycle_lock` 을 빼도 `close_racing_start...` 는 **통과했다**.
임시 디렉터리에서는 느린 구간이 밀리초 미만이라 `yield_now` 로 틈을 매번 찌르지 못한다.
그 둘은 순서에 의존하지 않는 불변식만 단언하는 **가드**이지 증명이 아니고, 테스트 주석에
그렇게 적었다.

**정직하게** — 3항목 전부 구조적 확정이지 측정이 아니다. 락이 IO 너머로 잡혀 있었다는
것은 코드로 확인했지만 **실제 대기 시간은 재지 않았고, 개선을 숫자로 주장하지 않는다.**

## 확인 못 함 (앱 미실행)

LSP 설정 화면의 서버 일람 · 첫 색인 시 임베딩 진행 배너 · 읽기 전용에서 주인 회수 토스트 ·
탭을 빨리 여닫을 때 세션 id 유지.

## 남은 것

- `watcher_stop` 이 **같은 병리를 하나 더** 갖고 있다 — 전역 맵 write 락을 쥔 채
  `watcher.stop().await` 로 드레인을 기다린다. 기준선이 잰 드레인이 4.3초였으므로 프로젝트
  하나를 끄는 동안 전 프로젝트의 manager 접근이 막힐 수 있다. 이번 3항목 밖이라 두었다.
- `oculpm/lock.rs` 의 `LockGuard::drop` 이 pid 로만 소유를 판정하는 것 자체가 구조적
  결함이다. 지금은 `lifecycle_lock` 이 그 상황을 막지만, 근본 해결은 가드에 무장 해제를
  두거나 프로세스 내 경로별 소유권을 등록하는 것이다.