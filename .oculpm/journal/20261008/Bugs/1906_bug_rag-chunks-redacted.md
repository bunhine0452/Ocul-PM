---
schema_version: 1
type: bug
slug: "rag-chunks-redacted"
status: done
difficulty: low
created_at: "2026-10-08T19:06:36+09:00"
session_id: "20261008-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src-tauri/tests/llm_prompt_ledger.rs"
    op: update
related:
  - ref: "20261008/Bugs/1906_bug_index-boot-reconcile-secret-files.md"
    kind: "followup"
tags:
  - "security"
  - "redaction"
  - "mcp-tool"
---
[x] 의미 검색이 꺼낸 청크를 프로젝트 마스킹 패턴으로 가린다

## 발생 원인
AI 패널(`aiContext.ts`)은 의미 검색 청크를 시스템 프롬프트에 자동으로 싣는다. 그런데 프롬프트 원장(`llm_prompt_ledger.rs`)은 `commands/llm.rs` 를 「사용자가 친 글이라 면제」로 적고 있었다. 청크는 사용자 작성이 아니라 저장소 파일 원문이라, 하드코딩된 키가 모델 제공자에게 그대로 나갈 수 있었다. 모바일 브리지도 같은 결과를 받는다.

## 해결 방법
`search_chunks` 가 결과를 꺼낼 때 `patterns_for_project` 로 가린다(notion_export 와 같은 규율). 정확 문자열 검색(`search_text`)은 가리지 않는다. 사용자가 그 문자열을 찾는 중이기 때문이다. 원장 사유를 바로잡았고 `redact::CALL_SITE_FILES` 를 28 → 29 로 올렸다. 마스킹을 지우면 이 단언이 깨지므로 회귀 그물이 된다.

## 검증
`cargo test --test llm_prompt_ledger --test egress_inventory` 16건 통과, PR #76 CI 초록.