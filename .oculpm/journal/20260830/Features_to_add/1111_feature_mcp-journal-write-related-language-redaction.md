---
schema_version: 1
type: feature
slug: mcp-journal-write-related-language-redaction
status: done
created_at: 2026-08-30T11:11:00+09:00
session_id: "manual-20260830-111100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/oculpm/mcp/tools.rs
    op: update
related:
  - .oculpm/journal/20260830/Features_to_add/1111_feature_verified-toggle-and-related-links.md
tags: [mcp, agents, journal, audit-round]
---

[x] MCP `journal_write` 가 `related`·`session_id` 를 받고, 언어를 프로젝트 설정에서 가져오며, 마스킹이 일어났음을 응답으로 알린다

## 추가 기능

AGENTS.md §0 은 "찾은 것이 이어지면 새 일지의 `related` 에 넣으라" 고 하는데, 정작 `journal_write` 스키마에 `related` 가 없어 도구로 쓴 일지는 늘 빈 배열이었다(감사). 같은 결의 결손 셋을 함께 닫았다.

- `related[]` 인자 — `{ref, kind}`. `ref` 의 `.oculpm/journal/` 접두는 벗겨 저장(에이전트가 검색 결과 path 를 그대로 붙여 넣는 형태). `kind` 는 4종 enum, 낯선 값은 `followup` 으로 기록하고 **경고**. 존재하지 않는 참조도 거부 대신 경고 — 오타 하나로 일지 전체가 막히면 도구를 안 쓴다.
- `session_id` 를 스키마에 선언 — 핸들러는 이미 읽고 있었지만 스키마에 없어 에이전트가 넘길 줄 몰랐다.
- `language` 를 `config.agents.template_language` 에서 — 영문 프로젝트도 `ko` 로 색인되던 것.
- 응답에 `language` · `related`(개수) · `redacted`(마스킹 건수) · `warnings[]`. AGENTS.md 는 "감지 시 거부됩니다" 라 적혀 있었지만 실제론 조용히 마스킹만 했고 에이전트는 자기가 무엇을 흘렸는지 몰랐다.

## 동작 흐름

에이전트 `journal_write(related: [{ref: ".oculpm/journal/20260522/Bugs/2050_bug_x.md"}])` → 접두 제거 → 파일 존재 확인(없으면 경고) → frontmatter `related` 에 기록 → 응답 `{path, session_id, language, related: 1, redacted: 0, warnings: []}`.

## 검증

새 테스트 `journal_write_records_related_and_project_language`: 접두 제거 · 낯선 kind → followup + 경고 · 없는 참조 경고 · `language: en` 반영. `cargo test` 868 그린(기존 MCP 테스트 전부 포함).

## 메모

AGENTS.md 템플릿 문구("감지 시 거부됩니다")는 이제 사실과 다르다 — 템플릿 버전을 올릴 때 "마스킹되고 응답으로 알립니다" 로 고쳐야 한다(에이전트 표면 감사 항목 4). 이 라운드에선 서버만 고쳤다.
