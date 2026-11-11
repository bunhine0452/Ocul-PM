---
schema_version: 1
type: refactor
slug: "watcher-drain-off-git"
status: done
difficulty: medium
created_at: "2026-11-11T21:28:30+09:00"
session_id: "manual-20261111-212830"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/watcher/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/emit.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/handle.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/file_id_cache.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_queue.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_tasks.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/baseline.rs"
    op: update
  - path: "src-tauri/src/commands/window/mod.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/lib/recentChangesStore.ts"
    op: update
related:
  - ref: "20261111/Refactors/2127_refactor_windows-git-spawns.md"
    kind: "context"
tags:
  - "watcher"
  - "perf"
  - "windows"
---
[x] 워처: 소비 루프에서 git · 중복 읽기를 걷는다

## 동기
- 새 일지가 들어오면 소비 루프가 diff 캡처를 `await` 했다. 캡처는 git 을 여러 번 띄우므로, 일지 하나가 뒤따르는 이벤트를 수백 ms 붙잡았다.
- 파일 하나가 바뀔 때마다 `oculpm-file-changed` 를 모든 창에 보냈다.
- Windows 는 새 파일 하나를 Create 와 Modify 두 번으로 알린다. 그래서 같은 내용을 두 번 읽고 해시했고, 기준선 동기에서 한 번 더 읽었다.
- 디바운서의 파일 id 캐시는 사전 필터가 어차피 버릴 `target/` · `node_modules/` · `.git/` 파일도 하나하나 핸들을 열었다.

## 변경 요약
- diff 캡처와 라인 수 계산을 곁일 갈래 `Lane::Capture`(한 번에 하나)로 옮겼다. 끝나면 일지 경로 신호를 한 번 더 보내, Today 가 라인 수를 다시 읽는다.
- 파일 변경 신호를 묶음으로 보낸다. 큐가 빈 순간(정착)이나 256건이 찼을 때 `OculpmFileChanged { events }` 를 한 번 보낸다. 받는 쪽은 그 프로젝트를 연 창 하나다(`project_window_label`). 프런트는 묶음을 `pushAll` 로 넣어 구독자를 한 번만 깨운다.
- `stat_and_hash_with` 는 (길이, 수정 시각)이 그대로면 지난 해시를 다시 쓴다.
- 기준선 동기는 워처가 잰 해시가 저장된 스냅샷과 같으면 파일을 다시 읽지 않는다. 경로 판정과 읽기는 `spawn_blocking` 안에서 돈다.
- `OrderedFileIdCache` 는 사전 필터와 같은 판정으로 버릴 경로를 건너뛴다. 남는 경로의 이름 바꾸기 짝짓기는 그대로다.

## 검증
- `cargo test --lib -- spawn_count planner watcher` 142 passed (`paths_the_prefilter_drops_get_no_file_id` · `unchanged_file_is_hashed_once` 포함). `cargo clippy --all-targets -- -D warnings` exit 0
- `vitest run --maxWorkers=2` Tests 1085 passed (1085). `pnpm typecheck` exit 0, `pnpm lint` 6 gates 통과
- 설치본에서 직접 돌려 보지는 못했다. 창 하나에만 보내는 동작은 레지스트리 조회 코드를 읽어 확인한 것이다
