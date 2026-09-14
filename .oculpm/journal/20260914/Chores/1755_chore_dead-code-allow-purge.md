---
schema_version: 1
type: chore
slug: "dead-code-allow-purge"
status: done
difficulty: low
created_at: "2026-09-14T17:55:58+09:00"
session_id: "20260914-001"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d8c385d3-64d1-435b-abff-82b045ae0918"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/embedding.rs"
    op: update
  - path: "src-tauri/src/git.rs"
    op: update
  - path: "src-tauri/src/llm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/session/tests.rs"
    op: update
  - path: ".oculpm/planner/improvement-round-2026-09-14.md"
    op: create
related:
  - ref: "20260914/Chores/1720_chore_improvement-audit-2026-09-14.md"
    kind: "followup"
tags:
  - "rust"
  - "hygiene"
  - "planner"
  - "git"
  - "audit-2026-09-14"
  - "mcp-tool"
---
[x] allow(dead_code) 40곳 제거 — 드러난 죽은 심볼은 4개뿐 · 워킹트리 정리 · 잠긴 플랜 미완 63건을 살아 있는 플랜으로

## 동기

감사(1720) 의 2·15·16·17번. `allow(dead_code)` 42곳은 거의 전부 W1~W4 시절 「곧 소비된다」 주석의 모듈 전체 억제였다 — 소비된 지 오래인데 억제가 남아 진짜 죽은 코드를 가렸다.

## 변경 요약

- **억제 40곳 제거** (`cfg_attr(not(macos))` 1곳과 테스트 모듈 안 것만 남김). 컴파일러가 낸 경고는 **4개**: `EMBEDDING_DIM`(vec_to_bytes 에 `debug_assert_eq!` 로 사용), `git::is_repo`(테스트 전용 → `#[cfg(test)]`), `LlmProvider::name`(트레이트 메서드 + 4 impl 삭제), `OculpmManager::project_snapshot`(삭제). clippy `--all-targets -D warnings` 가 잡은 테스트 헬퍼 `cmd_tx_clone` 도 삭제.
- **워킹트리** — `feat/audit-round-20260911` 의 dirty 76파일은 전부 main 에 이미 있는 옛 WIP 였다. `git stash push -u` 로 걷어내고 `refs/backup/audit-round-20260911-tip` 스냅샷, 로컬 main 을 origin 에 맞춤(2커밋 뒤), 새 브랜치 `feat/improvement-round-20260914` 를 origin/main 에서 따고 최적화 4커밋 cherry-pick(충돌 0). 유일한 미반영 일지 2건만 stash 에서 복원.
- **플랜 이월** — `plan_status include_locked` 가 세어 준 잠긴 플랜 20개의 미완 63건을 새 플랜 `improvement-round-2026-09-14` 의 Phase 4~6(진짜 결함·기능 백로그·실기기 원장)으로 옮겨 적었다. 잠긴 플랜은 `plan_update` 가 거부하므로 원본은 그대로 두고 각 항목 끝에 `(← plan #id)` 출처를 남겼다. 죽은 커맨드 감사(334개 중 미호출 0)는 그 자리에서 닫음.

## 검증

- `cargo build` 경고 0, `cargo clippy --all-targets -- -D warnings` 통과, `cargo test` 1,469 + 통합 통과, `cargo fmt --check` 깨끗.
- `plan_status` 가 새 플랜 39항목을 읽는다.