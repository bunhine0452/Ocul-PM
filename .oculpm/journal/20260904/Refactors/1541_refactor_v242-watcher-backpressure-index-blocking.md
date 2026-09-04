---
schema_version: 1
type: refactor
slug: "v242-watcher-backpressure-index-blocking"
status: done
difficulty: superhigh
created_at: "2026-09-04T15:41:50+09:00"
session_id: "20260904-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "a7a49ff0-edf2-49a1-a1f7-e2c9be2e746a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_queue.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher_tasks.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/tests/watcher_backpressure.rs"
    op: create
related: []
tags:
  - "watcher"
  - "backpressure"
  - "indexer"
  - "v2.42.0"
  - "mcp-tool"
---
[x] 큐에 바닥을 깔고, 6.4초짜리 심을 워커에서 내렸다

## 동기

측정이 먼저였다 (`docs/20260904_v242-load-bearing/perf-baseline.md`). 네 항목 중 둘은
크기가 플랜의 서술과 달랐고, 그 차이가 이 작업의 우선순위를 바꿨다.

## 변경 요약

**`{#watcher-bounded}`** — `git checkout` 한 번(378파일)이 **한 배치에 1,058 이벤트**를
unbounded 채널에 부었다. 게다가 채널은 gitignore 판정 **이전**이라 `target/`(지금 55,663
파일) 쓰기도 전부 들어온다. 상한이 없었다.

용량 **4,096 이벤트**의 유계 링(`VecDeque` + `Notify`) + **drop-oldest**. tokio 의 bounded
mpsc 로는 앞을 못 버려서(`try_send` 실패 = drop-**newest**) 직접 만들었다. 생산자(notify
워커 스레드)는 채널이 아니라 **마이크로초짜리 std 뮤텍스**만 잡으므로 막히지 않는다 —
막히면 OS 워처가 이벤트를 들고 있게 되어 유실·메모리 위험이라고 파일 상단 주석이 이미
경고한다.

용량 4,096 의 근거 셋: 측정된 최악 정상 버스트(1,058)의 **3.9배**라 브랜치 전환·리베이스·
대형 머지가 버림 없이 통과하고(정상 동작에서 버리면 재동기화가 상시로 돌아 백프레셔가
되레 부하가 된다), 단위가 **배치가 아니라 이벤트**여야 한 번의 체크아웃이 통째로 안
버려지며, `DebouncedEvent` 하나가 경로 힙까지 ~200B 라 **1MB 남짓**에서 멈춘다.

**버림은 조용하지 않다.** 정착 후 기존 `reindex_journal_cache_incremental` 로 만회하고,
기존 `OculpmIntegrityWarning`(kind `watcher_overflow`)으로 알린다. **새 커맨드·새 이벤트·
마이그레이션 0** — `bindings.ts` 무변경을 확인했다. 코드 검색 색인 전체 재구축은 **일부러
안 부른다**: 워커 6.4초 점유라 버림을 갚는 값보다 비싸고, 백프레셔를 걸어 놓고 그보다 큰
폭풍을 부르는 꼴이다.

**`{#index-project-blocking}`** — 이 라운드 최대 발견. `walk` 204 ms +
read/blake3/tree-sitter **6,207 ms** = 워커 1개를 **6,411 ms** 통째로 점유했다. CPU 구간을
셋(`walk_text_files`·`prepare_file`·`chunk_file`)으로 갈라 `spawn_blocking` 으로 넘긴다.
`IndexConfig` 를 `Arc` 로 바꿔 파일당 clone 을 없앴고, `content` 는 blocking 에 넘겼다
돌려받아 복사가 없다. 진행률 100 ms 스로틀과 첫/마지막 전송은 그대로.

**`{#index-semaphore}`** — 두 `schedule_*` 이 detached 라 프로젝트를 닫아도 DB 를 계속
두드렸다. 갈래별 `Semaphore`(색인 2 / 히스토리 4) + `watch` 취소로 워처 수명에 묶었다.
임베딩이 전역 뮤텍스로 어차피 직렬화되므로 색인 동시성을 더 줘도 처리량은 그대로인 채 OS
스레드만 파킹된다. 히스토리 버스트가 색인을 굶기면 안 되므로 갈래를 나눴다. 새 의존성 0.

**`{#classify-blocking}`** — `spawn_blocking` 으로 옮겼다. **성능 개선이 아니다**: 측정대로
체크아웃당 33 ms, 최악 단일 파일 36 ms. 위생 수정이고 코드 주석에도 그렇게 적었다.

## 테스트가 진짜 버그를 잡았다

`shutdown_cancels_work_that_has_not_started` 가 처음 두 번 붉었다. 원인은 **`shutdown()`
의 순서**였다 — 취소 신호를 먼저 보내면 돌고 있던 곁일이 깨어나 퍼밋을 놓고, 그 퍼밋이
대기 중이던 곁일에게 넘어가 8개 중 4개가 **내려가는 중에 실행됐다.** `close()` 를 먼저
하도록 바꿔 고쳤다. 두 번째 실패는 테스트 자체의 레이스(스폰 순서 ≠ 실행 순서)라 퍼밋
보유 신호를 기다리도록 결정론화했다.

## 한계를 분명히

**기준선의 4.3초 드레인은 큐를 유계로 만든다고 줄지 않는다.** `handle_event` 는 여전히
직렬이고, 이번 변경이 고치는 것은 **메모리 상한과 만회 가능성**이지 드레인 시간이 아니다.
드레인을 줄이려면 gitignore 판정을 채널 **앞**으로 당기거나(`target/` 55,663 파일이 큐에
안 들어오게) 소비를 배치화해야 하고, 그건 이번 범위 밖이다.

## 래칫이 설계를 정했다

`watcher.rs` 는 2,241 → **2,164 (−77)**. 새 로직은 `watcher_queue.rs`(251) ·
`watcher_tasks.rs`(352) 로 나갔고 `indexer.rs` 는 **무변경**이다. `commands/project.rs` 는
573 → 654 (한계 800).

## 검증

`cargo test --test watcher_backpressure` 11 passed (8회 반복 전부 ok) ·
`cargo test --lib watcher` 36 passed · `cargo test --lib export_bindings` 1 passed 후
`bindings.ts` 드리프트 없음 · `cargo test --test lite_w6_safety_net` 6 passed ·
`cargo check --lib` 경고 0 · `pnpm lint:filesize`·`lint:i18n`·`lint:bindings` clean.

## 확인 못 함 (앱 미실행)

`index_project` 실경로 1회(`AppHandle`+`Channel` 이 필요해 테스트가 없다 — 진행률이 예전처럼
닫히는지, 결과 수치가 같은지) · 큐 오버플로 실경로(4,096 을 넘기려면 `cargo build` 급 폭풍이
필요하다 — 경고 로그 → 만회 로그 → 토스트) · 재동기화 후 6화면 재조회 · 프로젝트를 닫은 뒤
`auto-index`/`local history` 로그가 멈추는지 · 게이트를 얹은 뒤에도 저장마다 판이 남는지.

## 손대지 않은 것

`WatcherStatus` 에 `dropped_total` 을 노출하면 진단 화면에서 버림을 볼 수 있지만
`spec.rs` 수정 + `bindings.ts` 재생성 + 프런트 변경이 필요해 하지 않았다. 지금 버림은
로그와 무결성 경고 토스트로만 보인다.