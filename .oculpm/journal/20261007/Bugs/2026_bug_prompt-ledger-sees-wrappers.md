---
schema_version: 1
type: bug
slug: "prompt-ledger-sees-wrappers"
status: done
difficulty: medium
created_at: "2026-10-07T20:26:54+09:00"
session_id: "20261007-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tests/llm_prompt_ledger.rs"
    op: create
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: "src-tauri/src/commands/release_notes.rs"
    op: update
  - path: "src-tauri/src/commands/rollup.rs"
    op: update
  - path: "src-tauri/src/commands/summary.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/project.rs"
    op: update
  - path: "src-tauri/src/oculpm/discussion/project.rs"
    op: update
  - path: "src-tauri/src/commands/import.rs"
    op: update
  - path: "src-tauri/src/commands/notion.rs"
    op: update
related:
  - ref: "20261007/Bugs/0947_bug_redaction-floor-and-input-masking.md"
    kind: "followup"
tags:
  - "security"
  - "redact"
  - "external-review"
  - "mcp-tool"
---
[x] 프롬프트 원장이 call_llm·ChatBackend 래퍼를 지나는 호출을 못 보던 것 + 마스킹 바닥이 꺼지던 폴백

## 발생 원인

외부 보안 피드백 2차 #4: "마스킹 없이 모델에 보내는 경로를 잡는 테스트가 여전히 `ChatBackend` 와 `summary::call_llm` 호출을 못 본다. 설명 문구만 고쳐졌다." 맞다. 원장(`LLM_PROMPT_SITES`)은 `llm::create`·`commands::llm::chat*` 를 글자 그대로 부르는 파일만 셌다. 래퍼를 지나는 네 자리 — 주간 롤업(`call_llm`)·릴리스 노트 초안(`map_reduce_blocks`)·요약 청킹·대화 임포트(`ChatBackend`) — 가 원장 밖이었고, 롤업·릴리스 노트의 모듈 문서는 그 빈틈을 "원장에 새 줄이 필요 없다" 는 설계 근거로 적고 있었다.

원장이 새로 보자 결함 둘이 나왔다.
- 릴리스 노트 초안이 디스크에서 바로 읽은 `CHANGELOG.md` 문체 표본을 가리지 않고 보냈다.
- 설정을 못 읽으면 패턴 로더 여섯 곳(`patterns_for_project`·매니저·플래너/논의 투영·대화 임포트·Notion)이 **빈 목록**을 돌려 내장 바닥까지 꺼졌다. 깨진 `config.toml` 을 실은 저장소면 v3.8.0 의 "설정으로 끌 수 없다" 가 거짓이 된다.

## 해결 방법

- `tests/llm_prompt_ledger.rs` 로 떼어 다시 짰다. 주석·문자열·문자 리터럴을 바이트 위치째 걷어내는 작은 렉서 위에서 두 판정: (A) 관문(`LLM_GATEWAYS` — `llm::create`·`chat`·`chat_detailed`·`run_chat_stream`·`call_llm`·`generate_with_llm`·`map_reduce_blocks`·`ChatBackend`)을 부르는 출시 코드 파일 집합 == 원장, (B) 관문을 부르는 공개 함수·크레이트 트레이트 구현은 관문으로 등록되거나 사유와 함께 `NOT_GATEWAYS` 에 있다 — 등록 안 된 새 래퍼가 A 를 빠져나가는 길을 닫는다. `#[cfg(test)]` 항목·모듈 파일과 `llm/` 은 뺀다. 새 분류 `Relay`(관문 자신, 부르는 쪽이 리댁션을 진다).
- 릴리스 노트 표본은 보내기 전에 프로젝트 패턴으로 가린다 (`CALL_SITE_FILES` 27→28). 여섯 폴백은 `compile_redact_patterns(&[])`(바닥)로.
- 래퍼 셋(`overview::run_generation`·`journal_draft::draft_for_session`·`reconcile::reconcile_entry`)은 id·경로만 받고 스스로 조립·마스킹하므로 `NOT_GATEWAYS` 에 사유와 함께.

## 검증

- 변이 시험: 원장에서 롤업을 빼면 A 가, 관문에서 `ChatBackend` 를 빼면 B 가 실패했다(복구 확인). 렉서 자체 테스트 2.
- 바닥 폴백 테스트(config 없음·깨진 config 둘 다 AWS 키를 가린다). `cargo test` 2004 통과. PR #70.