---
schema_version: 1
type: bug
slug: log-bridge-unbounded-and-unmasked
status: done
created_at: 2026-08-30T11:21:00+09:00
session_id: "manual-20260830-112100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/llm/mod.rs
    op: update
  - path: src-tauri/src/llm/openai.rs
    op: update
  - path: src-tauri/src/llm/anthropic.rs
    op: update
  - path: src-tauri/src/llm/gemini.rs
    op: update
  - path: src-tauri/src/llm/nim.rs
    op: update
related: []
tags: [logging, redaction, llm, audit-round]
---

[x] 로그 브리지가 프런트 메시지를 절단·마스킹 없이 파일에 썼고, LLM 오류 응답 본문이 통째로 실려 왔다

## 발생 원인

`oculpm_log` 커맨드는 `console.*` 인자를 그대로 `tracing` 에 넘겼고, 프런트 `stringifyArg` 는 Error stack·임의 객체 JSON 을 절단 없이 직렬화했다. 프로바이더 4종은 실패 응답 `resp.text()` 를 통째로 `LlmError::ApiError.body` 에 실어 그것이 `console.error` → `oculpm.log` 로 흘렀다. 실측 하루 5.9MB/56K줄. 일지용 마스킹(`redact.rs`)은 이 경로를 몰라 키가 로그에 남을 수 있었다.

## 해결 방법

- `oculpm_log`: 메시지 8KB 절단(UTF-8 경계, `… (+N bytes)`) + 기본 시크릿 패턴(AKIA·sk-·ghp_) `redact_text` 통과 — 패턴은 `LazyLock` 으로 한 번만 컴파일.
- `llm::error_body(resp)`: 실패 응답 본문을 512B 까지만. 프로바이더 4종 8곳이 전부 이걸 쓴다(사유는 첫 몇백 바이트에 있다).

## 검증

`cargo test` 868 그린. 실기기: 키를 무효화한 뒤 AI 패널에서 호출 → `oculpm.log` 의 오류 줄이 512B 안이어야 한다 — 앱 꺼진 뒤 몰아서.
