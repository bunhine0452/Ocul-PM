---
schema_version: 1
type: refactor
slug: "lock-scope-and-watcher-prefilter"
status: done
difficulty: high
created_at: "2026-09-07T20:27:20+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/lock.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/lifecycle.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/session_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/watcher_commit.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_queue.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/tests/oculpm_lock_scope.rs"
    op: update
  - path: "src-tauri/tests/watcher_backpressure.rs"
    op: update
  - path: "src/features/settings/tabs/DoctorSection.tsx"
    op: update
related: []
tags:
  - "watcher"
  - "lock"
  - "perf"
  - "v3-release"
  - "mcp-tool"
---
[x] 락을 쥔 채 기다리지 않고, 빌드 폭풍은 큐 앞에서 걸러진다

## 동기

v3-release 의 `{#v242-watcher-stop-lock}` · `{#lockguard-disarm}` · `{#watcher-drain-time}` ·
`{#watcher-prefilter}` · `{#dropped-total-surface}` 다섯 항목. 전부 "측정은 끝났고 손만 안 댄"
자리였다.

## 변경 요약

**① 락을 쥔 채 await 하지 않는다.** `watcher_stop` 이 전역 맵 write 락을 쥔 채
`watcher.stop().await` 로 드레인(측정치 4.3초)을 기다리던 것을, 가드 수명을 "핸들 꺼내기"
블록까지로 줄였다. `manager/**` 의 `projects` 락 41자리를 전수 확인한 결과 write 락을 await
너머로 끄는 곳은 이 하나뿐이었고, 대신 `session_ops.rs` 에 **read 가드를 IO·액터 왕복 너머로**
끄는 4자리가 있어 같이 고쳤다 (`get_current_session` · `start_session_manual` ·
`get_file_changes` · `get_index_snapshot` — 손잡이만 복제하고 락 밖에서 await).

**② 같은 경로의 가드 둘이 서로의 락 파일을 지우지 않는다.** `LockGuard::drop` 이 "디스크 pid ==
내 pid" 로만 소유를 판정해, 한 프로세스 안에 같은 경로 가드가 둘이면 먼저 떨어지는 쪽이 살아
있는 쪽의 파일을 지웠다. 프로세스 내 경로별 등록(`LOCK_REGISTRY`)을 도입해 삭제 자격을
"이 프로세스의 마지막 가드 && 디스크 파일이 아직 우리 것" 으로 좁혔다. 덕분에
`watcher_commit.rs` 가 하트비트를 영구히 새게 두던 `std::mem::forget(g)` 회피책도
`drop(g)` 로 되돌렸다.

**③ gitignore 판정을 채널 **앞**으로.** `watcher_queue::PreFilter` 가 링에 넣기 전에 거른다.
`target/`(이 저장소 55,663 파일)이 큐에 아예 안 들어온다. 삼키면 안 되는 것은 명시 예외로
통과시킨다 — `.oculpm/**`(감독관 프로브 `.oculpm/index/.watchdog` 포함) · 어댑터 마커 ·
규칙 경로. 소비자의 6단계 앞 분기가 전부 이 셋 안에 들어감을 확인했다. 걸러진 수는
`prefiltered_total` 로 따로 세고 **버림으로 세지 않는다** — 손실이 아니므로 재동기화도 안 켠다.

**④ 버림을 화면이 말한다.** `WatcherStatus.dropped_total` 을 만들고 `OculpmStatus` 봉투에
실어 닥터까지 보냈다. 「감시 중」만 말하면 큐가 넘쳐 이벤트를 흘린 워처가 건강한 워처와 글자
하나 다르지 않다 — 버림이 있으면 그 수를 말하고 만회 수단(재색인)을 같이 준다.

## 검증

- 신규 테스트: `two_guards_on_one_path_never_delete_each_others_lock_file` ·
  `prefilter_never_swallows_what_the_consumer_judges_first` ·
  `a_build_storm_no_longer_reaches_the_ring`(target/ 5,000건 + src 1건 → 링에 **1건**,
  prefiltered 5,000, dropped 0, 재동기화 안 켜짐).
- `cargo test` 30개 바이너리 전부 ok · `cargo clippy --all-targets -- -D warnings` exit 0.
- `pnpm typecheck` · `pnpm lint`(6게이트, 경고 정확히 50) · `pnpm test`(186파일/2,426건) ·
  `pnpm build` 전부 exit 0.
- 육안 미확인: 닥터의 버림 행은 실제로 큐를 넘치게 만들어 봐야 한다 (v3-release `{#eyes-v242}`).