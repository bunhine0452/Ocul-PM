---
schema_version: 1
type: chore
slug: "pay-tools-tests-ratchet-debt"
status: done
difficulty: low
created_at: "2026-09-04T09:03:46+09:00"
session_id: "20260904-006"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools/tests.rs"
    op: delete
  - path: "src-tauri/src/oculpm/mcp/tools/tests/mod.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tests/guards.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tests/a2a.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tests/journal.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tests/plan.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tests/search.rs"
    op: create
related:
  - ref: "20260904/Chores/0848_chore_file-size-ratchet-debt-and-a-misreported-gate.md"
    kind: "followup"
tags:
  - "ratchet"
  - "tests"
  - "refactor"
  - "mcp"
  - "mcp-tool"
---
[x] 쪼개서 나온 파일도 신규다 — tools 테스트를 도구 갈래로 다시 나눴다

## 동기

`pnpm lint` 이 한 줄 빨간 채로 남아 있었다:

```
src-tauri/src/oculpm/mcp/tools/tests.rs: 1703줄 (허용 800, 신규)
```

앞선 라운드가 `tools.rs`(3,344줄)를 `tools/mod.rs` + `tools/tests.rs` 로 갈랐는데, 래칫에게 그건 **새 파일**이다 — 800줄을 넘는 기존 파일은 「더 늘리지만 않으면」 통과하지만, 쪼개서 나온 파일은 기준선에 없으니 800줄 상한을 그대로 맞는다. 그 라운드는 이 빚을 [file-size-ratchet-debt-and-a-misreported-gate] 에 적어 두고 갚지 않은 채 끝났고, 그대로 밀면 CI(`HEAD^1` 기준)가 붉는다.

## 변경 요약

`tools/tests.rs` 를 도구 갈래로 다시 나눴다 — 45개 테스트가 다섯 자리를 찾았다:

| 파일 | 줄 | 무엇 |
| --- | --- | --- |
| `tests/guards.rs` | 128 | 비추적·심링크·모르는 도구 — 아무것도 만들지 않고 거절 |
| `tests/a2a.rs` | 447 | 등록·메시지·위임·구역 선점과 그 경계 |
| `tests/journal.rs` | 246 | `journal_write` 규격·마스킹 |
| `tests/plan.rs` | 399 | `plan_status`/`update`/`create`·페이지네이션 |
| `tests/search.rs` | 492 | `journal_search`·`journal_read` |
| `tests/mod.rs` | 24 | 공유 픽스처(`seed_plan`) + 모듈 선언 |

경계는 도구 이름이 이미 그어 놓은 것을 따랐다. **옮기기만 했다** — 본문은 한 줄도 고치지 않았고, 하위 모듈은 `use crate::oculpm::mcp::tools::*;` 로 본문을 그대로 본다(같은 서브트리라 부모의 비공개 임포트까지 따라온다). 공유 픽스처를 쓰는 파일만 `use super::seed_plan;` 을 단다 — clippy 의 미사용 임포트에 걸리지 않도록 파일마다 필요한 것만 적었다.

## 검증

`cargo test --locked` exit 0 (`mcp::tools` 45건이 새 경로에서 전부 통과) · `cargo clippy --all-targets -- -D warnings` exit 0 · `cargo fmt --check` exit 0 · `pnpm lint` exit 0 — **file size: clean** 으로 돌아왔다 · `pnpm typecheck` · `pnpm test` exit 0.