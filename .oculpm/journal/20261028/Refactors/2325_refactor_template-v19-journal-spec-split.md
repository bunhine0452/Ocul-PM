---
schema_version: 1
type: refactor
slug: "template-v19-journal-spec-split"
status: done
difficulty: medium
created_at: "2026-10-28T23:25:15+09:00"
session_id: "20261028-010"
agent:
  id: "claude-code"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/agents/templates/journal_spec_ko.md.tpl"
    op: create
  - path: "src-tauri/src/oculpm/agents/templates/journal_spec_en.md.tpl"
    op: create
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/tests.rs"
    op: update
  - path: "src-tauri/tests/rule_canary.rs"
    op: update
  - path: ".oculpm/agents/journal-spec.md"
    op: create
  - path: ".oculpm/agents/_template.md"
    op: update
  - path: "AGENTS.md"
    op: update
related: []
tags:
  - "agents-template"
  - "simplify"
  - "token-budget"
  - "mcp-tool"
---
[x] 템플릿 v19 — §3 일지 파일 규격을 `.oculpm/agents/journal-spec.md` 로 분리

## 동기
마스터 템플릿은 AGENTS.md 로 모든 세션에 실린다. §3(경로·frontmatter 필수 키·헤더 순서, ko 약 1,300자)은 MCP `journal_write` 가 없는 세션만 읽을 내용인데 도구가 있는 세션에도 매번 실렸다. discussion-spec 이 이미 같은 이유로 on-demand 파일인 선례가 있다(마스터 §6 이 가리킴). 사용자 승인 4번.

## 변경 요약
- `journal_spec_{ko,en}.md.tpl` 신설 — 옛 §3 본문 그대로 + 머리글(앱 관리 파일, `journal_write` 가 없을 때만 읽으라). `agents/mod.rs` 에 `ensure_journal_spec` — discussion-spec 과 같은 수렴 규칙(바이트가 다르면 임베디드로 덮음), `sync_active` 와 `upgrade_master` 둘 다 호출.
- 마스터 ko·en v18→v19: §3 은 「`journal_write` 가 없을 때만 `.oculpm/agents/journal-spec.md` 를 읽고 그 규격대로 쓰라」 한 문단. 크기 ko 5,2xx→4,028 · en 7,3xx→6,038.
- 예산(`agents/tests.rs`): ko 5,300→4,100 · en 7,400→6,100 으로 **내렸다**(이력 주석에 v19 근거). 플랜이 적은 3,500/4,800 은 §1 작업 규율·§2 도구·§4 금지·§5 플래너를 더 깎아야 닿는 숫자라 이번엔 실측(4,028/6,038)에 맞춰 상한을 잡았다 — 다음 다이어트의 목표로 남긴다.
- 테스트: 마스터에 journal-spec 포인터 존재, sync 가 spec 을 시드하고 깨뜨려도 복원, upgrade 가 spec 을 (재)시드. `rule_canary` 는 `verified_by_user: false` 를 마스터가 아니라 journal-spec 템플릿에서 찾도록 옮기고 `journal-spec.md` 포인터를 새 카나리로 추가.
- 이 저장소의 `AGENTS.md` · `.oculpm/agents/_template.md` 를 v19 로, `.oculpm/agents/journal-spec.md` 를 시드.

## 검증
- `cargo test --lib agents::` → 24 passed (예산·패리티·sync·upgrade) · `cargo test --test rule_canary` → 6 passed
- `cargo test --no-fail-fast` FAILED 0 · `cargo clippy --all-targets --locked -- -D warnings` 경고 0
- `wc -m` ko 마스터 4,028 · en 6,038 (예산 4,100 · 6,100 안)

## 메모
플랜 완료 조건의 「3,500자 안」은 못 맞췄다 — 4,028. 다음 라운드에서 §1·§5 를 깎을 때 예산도 같이 내릴 것(상한은 내리기만 한다는 규칙은 지켰다).