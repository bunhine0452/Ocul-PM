---
schema_version: 1
type: bug
slug: "fsevents-sticky-created-flag"
status: done
difficulty: high
created_at: "2026-10-01T18:27:11+09:00"
session_id: "20261001-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/watcher/fsevents.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/tests.rs"
    op: update
related:
  - ref: "20260928/Bugs/2249_bug_port-crlf-anchor-rename-paths.md"
    kind: "followup"
tags:
  - "watcher"
  - "macos"
  - "cross-platform"
  - "mcp-tool"
---
[x] macOS 이름 바꾸기·지우기가 워처에서 사라짐 — FSEvents 의 끈적한 ItemCreated 를 디바운서 앞에서 걷는다

## 발생 원인

`cross-platform-port {#fs-mac-rename-old-name}` (L-FS3 발견). 독립 프로브(notify 6.1.1 + notify-debouncer-full 0.3.2, 시나리오 7개)로 원시·디바운스 이벤트를 나란히 찍어 확인했다.

- FSEvents(`kFSEventStreamCreateFlagFileEvents`)의 깃발은 경로에 **누적**된다. 최근에 만든 파일이면 그 뒤 **모든** 기록에 `ItemCreated` 가 다시 붙는다 — 감시 시작 1.5초 전에 만든 파일도. notify 는 기록 하나를 `Create → Remove → Modify(Name) → Modify(Metadata) → Modify(Data)` 순서로 풀어 디바운서에 넣는다.
- **이름 바꾸기** `a → b`: 옛 이름의 파일 id 가 디바운서 캐시에 있으면(세션 안에서 한 번이라도 수정·생성됨) 짝을 짓고, 원천 큐 맨 앞이 그 끈적한 `Create` 라 `push_rename_event` 가 "막 만든 파일의 이름 바꾸기" 로 보고 **`Create(b)` 하나로 접는다**. 옛 이름의 삭제가 통째로 사라져 ndjson·일지 캐시에 옛 이름 행이 남았다.
- **지우기**(새로 찾음): `Create` 뒤의 `Remove` 를 "만들었다 지운 것" 으로 접어 없애고, 같은 기록의 뒤따르는 속성·내용 깃발만 남긴다 → 없는 파일의 `Modify` 둘 → ndjson 에 **수정**(`Update`, 해시 없음)으로 찍혔다. 삭제가 한 번도 삭제로 기록되지 않았다.

## 해결 방법

- `watcher/fsevents.rs` — `StaleFlagFilter`: 원시 이벤트를 받는 순간 경로가 디스크에 없는데 그 이벤트가 `Create` 거나 내용·속성 `Modify` 면 버린다. 사라진 사실은 같은 기록의 `Remove`·`Modify(Name)` 이 말하고, 그것들은 그대로 넘긴다(깨진 심링크는 `symlink_metadata` 로 "있음"). `StaleFlagWatcher` 가 `FsEventWatcher` 를 감싸 처리기만 바꾼다.
- `watcher/mod.rs` — `new_debouncer` → `new_debouncer_opt::<_, OsWatcher, FileIdMap>`. `OsWatcher` 는 macOS 만 `StaleFlagWatcher`, 나머지는 `RecommendedWatcher` 그대로 (inotify·ReadDirectoryChangesW 는 깃발이 누적되지 않는다). 모듈은 `cfg(any(macos, test))` 라 리눅스·윈도우 빌드에 죽은 코드가 안 생긴다.
- 대가: 아주 짧게 산 파일(만들고 곧바로 지움)은 예전엔 수정 행 둘이었고 이제 삭제 행 하나다. 원자적 저장의 임시 이름은 생성+삭제 두 행에서 삭제 한 행으로 준다.
- 함께 적혀 있던 `read_journal_excerpt` CRLF 발췌는 이미 9c8d9280(L-PLAN2)이 고쳐 놓았다 — 코드 변경 없음.

## 검증

- 수정 전 macOS 에서 붉음 확인: `a_rename_records_both_the_old_and_the_new_name` 의 macOS 제외(`cfg(not(macos))`)를 걷어내자 옛 이름 삭제 없음, 새 `deleting_a_file_records_a_delete` 는 마지막 op 가 `Update`. 수정 후 둘 다 초록, 워처 스위트 35건 6회 반복 전부 통과. 필터 단위 테스트 4건(프로브가 본 기록 그대로 재생·있는 경로 무손상·재스캔/오류 통과·깨진 심링크).
- `cargo fmt --check` · `clippy --all-targets -D warnings` · `cargo test` 전 스위트 통과(같은 run 의 `plan_log_archive` 1건은 이 변경과 무관한 날짜 의존 — 별도 일지).
- 리눅스·윈도우는 CI 러너가 본다(새 삭제 테스트가 세 OS 에서 돈다).