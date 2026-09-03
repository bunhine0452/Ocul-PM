---
oculpm_plan: v1
id: codex-acp
title: "Codex ACP 에이전트 통합"
status: active
created: 2026-09-03
updated: 2026-09-03
owner: codex
---

기존 Claude Code ACP 화면과 프로토콜 처리를 재사용하면서, 공식 `@agentclientprotocol/codex-acp`
어댑터를 통해 OpenAI Codex를 별도 에이전트로 제공한다. Claude 세션·설정·프로세스와 Codex
세션·설정·프로세스는 서로 영향을 주지 않아야 한다.

## Phase 0 — 계약과 경계 확정 {#contract}

- [x] Codex ACP 어댑터의 설치·실행 계약과 지원 플랫폼을 고정하고 버전 핀 전략을 정한다 {#adapter-contract}
- [~] 기존 ACP 이벤트 매핑이 Codex의 `session/update` 변형(추론, 도구, 권한, diff, usage, plan)을 손실 없이 표현하는지 어댑터 소스/핸드셰이크 fixture로 확인한다 {#protocol-fixture}
- [x] Claude와 Codex를 같은 프로젝트에서 동시에 실행할 수 있는 state/session 키 모델을 확정한다. 공개 project id를 변형하는 방식은 충돌·추적성 문제가 있어 최종 설계에서 배제 여부를 결정한다 {#state-boundary}

## Phase 1 — Codex 런타임 조달과 진단 {#runtime}

- [x] Codex ACP 패키지의 별도 설치 디렉터리·진입점·고정 버전·손상 감지를 추가한다 {#codex-adapter}
- [x] Node/npm 탐색을 재사용하고 Codex 인증 상태(API key/ChatGPT 로그인)의 존재 여부를 비밀값 없이 진단한다 {#codex-diagnostics}
- [x] 설정 화면에 Claude/Codex 런타임 상태, 설치/재설치, 실패 메시지를 추가한다 {#codex-settings}
- [~] 앱 종료·프로젝트 탭 닫기에서 두 어댑터가 모두 정리되는지 기존 lifecycle 계약을 확장한다 {#codex-lifecycle}

## Phase 2 — 공통 ACP 백엔드와 IPC {#backend}

- [x] ACP 명령에 에이전트 종류를 전달하는 공통 내부 계층을 만든다. 기존 Claude 호출 시그니처와 저장 데이터 호환성은 유지한다 {#backend-provider}
- [x] Codex 세션의 `session/new`, prompt, cancel, permission, config option, list/load/delete 흐름을 연결한다 {#backend-commands}
- [~] 프로젝트 루트를 세션 cwd로 전달하고 `oculpm-mcp`를 두 어댑터에 동일하게 연결한다. MCP 등록 실패는 세션 전체 실패가 아니라 명시적 진단으로 남긴다 {#backend-mcp}
- [x] Specta 바인딩과 오류 코드에 Codex 경로를 반영한다 {#ipc-bindings}

## Phase 3 — Codex 작업 화면 {#ui}

- [x] `AcpConversation`를 provider prop으로 일반화하고 Claude 전용 문자열·아이콘·터미널 재개 명령을 분리한다 {#conversation-provider}
- [x] Codex 전용 내비게이션/화면을 추가하고 세션 탭·프롬프트·첨부파일·이미지·권한 카드·diff·plan·usage를 연결한다 {#codex-screen}
- [x] Claude/Codex별 keep-alive, busy/attention 배지, 탭 전환, 창 종료 확인을 독립적으로 동작시킨다 {#ui-lifecycle}
- [x] 한국어/영어 번역과 접근성 이름을 추가한다 {#codex-i18n}

## Phase 4 — 검증과 출시 기준 {#verification}

- [~] Rust 단위/통합 테스트: 경로·버전·진단·핸드셰이크·provider별 state 격리·종료 정리를 추가한다 {#rust-tests}
- [x] Vitest: provider prop, navigation, session tabs, permission, error/loading 상태와 Claude 회귀를 검증한다 {#frontend-tests}
- [~] 실제 Codex ACP 로그인 환경에서 새 세션→도구 호출→승인→파일 변경→후속 프롬프트→세션 load를 수동 확인한다 {#live-smoke}
- [~] `cargo fmt --check`, `cargo test`, `pnpm typecheck`, 관련 Vitest와 기존 lint/build를 통과시킨다 {#release-gates}

## 결정

### Decision 1 — 공식 ACP 어댑터 채택 {#official-codex-adapter}

잠금 예정 2026-09-03 · codex. 근거: `@agentclientprotocol/codex-acp`가 Codex App Server를 ACP stdio로 변환하는 공식 Agent Client Protocol 저장소의 패키지이며, Claude 구현과 동일한 ACP 클라이언트 경계를 사용한다. 어댑터를 앱에 직접 포크하지 않고 버전을 고정해 조달한다.

영향: #adapter-contract #codex-adapter #protocol-fixture

### Decision 2 — ACP 화면은 공통 컴포넌트로 유지 {#shared-conversation}

잠금 예정 2026-09-03 · codex. 근거: 대화 렌더링·권한·diff·세션 탭은 ACP 표준 이벤트에 기반하므로 provider별 화면을 복제하면 Claude와 Codex의 UX/버그 수정이 갈라진다. provider 차이는 어댑터 라벨·아이콘·실행 명령·지원 옵션에 한정한다.

영향: #conversation-provider #codex-screen #ui-lifecycle

### Decision 3 — provider는 state의 1급 키로 취급 {#provider-key}

잠금 예정 2026-09-03 · codex. 근거: 프로젝트당 단일 ACP state에 Codex를 덮어쓰면 기존 Claude 세션 탭과 진행 중 스트림이 사라지거나 다른 에이전트로 라우팅될 수 있다. 구현 시 공개 IPC의 호환성과 내부 키의 명확성을 함께 검토한 뒤 provider+project 복합 키를 우선한다.

영향: #state-boundary #backend-provider #codex-lifecycle #ui-lifecycle

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-03T13:01:29+09:00 | #contract #runtime #backend #ui #verification | codex | →☐ | | 사용자 요청에 따라 구현 전 Codex ACP 통합 계획 수립 |
| 2026-09-03T13:47:00+09:00 | #adapter-contract #state-boundary #codex-adapter #codex-diagnostics #codex-settings #backend-provider #backend-commands #ipc-bindings #conversation-provider #codex-screen #ui-lifecycle #codex-i18n #frontend-tests | codex | ☐→x | .oculpm/journal/20260903/Features_to_add/1345_feature_codex-acp-integration.md | Codex ACP 기본 작업 경로와 자동 회귀 검증 완료 |
| 2026-09-03T13:47:00+09:00 | #protocol-fixture #codex-lifecycle #backend-mcp #rust-tests #live-smoke #release-gates | codex | ☐→~ | .oculpm/journal/20260903/Features_to_add/1345_feature_codex-acp-integration.md | 실제 세션·프롬프트까지 확인, 도구 승인/load와 전체 Rust 환경 게이트는 후속 검증 |
| 2026-09-03T14:08:21+09:00 | #backend-mcp | claude-code | ~→~ | .oculpm/journal/20260903/Bugs/1408_bug_codex-acp-review-fixes.md | MCP 귀속 해결(OCULPM_AGENT_ID). 등록 실패의 명시적 진단은 남음 |
| 2026-09-03T14:08:23+09:00 | #codex-lifecycle | claude-code | ~→~ | .oculpm/journal/20260903/Bugs/1408_bug_codex-acp-review-fixes.md | start/session 락을 대상별로 분리 — provider 간 봉쇄 제거. 어댑터 수동 종료 경로는 여전히 없음 |
<!-- oculpm:plan-log end -->
