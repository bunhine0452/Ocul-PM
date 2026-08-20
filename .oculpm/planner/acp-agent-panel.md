---
oculpm_plan: v1
id: acp-agent-panel
title: "ACP 에이전트 패널 — AI 패널에서 Claude Code 구동"
status: active
created: 2026-08-14
updated: 2026-08-20
owner: claude-code
---

AI 패널을 ACP(Agent Client Protocol) 클라이언트로 만들어 Claude Code 를 앱 안에서 에이전트로 구동한다. 턴·툴콜·권한·플랜·토큰비용이 일급 이벤트로 들어온다. 설계 SSOT: docs/acp-panel/00-master-plan.md (2026-08-14 스파이크 통과 — 인증 설정 0으로 handshake+한 턴 스트리밍 확인).

## 런타임 검증 {#spike}
- [x] PR-ACP0 — tauri tokio 런타임 안에서 agent-client-protocol 2.0 의 AcpAgent 로 handshake 1회 성공 (async-process/async-io 공존 증명). 실패 시 자체 JSON-RPC 구현으로 폴백 판단 {#acp0-runtime}
  - [x] 크레이트 의존 추가 + 최소 예제 컴파일 {#acp0-dep}
  - [x] 커맨드에서 initialize 응답 수신 확인 (tokio 멀티스레드 런타임 내부) {#acp0-handshake}
  - [x] 공존 가부 판정 → 설계 확정 또는 폴백 경로 문서화 {#acp0-verdict}

## 프로세스·세션 기반 {#runtime}
- [x] PR-ACP1 — 어댑터 프로세스 수명(spawn/health/종료) + Node 조달(로그인 셸 PATH) + 버전 고정 설치 {#acp1-process}
  - [x] 로그인 셸로 PATH 해석해 node 탐색, 앱 데이터 디렉터리에 어댑터 버전 고정 설치 {#acp1-node}
  - [x] Node/claude 부재 진단 카드 (설정 → 에이전트) {#acp1-diag}
  - [x] 패키징된 .app 에서 동작 확인 (Finder 실행 PATH 함정) {#acp1-pkg}
- [~] PR-ACP2 — 세션 생성 + 프롬프트 텍스트 스트리밍(agent_message_chunk → Channel<AcpEvent>) + 취소 {#acp2-stream}
  - [x] commands/acp.rs: acp_start / acp_prompt / acp_cancel / acp_stop {#acp2-cmds}
  - [x] AI 패널에 ACP 모드 — 라이브 마크다운 렌더 + stopReason 처리 {#acp2-ui}
  - [ ] ACP UUID ↔ ocul-pm session_id 매핑 (workday 접두 제약) {#acp2-sid}

## 에이전트 UX {#agentic}
- [x] PR-ACP3 — 툴콜 카드(tool_call/tool_call_update) + 권한 승인 인라인 카드(session/request_permission) {#acp3-tools}
- [x] PR-ACP4 — configOptions 그대로 렌더(모드·모델 셀렉터) + 플랜 카드 + usage/cost·레이트리밋 배지 {#acp4-config}

## 어댑터 추종 {#adapter-track}
- [x] 어댑터 0.68.0 → 0.70.0 상향 (스파이크 재실행으로 session/update 불변 확인) {#acp-bump-070}
- [x] 파일 변경 감사(agentFileChangeReport) 연동 — 능력 광고·requestId·파싱·교차 검증 표시 {#acp-file-change-audit}

## 도그푸딩 — 대화 UX {#dogfood-ux}
- [x] 새 세션을 누르면 탭 줄에도 자리가 생긴다 (임시 탭, 첫 마디에 진짜 탭으로) {#acp-pending-tab}
- [x] 제목이 마지막 지시문을 따라다니지 않게 — 어댑터 제목의 메아리 걸러내기 {#acp-title-echo}
- [x] 사용량 카드의 "무엇이 기여했나" 를 읽을 수 있게 (모르는 줄은 원문 유지) {#acp-usage-detail-read}
- [x] 한 프로젝트에서 대화 여러 개를 동시에 굴린다 — prompt/cancel 이 세션을 인자로 받고, 화면 상태(작업 중·승인·사용량·오류)를 대화별로 분리 {#acp-parallel-sessions}

## 기록 결합 {#record}
- [ ] PR-ACP5 — 턴 종료 → 일지 초안, agent_id 분리(claude-code:acp)로 훅 브리지와 이중 기록 방지, usage_update 비용 텔레메트리 적재(#cost-telemetry 흡수) {#acp5-journal}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-14T20:11:34+09:00 | #acp0-dep | claude-code | ☐→x | .oculpm/journal/20260814/Features_to_add/2011_feature_acp0-runtime-handshake.md | agent-client-protocol 2.0 추가 (schema 1.5.0 동반), 테스트 타깃 컴파일 통과 |
| 2026-08-14T20:11:39+09:00 | #acp0-handshake | claude-code | ☐→x | .oculpm/journal/20260814/Features_to_add/2011_feature_acp0-runtime-handshake.md | tokio multi_thread 안에서 initialize 응답 1.41초 수신 (0.67.0, authMethods=[]) |
| 2026-08-14T20:11:45+09:00 | #acp0-verdict | claude-code | ☐→x | .oculpm/journal/20260814/Features_to_add/2011_feature_acp0-runtime-handshake.md | 공존 확인 — 설계 확정, 자체 JSON-RPC 폴백 불필요. ACP1 로 진행 가능 |
| 2026-08-14T20:29:33+09:00 | #acp1-node | claude-code | ☐→x | .oculpm/journal/20260814/Features_to_add/2029_feature_acp1-adapter-runtime.md | acp/env.rs 로그인 셸 PATH 폴백 + acp/adapter.rs 0.67.0 고정 설치. 빈약 PATH 테스트 통과 |
| 2026-08-14T20:29:40+09:00 | #acp1-diag | claude-code | ☐→x | .oculpm/journal/20260814/Features_to_add/2029_feature_acp1-adapter-runtime.md | 설정→통합 AcpRuntimeBlock 3행(Node·Claude CLI·어댑터) + path_source 표시 + 설치 버튼 |
| 2026-08-14T20:47:26+09:00 | #acp2-cmds | claude-code | ☐→x | .oculpm/journal/20260814/Features_to_add/2047_feature_acp2-session-streaming.md | acp_prompt(Channel<AcpEvent>)·acp_cancel 추가. 알림 싱크 교체 방식으로 라우팅 |
| 2026-08-14T20:47:32+09:00 | #acp2-ui | claude-code | ☐→x | .oculpm/journal/20260814/Features_to_add/2047_feature_acp2-session-streaming.md | AcpConversation 분리 + 툴바 모드 전환(aiMode 영속). 누적은 순수 리듀서 acpTurns |
| 2026-08-14T21:03:54+09:00 | #acp3-tools | claude-code | ☐→x | .oculpm/journal/20260814/Features_to_add/2103_feature_acp3-tool-calls-permission.md | 툴콜 카드 + 인라인 승인. spawn 으로 dispatch 루프 해제, 미결 요청은 항상 취소로 닫힘 |
| 2026-08-14T21:24:42+09:00 | #acp4-config | claude-code | ☐→x | .oculpm/journal/20260814/Features_to_add/2124_feature_acp4-auto-start-config-options.md | configOptions 5종 셀렉터 + usage 배지 + 자동 시작. 세션 생성을 acp_start 로 당김. 플랜 카드는 미구현 |
| 2026-08-16T03:44:14+09:00 | #acp1-pkg | claude-code | ☐→x | .oculpm/journal/20260816/Chores/0344_chore_v2-11-release-verify-and-promo-kit.md | v2.11.0 릴리스 아티팩트를 /Applications 교체 후 LaunchServices(open -a) 실행 — 어댑터 스폰·세션·스트리밍 전부 동작, 빈약 PATH 조건 실증 |
| 2026-08-19T09:43:00+09:00 | #acp-bump-070 | claude-code | ☐→x | .oculpm/journal/20260819/Features_to_add/0942_feature_acp-file-change-audit.md | 스파이크 재실행 — session/update 불변. 번들 Claude Code 는 그대로(sdk 0.3.232) |
| 2026-08-19T09:43:05+09:00 | #acp-file-change-audit | claude-code | ☐→x | .oculpm/journal/20260819/Features_to_add/0942_feature_acp-file-change-audit.md | 신규 스파이크 3으로 계약 실측. 추론 영수증과 어긋날 때만 표시 |
| 2026-08-20T20:54:00+09:00 | #acp-pending-tab | claude-code | ☐→x | .oculpm/journal/20260820/Bugs/2054_bug_new-session-has-no-tab.md | acpTabs 에 넣지 않고 tabItems 에서만 붙인다 — 디스크에 못 여는 탭이 남지 않게 |
| 2026-08-20T20:55:00+09:00 | #acp-title-echo | claude-code | ☐→x | .oculpm/journal/20260820/Bugs/2055_bug_title-follows-last-prompt.md | SDK summary = customTitle→aiTitle→lastPrompt 순. 지시문 메아리를 가려 첫 지시문을 지킨다 |
| 2026-08-20T20:56:00+09:00 | #acp-usage-detail-read | claude-code | ☐→x | .oculpm/journal/20260820/Bugs/2056_bug_usage-detail-unreadable.md | 네 모양만 뜯고 모르는 줄은 원문 그대로 — 판올림에 빈칸이 되지 않게 |
| 2026-08-20T22:30:00+09:00 | #acp-parallel-sessions | claude-code | ☐→x | .oculpm/journal/20260820/Features_to_add/2230_feature_parallel-acp-sessions.md | 스파이크 4 로 어댑터 동시 세션 확인(스트림 교차) 후 구현. acp_prompt/acp_cancel 에 session_id, PendingPermission 세션 스코프, 프런트 busy/error/usage/permission 세션별 분리 |
<!-- oculpm:plan-log end -->
