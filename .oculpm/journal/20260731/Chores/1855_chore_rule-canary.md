---
schema_version: 1
type: chore
slug: rule-canary
status: done
created_at: 2026-07-31T18:55:00+09:00
session_id: "manual-20260731-185500"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: src-tauri/tests/rule_canary.rs, op: create }
  - { path: src-tauri/src/oculpm/mcp/protocol.rs, op: update }
related: []
tags: [ponytail, canary, rules, drift-guard]
difficulty: low
---

[x] 규칙 사본 불변 문구 카나리 — 정본·어댑터·스킬·MCP instructions 드리프트 가드

ponytail 의 check-rule-copies INVARIANTS 방식 이식: 바이트 비교가 불가능한 규칙 표면들에 **하중을 받는 문구**(`.oculpm/index` 금지·secrets 금지·frontmatter 필수 키·plan-log append·부모 롤업 금지·도구명)가 살아있는지 cargo 테스트 5개로 핀 고정. 검증 대상: master_ko/en 템플릿·claude 어댑터·플러그인 oculpm-journal 스킬·MCP instructions.

적대 리뷰 반영: instructions 는 소스 전문 매칭이 아니라 `pub const MCP_INSTRUCTIONS` 로 추출해 **서빙되는 실제 문자열**을 검증 — 주석/죽은 문자열로 통과하는 오탐 차단.

## 검증

`cargo test --test rule_canary` 5/5 — 현 표면들이 실제로 동기 상태임도 함께 확인됨. mcp 33·plugin_manifest 7 그린.
