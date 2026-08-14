---
schema_version: 1
type: chore
slug: "acp-panel-design-spike"
status: done
difficulty: medium
created_at: "2026-08-14T20:01:51+09:00"
session_id: "mcp-20260814-200151"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/acp-panel/00-master-plan.md"
    op: create
  - path: "docs/acp-panel/spike/acp_spike.py"
    op: create
  - path: ".oculpm/planner/acp-agent-panel.md"
    op: create
related: []
tags:
  - "acp"
  - "design"
  - "spike"
  - "ai-panel"
  - "claude-code"
  - "mcp-tool"
---
[x] ACP 에이전트 패널 설계 — 어댑터 실측 스파이크 통과, 마스터플랜 확정

## 동기

"Claude Code for VS Code 같은 걸 ocul-pm 에 만들 수 있나"는 물음에서 출발. 확장을 실제로 뜯어보니 세 겹이었다 — 웹뷰 UI + Agent SDK 엔진 + IDE 연동(`~/.claude/ide/<port>.lock` + WebSocket MCP, 도구 11종). 같은 목표에 이르는 3경로(A: 락파일 WS-MCP / B: ACP / C: Agent SDK 직접)를 비교해 **B 채택**.

A 가 노출하는 도구의 절반(getCurrentSelection·getOpenEditors·getDiagnostics)이 에디터 버퍼·LSP 전제인데 ocul-pm 엔 둘 다 없다. B 는 공개 규격이고 프로토콜 중립이라 어댑터 교체만으로 다른 에이전트가 붙는다 — 멀티 에이전트 기록이라는 제품 포지셔닝과 정확히 겹친다.

## 실측 (전부 로컬 확인, 2026-08-14)

지식 기준일 이후로 판이 바뀌어 있었다. `@zed-industries/claude-code-acp`(0.16.2, 3월)는 **옛 이름**이고 `@agentclientprotocol/claude-agent-acp` **0.67.0** 으로 이관 — 오늘 배포됐고 2주에 6회 배포 중. Rust SDK `agent-client-protocol` **2.0.0** 이 있어 클라이언트를 백엔드에 통째로 둘 수 있다.

스파이크 2단계 모두 통과:

1. **handshake** — `initialize` → `authMethods: []`. 인증 설정 0. 어댑터가 `pathToClaudeCodeExecutable` 로 로컬 `claude` 바이너리를 구동하므로 **기존 구독 로그인을 그대로 재사용**한다(API 키 불필요). `session/new` 가 모드 6종과 `configOptions`(실제 모델 목록 포함)를 돌려줌 — 셀렉터 UI 를 우리가 만들 필요가 없다.
2. **한 턴 스트리밍** — `agent_message_chunk` 수신 → `stopReason: end_turn`. 덤으로 `usage_update` 에 토큰·**USD 비용**·레이트리밋(`utilization: 0.8` 경고 실측)이 실려 온다. 계획 항목 `#cost-telemetry`(B5)가 훅 계측 없이 여기에 흡수된다.

## 결정

D1 클라이언트는 Rust 백엔드(프론트는 `Channel<AcpEvent>` 만 — `llm.rs` 의 `chat_stream` 선례) · D2 Node 는 로그인 셸 PATH 로 해석 + 버전 고정 설치(패키징 `.app` 의 빈약한 PATH 함정) · D3 프로젝트당 1 세션, ACP UUID 는 workday 접두 제약 때문에 ocul-pm session_id 와 분리 · D4 권한은 모달 아닌 인라인 카드 · D5 `fs/*`·`terminal/*` 능력은 광고하지 않음(에디터 버퍼가 없다) · D6 훅 브리지와 이중 기록 방지를 위해 `agent_id` 분리.

최대 미검증 리스크는 프로토콜이 아니라 **크레이트의 async-io 리액터와 tauri tokio 런타임의 공존** — PR-ACP0 이 그것만 본다. 실패 시 폴백은 자체 JSON-RPC 구현(개행 구분 JSON 이라 난이도 낮음).

## 검증

스파이크 스크립트를 `docs/acp-panel/spike/acp_spike.py` 로 보존 — 재실행하면 handshake→session/new→prompt→stopReason 전 경로가 재현된다. 관측된 `sessionUpdate` 종류: `available_commands_update`, `agent_message_chunk`, `usage_update`. 설계 SSOT 는 `docs/acp-panel/00-master-plan.md`, 계획은 `acp-agent-panel`(4 phase / 15 항목). 코드 변경 없음 — 게이트 실행 대상 아님.