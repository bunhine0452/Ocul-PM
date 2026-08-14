---
schema_version: 1
type: feature
slug: "acp0-runtime-handshake"
status: done
difficulty: medium
created_at: "2026-08-14T20:11:27+09:00"
session_id: "mcp-20260814-201127"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/tests/acp_handshake.rs"
    op: create
related: []
tags:
  - "acp"
  - "spike"
  - "rust"
  - "tokio"
  - "claude-code"
  - "mcp-tool"
---
[x] PR-ACP0 — ACP 클라이언트가 tokio 런타임에서 살아남는다 (핸드셰이크 성공)

## 추가 기능

[docs/acp-panel/00-master-plan.md](docs/acp-panel/00-master-plan.md) §5 의 첫 PR. 이 라운드의 **유일한 미검증 리스크**를 좁히는 것이 전부다 — 프로토콜이 되느냐가 아니라(스크래치 스파이크로 이미 확인), `agent-client-protocol` 크레이트가 쓰는 `async-process`/`async-io`(smol 계열) 리액터가 **tauri 와 같은 tokio 멀티스레드 런타임 안에서** 굶지 않느냐다. 두 리액터가 서로를 막으면 앱에 넣는 순간 조용히 멈춘다.

## 동작 흐름

`agent-client-protocol = "2"` 를 `[dependencies]` 에 추가하고(schema 크레이트 1.5.0 이 따라옴), 통합 테스트 `src-tauri/tests/acp_handshake.rs` 를 `#[tokio::test(flavor = "multi_thread", worker_threads = 4)]` 로 돌린다. `AcpAgent::from_args(["npx", "-y", "@agentclientprotocol/claude-agent-acp"])` 가 어댑터 서브프로세스 spawn 과 트랜스포트를 겸하고, `Client.builder().name("ocul-pm").connect_with(...)` 안에서 `InitializeRequest::new(ProtocolVersion::V1)` 을 보낸다. 120초 `tokio::time::timeout` 으로 감싸 굶주림이 행이 아니라 실패로 드러나게 했다.

기본 `#[ignore]` — 외부 의존(Node·네트워크·Claude Code 로그인)이 있어 CI 게이트에 넣지 않는다. 수동 실행은 `cargo test --test acp_handshake -- --ignored --nocapture`.

## 검증

통과. 1.41초에 응답 수신 — 리액터 공존 문제 없음, 폴백(자체 JSON-RPC 구현) 불필요.

```
agentInfo = Some(Implementation { name: "@agentclientprotocol/claude-agent-acp",
                                  title: Some("Claude Agent"), version: "0.67.0" })
authMethods = []
```

`authMethods` 가 빈 배열임을 어서션으로 고정했다 — 인증 흐름 설계가 필요해지면 이 테스트가 먼저 깨진다. 게이트: `pnpm typecheck` 0, `pnpm test` 59파일 738건 전부 통과, `pnpm lint` 0, 백엔드 `cargo test --no-fail-fast` 552 유닛 + 통합 전 스위트 통과. 유일한 실패 `plugin_json_is_minimal_and_version_synced` 는 **본 작업과 무관한 기존 드리프트** — v2.9.0 릴리스 커밋(0df47c9)이 앱 버전만 올리고 `scripts/build-sidecar.mjs` 를 돌리지 않아 plugin.json 이 2.8.5 로 남아 있다. `bindings.ts` 재생성분 변화 없음(커맨드 미추가).