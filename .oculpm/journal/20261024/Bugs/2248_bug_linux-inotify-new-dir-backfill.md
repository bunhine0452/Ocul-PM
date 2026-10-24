---
schema_version: 1
type: bug
slug: "linux-inotify-new-dir-backfill"
status: done
difficulty: high
created_at: "2026-10-24T22:48:31+09:00"
session_id: "20261024-007"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/watcher/new_dir.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher/handle.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/tests_new_dir.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher/mod.rs"
    op: update
  - path: "CHANGELOG.md"
    op: update
related:
  - ref: "20261024/Bugs/2156_bug_release-blockers-linux-deeplink-tests.md"
    kind: "followup"
tags:
  - "watcher"
  - "linux"
  - "e2e"
  - "bug"
  - "mcp-tool"
---
[x] 리눅스 새 폴더 경합 — 감시가 걸리기 전 생긴 파일을 따라잡는다 (E2E 간헐 실패 · v3.13.6 리눅스 빠짐의 원인)

## 발생 원인

v3.13.6 릴리스 run 의 설치본 E2E(linux) 「사이드카 journal_write → 일지 화면 60초」 실패로 리눅스 판이 빠졌다. 같은 항목이 10-10 a700e880 · 863e8036, 10-17 8983ac0b, 10-24 6e42ea61 · 81434d3f 에서도 실패 — 이번 라운드와 무관한 오래된 간헐. 실패한 앱 로그에는 감시가 켜진 뒤 `.oculpm/journal/` 이벤트가 **한 줄도** 없고, 통과한 로그에는 최종 파일 Create 하나가 있다.

inotify 는 폴더마다 감시를 건다. 사이드카 `write_atomic_new` 는 `create_dir_all(날짜/종류)` → 임시 파일 → 하드링크 게시 → 임시 삭제라, notify 가 새 폴더에 감시를 걸기 전에 안쪽 일이 끝나면 아무 이벤트도 없다. Docker(rust:1.85, 같은 notify 6.1.1 · debouncer 0.3.2)에서 같은 순서 200회: **140 · 147 · 174 건 놓침**, 새 폴더를 훑으면 3회 모두 **0**.

## 해결 방법

- `watcher/new_dir.rs`: `backfills_new_dirs()`(리눅스만) · `files_in_new_dir(dir, cap=2000)` 깊이 우선·링크 안 따라감.
- `handle_event`: Create 이벤트의 경로가 폴더면 그 안 파일을 `Create(File)` 로 합성해 같은 `handle_path` 파이프라인에 태운다 — 일지 캐시·ndjson·색인 모두. 진짜 이벤트가 겹쳐도 같은 결과로 수렴.
- 테스트: 새 폴더 두 단계 + 링크 게시 20회가 전부 ndjson 에 남는지(`tests_new_dir.rs`, 모든 OS — 리눅스 CI 가 실제 inotify 로 검증). 새 모듈 단위 테스트(상한·링크·없는 폴더). tests.rs 래칫 때문에 옆 파일로.

## 검증

- macOS: cargo test --locked --no-fail-fast 실패 0 · clippy -D warnings · 래칫 clean. 리눅스: 컨테이너 재현 0건 + PR 의 Portability/E2E(ubuntu) 로 확인 예정.