---
schema_version: 1
type: chore
slug: "acp-crate-3-5"
status: done
difficulty: low
created_at: "2026-10-24T23:34:01+09:00"
session_id: "20261024-007"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
related: []
tags:
  - "deps"
  - "acp"
  - "mcp-tool"
---
[x] agent-client-protocol 2.2 → 3.5 (스키마 1.12) — 컴파일 수정 0, 실제 어댑터 0.95 핸드셰이크

## 변경 요약

다음 후보 6(플랜 `optimize-round-20261024` #next-acp-v2). 크레이트 소스의 CHANGELOG(3.0.0 2026-10-06 ~ 3.5.0 10-22)를 직접 읽었다.

- 3.0 의 깨지는 변경: 기본 기능 전부 꺼짐(하위 프로세스 `process`·stdio `stdio` 는 켜야 함), `ConnectTo::into_channel_and_future` → `(Channel, Option<ConnectionDriver>)`, 원시 JSON-RPC 오류 타입, 불안정 MCP 바인딩. 우리는 고수준 `AcpAgentConfig`·`connect_with`·`schema::v1` 만 써서 `features = ["process", "stdio"]` 한 줄로 끝 — 컴파일 오류 0, clippy 무경고.
- 이득: 연결 수명·정상 종료 시 남은 출력 비우기, 버려진 도구 호출 취소, 스키마 1.12, 의존성 감소(잠금 −36줄).
- 정정: 이 후보의 전제였던 "어댑터 0.94+ 가 프로토콜 v2" 는 아니다 — 3.5 에서도 v2 는 초안(draft-v2)이고 어댑터는 v1 요청에 v1 로 답한다. 판 유지·버그 수정 업그레이드다.

## 검증

- cargo test --locked --no-fail-fast 실패 0 (ACP 99건 포함, 실제 응답 픽스처 파싱 테스트 포함).
- 수동 `acp_handshake_survives_tokio_runtime`(--ignored): npx 최신 claude-agent-acp **0.95.0** 과 tokio 멀티스레드 런타임 안에서 initialize 왕복 13s, authMethods 비어 있음. 모델 호출 없음.