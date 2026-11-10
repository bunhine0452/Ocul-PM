---
schema_version: 1
type: bug
slug: "windows-rust-ci-red-tests"
status: done
difficulty: medium
created_at: "2026-11-10T19:48:24+09:00"
session_id: "manual-20261110-194824"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/file_guard.rs"
    op: update
  - path: "src-tauri/src/commands/editor_choice.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
related:
  - ref: "20261110/Bugs/1917_bug_terminal-pwsh-on-windows.md"
    kind: "context"
tags:
  - "잠금"
  - "windows"
  - "ci"
---
[x] 잠금: Windows 접근 거부를 기다렸다 잡는다

## 발생 원인
릴리스 게이트(`cargo test`)를 Windows 에서 처음 돌리자 둘이 붉었다. main 의 portability.yml 「Rust — windows-latest」 도 v4.8.0 · v4.9.0 커밋에서 같은 둘로 붉어 있었다(미리보기 잡이라 릴리스를 막지 않았다).

- `file_guard::only_one_thread_is_inside_at_a_time`(간헐): CI 로그 `Io { …\.thing.lock, Os { code: 5, PermissionDenied, "Access is denied." } }`. 막 놓인 잠금 파일을 다른 프로세스(백신 · 색인기 추정)가 잠깐 열고 있으면 Windows 는 그 이름을 「삭제 대기」 로 남긴다. 그 자리에 `create_new` 하면 `AlreadyExists` 가 아니라 접근 거부가 나고, `acquire` 는 그것을 곧장 `Io` 로 돌려줬다.
- **제품 결함이다.** 앱 · `oculpm` CLI · MCP 서버가 같은 기록을 거의 동시에 고칠 때 Windows 에서 기다리지 않고 실패할 수 있었다.
- `editor_choice::cli_args_put_the_project_first`(늘): 기댓값을 `"/Users/me/proj/src/a b.rs:7"` 로 적어, Windows 의 `join` 이 만드는 `…\src/a b.rs:7` 와 어긋났다. 제품은 OS 경로를 그대로 넘기므로 맞고, 테스트만 틀렸다.

## 해결 방법
- `FileGuard::acquire`: Windows 의 `PermissionDenied` 는 기다림 예산 안에서 「쥐고 있음」 처럼 다시 시도한다. 그 파일은 곧 사라지므로 걷어내기는 하지 않는다. 예산이 다하도록 그대로면 진짜 권한 문제로 보고 `Io`. 기다림 한 칸은 `wait_one_step` 으로 모았다.
- 재현 테스트 `windows_delete_pending_lock_is_waited_out_not_an_error`: 이 PC(Windows 11)의 `remove_file` 은 열린 핸들이 있어도 이름을 바로 비운다(POSIX 식). 그래서 그것으로는 재현이 안 됐고, `FileDispositionInfo` 로 옛 방식 삭제 표시를 직접 걸어 「삭제 대기」 를 만든다. 고치기 전 코드에서 CI 와 같은 `Os { code: 5 }` 로 실패하는 것을 봤다.
- `editor_choice` 기댓값은 `format!("{}:7", file.display())`.
- 같은 게이트에서 `egress_spawn_ledger` 가 새 기동 자리(`CommandBuilder::new(pwsh)`, 1917 일지)를 잡았다. 원장(`sites.rs`)에 송출 가능 · 사유와 함께 등록했다.

## 검증
- `cargo test --lib oculpm::file_guard` → 10 passed (재현 테스트는 고치기 전 FAILED: `Io { … code: 5 … }`). `cargo test --lib commands::editor_choice` → 9 passed
- `cargo test --test egress_spawn_ledger` → 원장 등록 뒤 통과(전체 `cargo test --no-fail-fast` 결과는 플랜 로그 판정 줄)
