---
schema_version: 1
type: bug
slug: "planner-anchored-phase-decisions-ext"
status: done
difficulty: medium
created_at: "2026-09-29T00:35:09+09:00"
session_id: "20260929-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/heading.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/plan_edit.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/plan_edit_tests.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/parse.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/dispatch.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/migrate.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/parser_parity_cases.json"
    op: create
  - path: "extension/src/oculpm/planner.ts"
    op: update
related:
  - ref: "20260928/Bugs/2249_bug_port-crlf-anchor-rename-paths.md"
    kind: "followup"
tags:
  - "planner"
  - "extension"
  - "cross-platform"
  - "mcp-tool"
---
[x] 플래너 편집 — 앵커 달린 phase 추가 · 결정 섹션 판정 통일과 가드 · 확장 파서를 Rust 와 같게 (L-PLAN2, PR #56)

## 발생 원인

L-FS3 가 찾은 양 OS 공통 결함이다.

- `plan_edit::add_item` 이 phase 를 원문 헤딩으로 비교했다. 그래서 `## P {#p}` 에 항목을 더하면 `## P` 섹션이 하나 더 생겼다(UI 는 앵커를 뗀 이름을 넘긴다).
- plan_edit 는 결정 섹션을 부분 문자열로, 파서는 이름 전체로 판정했다. 그래서 「결정 반영」 같은 phase 를 `move_phase` 가 결정 섹션으로 읽었다.
- 결정 섹션 이름으로 phase 를 편집하는 길이 열려 있었다. **`remove_phase("결정")` 은 결정 섹션 전체를 지웠다**(데이터 손실). `add_item` 은 결정 섹션에 항목을 넣어 파서가 보지 못하게 만들었다.
- VS Code 확장 파서는 여전히 「첫 `{#…}` 가 이긴다」 여서 Rust 와 id 가 갈렸다.

## 해결 방법

- `planner/heading.rs` — `split_phase_heading` · `is_decisions_heading` 을 파서와 plan_edit 가 같이 쓴다.
- `reject_decisions_name` — add_item · rename_phase(옛·새 이름) · remove_phase · move_phase · move_item 이 결정 섹션 이름을 거절한다. 레거시 가져오기(`migrate`)는 결정 이름의 목표를 「목표 — 결정」 으로 바꿔 하위가 버려지지 않게 했다.
- `add_item` 의 중복 id 검사를 앵커 규칙(`id_is_anchored`)으로 바꿨다.
- 확장 `planner.ts` 에 Rust `anchor_span` 규칙 · 결정 헤딩 규칙 · CRLF 정규화를 넣었다. 공유 사례표 `parser_parity_cases.json` 을 두 쪽 테스트가 같이 읽는다.
- 디스패치 일지 발췌는 `eol::to_lf` 로 편 뒤 자른다.

## 검증

- 8804ed4f 에서 Portability · E2E · PR CI · Extension 모두 success. windows lib 1824/0 이고 새 테스트를 이름으로 확인했다. PR #56 rebase 병합(734dac0e).
- 확장은 옛 `planner.ts` 로 되돌리면 새 테스트 4건이 붉어지는 것을 확인했다.
- 같은 구멍의 MCP `plan_create` 쪽은 PR #58 로 막는다.