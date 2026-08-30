---
schema_version: 1
type: bug
slug: backfill-reran-git-on-every-open
status: done
created_at: 2026-08-30T10:51:00+09:00
session_id: "manual-20260830-105100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/oculpm/entry_diffs.rs
    op: update
  - path: src-tauri/src/commands/oculpm.rs
    op: update
related: []
tags: [entry-diffs, startup, watcher, audit-round]
---

[x] 복구 불가한 일지의 diff 백필이 프로젝트를 열 때마다 git 을 다시 돌렸고, 그게 끝나야 워처가 켜졌다

## 발생 원인

`entry_diffs::persist` 는 4단 폴백이 전부 비면 **파일을 쓰지 않았다**. 그러면 `sidecar_exists` 가 영원히 false 라 `backfill_entry_diffs` 가 열 때마다 그 항목을 다시 집어 `git diff` + `git log --max-count=200 -- path` 를 파일마다 실행했다 — `oculpm_init` 의 "첫 회 뒤에는 거의 공짜" 주석은 이 항목들엔 거짓이었다. 게다가 `oculpm_init` 이 백필(2.6)과 라인 집계(2.7)를 **await** 했고 프런트(`ProjectTab.tsx`)는 init 이 끝나야 `oculpmWatcherStart` 를 부르므로, 오래된 프로젝트일수록 열기와 실시간 갱신 시작이 함께 늦어졌다.

## 해결 방법

- `persist` 가 빈 결과도 `files: []` 마커로 쓴다 — "봤는데 없더라" 의 기억. `sidecar_exists` 가 true 가 되어 백필이 건너뛴다.
- 단, `sidecar_is_current` 는 빈 마커를 현행으로 보지 않는다 — 변경 모달의 지연 복원(`read_or_reconstruct_entry_diffs`) 은 그 사이 파일이 커밋·색인됐을 수 있으니 한 번 더 시도할 수 있다. 백필은 건너뛰고 모달은 재시도하는 비대칭이 의도다.
- `oculpm_init` 이 `AppHandle` 을 받아 2.6/2.7 을 `tauri::async_runtime::spawn` 으로 보낸다. 둘 다 `.oculpm/index/diffs/`(워처 무시 경로)와 캐시 행만 쓰므로 워처 시작과 경합해도 안전하고, 2.7 이 2.6 의 결과를 읽는 순서는 태스크 안에서 유지한다.

## 검증

`empty_set_writes_marker_that_backfill_skips_but_reconstruct_retries`(마커 존재 · `sidecar_exists` true · `sidecar_is_current` false · 읽으면 빈 목록) + 기존 `capture_on_non_git_root_records_nothing` 이 그대로 통과. `cargo test` 그린. 프런트 호출 시그니처(`oculpmInit(projectId)`)는 불변 — `AppHandle` 은 Tauri 가 주입한다.

## 메모

`backfill_line_counts` 는 빈 마커를 0줄로 집계하고 작업 목록에서 떨어뜨린다 — 예전엔 사이드카가 없어 이쪽도 매번 다시 훑었다.
