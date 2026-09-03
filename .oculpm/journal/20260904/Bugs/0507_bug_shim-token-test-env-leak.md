---
schema_version: 1
type: bug
slug: "shim-token-test-env-leak"
status: done
difficulty: low
created_at: "2026-09-04T05:07:30+09:00"
session_id: "20260904-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/shim.rs"
    op: correct
related: []
tags:
  - "shim"
  - "test-isolation"
  - "dogfooding"
  - "mcp-tool"
---
[x] "환경변수 없이"를 재는 테스트가 진짜 세션 토큰을 주웠다

## 발생 원인

`cargo test` 가 ocul-pm 터미널 안에서만 빨갛다:

```
---- oculpm::shim::tests::the_token_is_found_beside_the_symlink_without_env ----
  left: Some(SessionToken { project_root: "/Users/.../ai-pm", agent_id: None, session_id: None })
 right: Some(SessionToken { project_root: "/tmp/p", agent_id: Some("codex"), ... })
```

`resolve_token` 은 `OCULPM_SESSION_TOKEN` 을 1순위로 읽는다. 테스트 이름은 "환경변수 없이"인데 정작 환경을 비우지 않아서, ocul-pm 터미널이 심어 준 **진짜** 토큰(터미널 세션이라 agent_id 가 없다)을 먼저 집었다. CI 에는 그 변수가 없으니 늘 초록이었다 — 도그푸딩하는 자리에서만 깨지는 종류다.

## 해결 방법

환경을 읽는 자리를 하나로 모았다. `resolve_token` 은 `std::env::var_os` 로 값을 집어 `resolve_token_from(env_token, argv0)` 에 넘기고, 판정 자체는 그 순수 함수가 한다. 테스트는 `resolve_token_from(None, ..)` 으로 환경 없는 경우를 재고, 환경이 심 옆 토큰을 이긴다는 순서 규약도 한 건 추가했다. 프로세스 환경을 테스트에서 변조하는 길(스레드 공유라 위험한)은 쓰지 않았다.

## 검증

ocul-pm 터미널 안에서 — 즉 `OCULPM_SESSION_TOKEN` 이 실제로 서 있는 채로 — `cargo test --lib shim::` 6건 통과. 전체 `cargo test` 1257건 exit 0.