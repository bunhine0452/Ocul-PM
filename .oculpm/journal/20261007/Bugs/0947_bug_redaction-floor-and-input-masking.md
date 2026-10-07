---
schema_version: 1
type: bug
slug: "redaction-floor-and-input-masking"
status: done
difficulty: medium
created_at: "2026-10-07T09:47:43+09:00"
session_id: "20261007-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src-tauri/src/oculpm/config.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_draft/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_draft/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/import/journalize.rs"
    op: update
  - path: "src-tauri/src/oculpm/automation/runner/mod.rs"
    op: update
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
related:
  - ref: "20260924/Bugs/0230_bug_port-fs-semantics-lfs.md"
    kind: "followup"
tags:
  - "security"
  - "redact"
  - "external-review"
  - "mcp-tool"
---
[x] 마스킹을 저장소 설정이 끌 수 있었고, 배경 모델 입력은 가리지 않았다

## 발생 원인

외부 보안 피드백 #1·#2·#3 를 코드에서 확인했다.

- 기본 마스킹 패턴이 넷(AWS 액세스 키·`sk-`·`ghp_`·Slack)뿐이었고, 그 넷이 `config.toml` 의 `auto_redact_patterns` **기본값**이었다. config 는 저장소에 실려 오므로 남의 저장소가 `auto_redact_patterns = []` 한 줄로 마스킹을 끌 수 있었다.
- 리뷰가 말하지 않은 문제: 기존 프로젝트는 init 때 그 넷을 파일에 적어 두었다. 기본값만 늘렸다면 어떤 기존 프로젝트도 새 패턴을 받지 못했다 (`overlay_toml` 은 배열을 통째로 교체).
- 일지 초안(`journal_draft`)·대화 임포트·자동화 러너가 모델 **응답**만 가리고 입력은 그대로 보냈다. egress 원장(`LLM_PROMPT_SITES`)은 초안이 "입력과 응답 양쪽" 을 가린다고 적고 있었다 — 문서와 코드가 달랐다.

## 해결 방법

- `redact::BUILTIN_PATTERNS` 내장 바닥: 예전 넷 + GitHub fine-grained/OAuth 계열·GitLab·Stripe·Google API/OAuth·npm·PyPI·Hugging Face·Slack 웹훅·JWT·PEM 개인키(잘린 발췌 포함)·AWS 시크릿 키·Bearer·접속 문자열 `user:pass@`·`.env` 꼴 비밀 할당. `compile_redact_patterns` 가 언제나 바닥을 먼저 싣고 사용자 패턴을 더한다(같은 문자열 중복 제거). `OnceLock` 으로 한 번만 컴파일한다.
- 오탐 규율: 접두가 있거나 맥락(키 이름·`user:pass@`)이 붙은 값만. `.env` 꼴은 대문자 키 + 공백 없는 `=` + 숫자만은 아닌 값 (`MAX_TOKENS=4096`·`API_KEY = os.environ[...]` 는 그대로). 줄 머리에 묶지 않아 `DB_PASSWORD=… ./run.sh` 도 잡는다.
- `auto_redact_patterns` 는 이제 추가 패턴 — 새 프로젝트 기본값은 빈 목록, 설정 화면 안내(ko/en)와 `GitConfig` 문서에 명시.
- 초안은 `masked_user_prompt`, 임포트·러너는 보내기 전에 `redact_text`. 원장 문구를 사실로 고치고 "2026-10-07 전까지 거짓이었다" 를 남겼다.
- README ko/en 마스킹 문장: 범위·보내기 전·완전한 보장이 아님을 정확히.

## 검증

- 새 테스트 4개(빈 목록도 바닥 유지·리뷰가 짚은 꼴 12종 마스킹·흔한 텍스트 9종 무접촉·초안 입력 마스킹). 토큰 모양 픽스처는 실행 중에 조립해 소스에 키 같은 문자열을 남기지 않았다.
- `cargo test` 전체 1976 통과·실패 0 · clippy 0 · `pnpm test` 3262 통과 · `pnpm lint` 통과.