---
schema_version: 1
type: refactor
slug: "windows-git-spawns"
status: done
difficulty: high
created_at: "2026-11-11T21:27:42+09:00"
session_id: "manual-20261111-212742"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/head.rs"
    op: create
  - path: "src-tauri/src/git/spawn_count_tests.rs"
    op: create
  - path: "src-tauri/src/git/safe.rs"
    op: update
  - path: "src-tauri/src/git/repo.rs"
    op: update
  - path: "src-tauri/src/git/blob.rs"
    op: update
  - path: "src-tauri/src/git/nesting.rs"
    op: update
  - path: "src-tauri/src/git/path_form.rs"
    op: update
  - path: "src-tauri/src/git/changes.rs"
    op: update
  - path: "src-tauri/src/git/status.rs"
    op: update
  - path: "src-tauri/src/git/authors.rs"
    op: update
  - path: "src-tauri/src/git/diff.rs"
    op: update
  - path: "src-tauri/src/git/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/entry_diffs.rs"
    op: update
  - path: "src-tauri/src/proc.rs"
    op: update
related: []
tags:
  - "git"
  - "perf"
  - "windows"
---
[x] git: 저장 · 변경 화면에 git 을 덜 띄운다

## 동기
Windows 에서는 프로세스 하나를 띄우는 데 10~30ms 가 든다. 그래서 git 을 몇 번 띄우는지가 곧 체감 속도다. 테스트 전용 계수기로 바꾸기 전 수를 쟀다.

- 변경 화면을 다시 읽을 때 6번
- 에이전트가 저장할 때 (다른 폴더, 새 파일) 3번 + 1번
- 따로 커밋된 6파일 일지의 diff 캡처에 18번

## 변경 요약
- `git::head` 를 새로 만들었다. `.git/HEAD`, ref, `packed-refs` 를 파일로 읽어 HEAD 커밋 oid 를 안다. reftable 저장소나 심볼릭 ref 사슬을 만나면 git 에 묻는다.
- 그 oid 를 열쇠로 세 가지를 기억한다.
  - HEAD 트리의 경로 집합. 이제 `path_in_head` 가 저장할 때마다 `cat-file -e` 를 띄우지 않는다.
  - 직전 커밋의 변경 목록. 예전 git 3번(`log` · `rev-parse` · `diff`)이 `show -z --name-status -m --first-parent` 한 번이 됐다.
  - 동료 일지 `log` 결과.
- 가지 이름은 `.git/HEAD` 에서 읽는다. `remote -v` 결과는 설정 파일 시각이 그대로면 다시 쓴다. `user.email` 도 설정 파일 시각과 5분 기한으로 기억한다.
- 동료 일지 `log` 에는 `--since` 를 붙이지 않았다. 일지 폴더의 날짜가 그 일지를 더한 커밋의 날짜를 묶어 두지 않기 때문이다.
- `repo_root_for` 와 필터 덮개 캐시의 열쇠를 「위로 처음 만나는 `.git`」 으로 바꿨다. 기억은 10분 간다. 워크트리는 `gitdir` 를 따라가 설정 시각을 본다.
- `repo_relative` 는 저장소 canonicalize 결과를 기억한다. 열쇠는 `\\?\`, `/`, 대소문자를 편 모양이다.
- `safe::output` 이 5ms 마다 `try_wait` 하던 폴링을 없앴다. 이제 감시 스레드가 기한을 지키고, 기한을 넘기면 자식을 죽인다.
- `proc::std_cmd` 는 PATH×PATHEXT 의 첫 적중을 60초 기억한다. 기억한 파일이 사라지면 다시 찾는다. 배치 파일만 전체 경로로 넘기는 판정은 그대로다.
- 일지 diff 캡처의 3단계를 묶었다. 저장소마다 `log` 한 번, 고른 커밋마다 `show` 한 번이다. `--no-renames` 를 붙여 한 파일씩 물을 때와 출력이 같다. 차이 하나: 합류 커밋은 후보에서 빠진다.

## 검증
- `cargo test --lib spawn_count -- --nocapture`: 변경 화면 다시 읽기 6→1, 저장 두 번 4→0, 따로 커밋된 6파일 캡처 18→10, 한 커밋에 묶인 6파일 캡처 5 — 4 passed
- `cargo test --no-fail-fast`: lib 962 passed. 통합 테스트는 `oculpm_lock_scope` 1건만 붉다 — `sleep 을 띄우지 못했다: program not found`. 이 PC 에 `sleep` 이 없어서이고, 그 테스트는 `std::process::Command` 를 직접 쓴다
- `cargo clippy --all-targets -- -D warnings` exit 0 · `cargo fmt --check` exit 0

## 메모
- `core.fsmonitor=false` 를 포함한 `safe` 의 덮개 규칙은 그대로 두었다. 모든 git 호출은 여전히 `git::safe` 를 지난다.
- 시험 픽스처 `git/spawn_count_tests.rs` 를 기동 원장(`tests/egress_spawn_ledger/sites.rs`)에 로컬로 등록했다.
