---
schema_version: 1
type: bug
slug: "port-fs-semantics-lfs"
status: done
difficulty: high
created_at: "2026-09-24T02:30:35+09:00"
session_id: "20260924-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/pid.rs"
    op: create
  - path: "src-tauri/src/git/path_form.rs"
    op: create
  - path: "src-tauri/src/oculpm/atomic_io_win.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher/repeat.rs"
    op: create
  - path: "src-tauri/src/oculpm/lock.rs"
    op: update
  - path: "src-tauri/src/oculpm/a2a/registry.rs"
    op: update
  - path: "src-tauri/src/oculpm/atomic_io.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/handle.rs"
    op: update
  - path: "src-tauri/src/git/repo.rs"
    op: update
  - path: "src-tauri/src/indexer.rs"
    op: update
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/tests/local_diff.rs"
    op: update
related:
  - ref: "20260924/Features_to_add/0058_feature_port-compile-baseline-w1.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "watcher"
  - "mcp-tool"
---
[x] Windows 경로·파일 의미론 — 저장 경로 '/'·pid 생사·원자적 쓰기·워처 (L-FS, PR #33)

## 발생 원인

W1 인벤토리 층 2 의 Windows 실패 19건 중 16건이 이 레인 몫이었다. 뿌리는 넷:
- **경로 구분자**: `to_string_lossy()` 로 만든 상대경로가 Windows 에서 `src\a.ts` — 워처 emit 분류·자기 억제·indexer 키·rule_scope 가 빗나갔다. 전체 색인(project.rs)과 워처 증분 색인의 키가 갈려 행이 둘 생기고 화해가 서로를 지우는 자리도 있었다.
- **pid 생사**: Windows 에서 Unknown 이라 죽은 락·a2a 카드·임대를 못 걷었다.
- **`\\?\` 와 8.3 이름**: `redact` 가 `//?/C:/…` 를 UNC 로 읽어 디렉터리 패턴을 조용히 빠뜨렸고, git `repo_relative` 는 긴 이름과 `RUNNER~1` 이 어긋나 중첩 저장소 diff 가 비었다.
- **Windows 파일 의미**: rename 이 열린 대상에서 공유 위반, 새 파일의 Create+Modify(Any) 재보고, 빈 파일 재쓰기가 mtime 을 안 바꿈, CRLF 파일에 CRLF 를 쓰면 `\r\r\n`.

## 해결 방법

- `src-tauri/src/pid.rs` 단일 창구(Alive/Dead/Unknown) — 유닉스는 a2a 의 `kill(pid,0)` 규칙(EPERM=살아 있음), Windows 는 `OpenProcess`+`GetExitCodeProcess`. `lock.rs`·`a2a/registry.rs` 가 쓴다.
- `git/path_form.rs` `slash`·`plain`·`relative_to`(유닉스 항등) → 워처·PreFilter·indexer·rule_scope·repo_relative·project.rs(오케스트레이터가 레인의 소유 밖 diff 반영).
- `atomic_io_win.rs`: 공유 위반 재시도·백오프(끝내 실패하면 에러), `write_atomic_new` 물러서기는 덮어쓰지 않는 `MoveFileExW`. `watcher/repeat.rs`(Windows 만): 해시 같은 Update 재보고만 걷는다.

## 오케스트레이터 검토

macOS 에서 바뀐 것은 좁다: 락 판정 `ps -p` fork → `kill(pid,0)`(예전 `ps` 를 쓴 이유였던 "타 사용자 프로세스 오판" 은 EPERM=살아 있음으로 그대로 막힌다), CRLF 파일에만 해당하는 두 수정. `path_form` 은 유닉스 항등.

## 검증

- portability 35892702004: ubuntu 초록(1,847), windows 이 레인 몫 16건 전부 초록 · 남은 3건은 다른 레인 몫. 새 테스트 36개가 windows 러너에서 실행돼 통과.
- 오케스트레이터 로컬 macOS(project.rs 반영 뒤): fmt · clippy · cargo test 1,848 통과 0 실패 · file-size clean · bindings diff 없음. PR #33 ci.yml 3잡 SUCCESS → rebase 머지 1393c683.
- CI 로 못 본 것: 실제 백신·에디터 잠금, FAT 볼륨 하드링크, RDCW 버퍼 넘침 → #w5-eyes. 후속은 W2+ (#fs-files-touched-norm · #fs-crlf-parsers · #fs-rename-pair).