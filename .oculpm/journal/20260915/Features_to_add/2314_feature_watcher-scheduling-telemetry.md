---
schema_version: 1
type: feature
slug: "watcher-scheduling-telemetry"
status: done
difficulty: medium
created_at: "2026-09-15T23:14:40+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/watcher_queue.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/lifecycle.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: update
  - path: "src-tauri/tests/perf_baseline.rs"
    op: update
  - path: "src-tauri/tests/watcher_backpressure.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/settings/DoctorSection.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/doctor_watcher_sched.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "perf"
  - "telemetry"
  - "watcher"
  - "diagnostics"
  - "optimization-round-2"
  - "parallel-session"
  - "mcp-tool"
---
[x] 워처 스케줄링 계측 — 이벤트·버림·큐 깊이/최대·처리 누적/최대 ms 를 WatcherSchedStats 로 진단 탭과 perf_baseline M2c 에

## 추가 기능

perf-baseline §7 이 "스케줄링을 재는 계측이 없다 — 워커가 얼마나 막혔나·큐가 얼마나 찼나·버림이 몇 번인가" 를 다음 라운드 숙제로 남겼고 v3-release `#scheduling-telemetry` 로 이월돼 있었다. 병렬 세션 WT 가 worktree 에서 구현, 커밋 `e732a476`.

### 동작 흐름

1. `watcher_queue.rs` `Shared` 에 atomics 넷 — `high_water`(push_batch 직후 depth 로 갱신) · `events_total` · `handle_us_total` · `handle_max_us`(`drain_loop` 에서 `sink.handle_event` 를 감싸 측정). `QueueMetrics` getter, 루프 종료 로그에 동승. 핫패스에 락 없음.
2. `spec.rs` `WatcherSchedStats { started_at, events_total, dropped_total, queue_depth, queue_high_water, handle_ms_total, handle_max_ms }` — `WatcherStatus.sched` 와 프런트에 실제로 닿는 봉투 `OculpmStatus.watcher_sched`, 둘 다 `#[serde(default)]`. `watcher/mod.rs` 에 `started_at`·`sched_stats()`, manager 의 Stopped 기본값. `bindings.ts` 재생성(+31).
3. 진단 탭 `DoctorSection.tsx` 「워처 계측」 행 — `이벤트 N · 버림 N · 큐 N/최대 N · 처리 누적 N.Ns · 최대 Nms`, 미실행이면 회색 점, 봉투에 필드가 없으면 「확인 실패」. i18n ko/en.
4. `perf_baseline.rs` M2 는 그대로 두고 **M2c** 추가 — 실제 `ProjectWatcher` 를 걸고 같은 파일 집합을 역방향 체크아웃으로 재생해 카운터 출력. 실측: `events_total 587 · dropped 0 · queue_high_water 577 · handle_ms_total 32ms · handle_max_ms 0ms · 정착 3,625ms`(날것 M2: 635 이벤트·4,245ms) — 즉 드레인 4초 중 handle_event 자체는 32ms, 나머지는 스케줄링·디바운스·정착 대기라는 게 처음으로 숫자로 보인다.

## 검증

- `watcher_backpressure.rs` +2(`scheduling_counters_follow_the_drain`·`high_water_is_the_deepest_moment_and_caps_at_capacity`, 관계만 단언) 14→16 · `oculpm::watcher` 16 · `export_bindings_typescript` · `perf_baseline m2 -- --ignored --nocapture` · fmt·clippy·파일 크기 clean.
- `doctor_watcher_sched.test.tsx` 3건, vitest 7파일 68 통과. `pnpm typecheck`·`pnpm lint` 0.
- 남긴 것: 큐 수준 `events_total` 과 옛 `events_seen_total`(WatcherInner, 경로 없는 이벤트 제외)이 공존 — 후자는 손대지 않음. 세션 액터의 `sessions.json` 플러시(~5초 뒤, `.oculpm/index/`)가 이벤트로 세이며 1단계에서 자기 억제됨(M2c 정착 로직에 메모). perf-baseline §7 문구는 원장 갱신(#ledger-update)에서 손본다.