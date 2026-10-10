---
schema_version: 1
type: bug
slug: "git-partial-clone-lazy-fetch-exec"
status: done
difficulty: medium
created_at: "2026-10-11T00:00:36+09:00"
session_id: "mcp-20261011-000036"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "8ea7b9ae-c829-4853-a394-c185809e360d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/safe.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "SECURITY.md"
    op: update
related:
  - ref: "20261009/Bugs/0407_bug_code-exec-boundary-acp-git-plugin.md"
    kind: "followup"
tags:
  - "security"
  - "code-trust"
  - "git"
  - "mcp-tool"
---
[x] 부분 클론에서 앱의 git show 가 저장소 설정의 uploadpack 을 띄우던 것 — GIT_NO_LAZY_FETCH

## 발생 원인
기동 원장 레인이 git 사유에 메모를 남겼다. 「부분 클론(promisor)이면 git 이 빠진 객체를 원격에서 지연으로 받을 수 있다 — 저장소 설정의 동작」. 재현해 보니 송출이 아니라 **코드 실행 문**이었다. 임시 부분 클론에 `remote.origin.uploadpack = sh -c 'touch 표식; exec git-upload-pack "$@"'` 를 두었다. 그 상태에서 옛 블롭을 `git show` 하면 표식이 생겼다(git 2.53).
`git::safe` 는 저장소 설정이 고른 프로그램(fsmonitor · 필터 · 외부 diff · 훅)을 끄는 유일한 창구다. 이 경로는 빠져 있었다. 문이 열리는 것은 압축 파일 · 공유 드라이브처럼 `.git` 째 받은 저장소다. 그런 저장소에서도 프로젝트를 추가하기만 하면 Today · 변경 화면이 사람 손 없이 git 을 돈다.

## 해결 방법
- 끄는 길을 비교했다. 모두 같은 재현으로 확인했다.
  - `-c remote.origin.uploadpack=git-upload-pack` 덮기 → 돌았다
  - `-c remote.origin.promisor=false` → 돌았다
  - `-c extensions.partialClone=` 비우기 → 돌았다
  - `--no-lazy-fetch` 와 `GIT_NO_LAZY_FETCH=1` 만 막았다
- `git::safe::cmd` 가 `GIT_NO_LAZY_FETCH=1` 을 싣는다. 모듈 문서 표 · SECURITY.md 코드 실행 표 · 기동 원장의 git 사유를 고쳤다.
- 대가: 부분 클론에서 아직 안 받은 옛 객체의 diff 는 실패로 보인다. 사용자의 git 이 받아 두면 다시 보인다. 2.44 미만 git 은 이 변수를 모른다(Ubuntu 24.04 기본은 2.43). 그 git 에서는 이 문이 남는다고 문서에 적었다.
- 회귀 시험 `partial_clone_lazy_fetch_cannot_run_repo_uploadpack`(unix, git 2.44 미만이면 건너뜀)을 두었다.
  - 처음엔 `git clone --filter` 로 만들었는데, 기동 원장의 `git_stays_local_only` 가 이 파일의 `clone` 글자를 잡았다. 옛 블롭 loose 객체를 지우고 promisor 를 다는 방식으로 다시 썼다.
  - 원장의 테스트 범위 표에도 등록했다.

## 검증
- 변이 시험: 가드 줄을 지우면 이 시험이 실패한다(두 판 모두 확인). 대조군(덮지 않은 git)은 표식을 만든다.
- cargo test --no-fail-fast 실패 0, PR #83 CI success.