---
schema_version: 1
type: bug
slug: "deleted-project-root-resurrected"
status: done
difficulty: medium
created_at: "2026-09-17T19:45:20+09:00"
session_id: "20260917-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "290a8fb0-9f4c-49fa-920f-30e191ab7dbf"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/watcher/handle.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/index/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/index/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/tests.rs"
    op: update
related: []
tags:
  - "watcher"
  - "session"
  - "index"
  - "finder"
  - "regression-test"
  - "mcp-tool"
---
[x] Finder 에서 지운 프로젝트 폴더가 빈 채로 되살아남 — 삭제 이벤트가 세션을 열고 그 쓰기가 루트를 다시 만들었다

## 발생 원인

앱을 켜 둔 채 Finder 에서 추적 중인 프로젝트 폴더를 지우면(휴지통 이동 = 디렉터리 이름 바꾸기) 잠시 뒤 같은 자리에 빈 폴더가 다시 생겼다 — 실제로는 숨김 `.oculpm/index/…` 만 든 폴더.

경로는 이렇다. 삭제가 만든 fs 이벤트(루트 자신의 rename → 상대경로 `""`, 그리고 하위 파일 Remove)가 워처 `handle_event` 를 그대로 통과한다: `path.is_dir()` 는 이미 없는 경로라 false, `is_directory_event` 는 rename 에 디렉터리 정보가 없어 false, `classify` 는 "파일이 없다 → Delete" 로 분류해 `note_activity` 로 넘긴다. 세션 액터는 이걸 활동으로 읽어 세션을 열고 `IndexWriter::upsert_session` 을 부르는데, 그 앞의 `ensure_workday_dirs` 의 `create_dir_all` 이 `<root>/.oculpm/index/<workday>/` 를 지운 자리에 다시 만든다. 오늘 로그가 그대로 보여 준다 — `demo-notes`(project 24) 는 삭제 직후 19:10:34 에 세션이 시작됐고 11초 뒤 사용자가 앱에서 프로젝트를 지웠다.

감독관(`supervisor::tick`)은 이미 `root.is_dir()` 가드가 있어 되살리지 않는다 — 구멍은 워처 → 세션 → 색인 쓰기 경로였다.

## 해결 방법

두 겹으로 막았다.

- `watcher/handle.rs` — 이벤트마다 0단계로 `self.root.is_dir()` 를 본다. 없으면 버리고(`bump_ignored`), 래치(`root_gone_logged`)로 `[FLOW] 프로젝트 루트가 사라졌다` 를 한 번만 남긴다 (폴더 하나 지우면 이벤트가 수백 개다). 루트가 돌아오면(휴지통 되돌림) 래치를 푼다. 루트 자신에 대한 이벤트(빈 상대경로)도 파일 변경이 아니므로 버린다. 여기서 먼저 끊어야 히스토리 캡처·증분 색인·자동화 타이머까지 헛돌지 않는다.
- `index/mod.rs` — `IndexWriter::ensure_root_present` 를 두고 `ensure_workday_dirs` · `write_sessions_file` · `capture_snapshot` 이 모두 지난다. 이미 열려 있던 세션이 나중에 비활성 타임아웃이나 앱 종료로 마감될 때의 쓰기도 루트를 되살리지 않는다. 루트가 없는 채로 쓰기를 기다리는 정당한 순간은 없다 — `init_project` 가 `.oculpm/` 을 만든 뒤에야 세션이 시작된다.

되살리지 않을 뿐, 워처를 스스로 내리지는 않는다 — 휴지통에서 되돌리면 그대로 이어 쓴다.

## 검증

- 회귀 테스트 2개: `index::tests::writes_after_root_removal_do_not_resurrect_it`(세션 upsert·ndjson·스냅샷·디렉터리 생성 네 경로) · `watcher::tests::removing_the_project_root_does_not_resurrect_it`(실제 notify 로 루트를 sibling 로 rename). 수정을 stash 하고 돌리면 둘 다 `project/.oculpm` 이 되살아나 실패, 수정 후 통과.
- `cargo test --lib` 1487 통과 · clippy `-D warnings` · fmt 깨끗.