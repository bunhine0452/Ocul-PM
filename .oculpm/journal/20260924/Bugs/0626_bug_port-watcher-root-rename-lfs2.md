---
schema_version: 1
type: bug
slug: "port-watcher-root-rename-lfs2"
status: done
difficulty: high
created_at: "2026-09-24T06:26:07+09:00"
session_id: "20260924-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/index/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/index/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/session/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/tests_windows.rs"
    op: create
related:
  - ref: "20260924/Bugs/0230_bug_port-fs-semantics-lfs.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "watcher"
  - "mcp-tool"
---
[x] Windows 에서 감시 중인 프로젝트를 못 옮기던 창 — 세션 시작 git 4→2 (L-FS2, PR #38)

## 발생 원인

`watcher::removing_the_project_root_does_not_resurrect_it` 가 Windows 에서 간헐적으로 루트 rename `Access is denied`(3회 관측). 테스트만의 문제가 아니라 **앱이 감시 중일 때 사용자가 탐색기에서 프로젝트 폴더를 휴지통으로 보내면 「사용 중」 이 뜰 수 있는** 자리였다.

L-FS2 세션이 windows 러너에서 증거로 확정: 앱이 계속 쥔 핸들이 아니다(실패 순간 루트 아래 우리 핸들 35회 전부 0개, ReadDirectoryChangesW 는 루트 **자신**을 감시해 이름 바꾸기를 막지 않는다). **그날 첫 세션 시작**(git 4회 `current_dir(root)` · 트리 해시 · fsync 쓰기)과 겹친 짧은 창이었다 — 반복 8/30, 기다림 쓸기에서 450ms 이하에서만 거부, git 을 PATH 에서 빼면 0/30. Windows 규칙: 열린 파일(공유 플래그 무관)·하위 폴더 핸들·자식 CWD 는 막는다 — `FILE_SHARE_DELETE` 로는 안 풀린다.

## 해결 방법

- 세션 시작의 git 4→2(`git rev-parse HEAD --abbrev-ref HEAD` 한 번 + 스냅숏 HEAD 재사용). 기록 값은 같다 — 세 OS 단언 테스트. 거부 20/54 → 15/54.
- 창은 남는다(트리 해시·fsync 는 내구성) — 그 순간엔 탐색기의 「다시 시도」 로 풀린다. 원래 테스트는 세션이 열린 뒤 옮기고 Windows 만 1초 물러선다. 새 테스트: 감시·세션이 열린 프로젝트를 **셸 휴지통으로 보내고 비우기**.

## 검증

- windows 반복: 고친 테스트 40/40 · 휴지통 15/15 · 병렬 부하 15/15. PR #38 portability 재시도(attempt 2): windows 1,959 통과 0 실패, L-FS2 테스트 4개 초록. ci.yml 3잡 SUCCESS → rebase 머지 d39d5a0d. **W2 전부 합류.**
- 같은 run 의 첫 시도에서 `lsp_rust_analyzer` 2건이 60s 시한 초과(재시도 초록) — 서버 6개 병렬 적재 경합, 테스트 직렬화로 별도 수정(port/lsp-flake).
- 남는 제약(플랜): 감시 중 루트의 **상위 폴더** 이동 불가(#w5-eyes), CWD 가 루트인 LSP·DAP·PTY 셸이 도는 동안 이동 불가(#os-child-cwd-lock). L-FS2 가 고안한 "macOS 에서 Windows 타깃 cargo check 20초" 요령은 메모리·레인 브리프에.