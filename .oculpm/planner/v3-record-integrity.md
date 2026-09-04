---
oculpm_plan: v1
id: v3-record-integrity
title: "기둥 1 — 기록이 진짜로 남는다 (3.0)"
status: active
created: 2026-09-04
updated: 2026-09-04
owner: claude-code
---

제품 약속 1번이 조용히 새고 있다. 배달 게이트·미기록 신호·Today 카드 세 표면이 전부 프로젝트 전역 journal mtime 한 근사에 얹혀 있어 병렬 세션에서 동시에, 전부 미탐 방향으로 무너진다. 고칠 재료(AgentRef.session·Session.agent_sessions)는 v2.40.0 이 이미 넣었는데 읽는 코드가 0곳이다.

## 사실 확인 먼저 {#facts}
- [ ] 새 빌드에서 AgentRef.session 이 실제로 채워지는지 확인 — 저장소 일지 537건 중 0건이지만 원인은 낡은 설치 바이너리로 추정된다. 확정 전까지 이 Phase 밖은 진행하지 않는다 {#verify-agent-session}
- [ ] 무기록 신호 164건 중 기록했어야 할 세션의 실제 비율 — 세션별 git 변경 대조. 지금 42% 는 상한이고 하한은 게이트 차단 4건이다 {#measure-miss-rate}

## 판정을 하나로 {#verdict-fn}
- [ ] 세션 귀속 판정을 순수 함수 하나로 — mcp-lifecycle-hooks 의 verdict-fn 이 옷게 설계해 놓고 하네스가 없어 폐기한 그 함수를 되살린다 {#pure-verdict}
- [ ] 판정 입력을 mtime → 세션 귀속으로 (agent.session / agent_sessions / sessions.json) {#verdict-inputs}
- [ ] 세 표면이 그 함수 하나를 부르게 — delivery-gate.sh·session-end.sh·claude_hooks.rs:404-448 {#three-surfaces}
- [ ] ACP UUID ↔ ocul-pm session_id 매핑 (acp-agent-panel 의 acp2-sid 가 이 축의 나머지 반) {#acp-sid-map}
- [ ] 배달 게이트 테스트에 병렬 세션 케이스 추가 — 지금 7개 중 없다 (src-tauri/tests/delivery_gate.rs) {#gate-parallel-test}

## 0을 0이라고 말한다 {#speak-zero}
- [ ] 회고에 이번 주 무기록 세션 N건 상시 한 줄 — 자기은닉 카드는 깨끗함과 가려짐을 구조적으로 구별 못 한다 {#retro-standing-line}
- [ ] Today 카드가 0건일 때 숨는 대신 0을 말하게 (signals.length === 0 이면 return null 을 걷어낸다) {#card-unhide}
- [ ] 게이트를 Claude Code 밖으로 — 앱 안 ACP 세션(client_mcp_servers 가 훅을 안 넘긴다)과 Codex 플러그인 {#gate-beyond-cc}
- [ ] client_mcp_servers 의 두 번째 조용한 갈래 — 바이너리를 못 찾으면 빈 Vec 을 돌려 기록 도구 없이 세션이 열린다. 대화 화면에 표시 {#mcp-missing-visible}

## 플래너 병렬 쓰기 {#planner-cas}
- [ ] plan_status 응답에 해시 추가 — 지금 base_hash 의 유일한 출처가 직전 plan_update 응답이라 세션의 첫 갱신은 CAS 사용 자체가 불가능하고 그게 가장 흔한 경우다 {#plan-status-hash}
- [ ] plan_update 의 base_hash 필수화 + 충돌 시 재시도 프로토콜 — 도구 스키마·플러그인·문서의 모든 호출자를 바꿀다 {#cas-required}
- [ ] 크로스프로세스 파일 락 — a2a/leases.rs:326·a2a/mailbox.rs:163 의 create_new 관용구 재사용. 지금 plan_write_lock 은 인프로세스라 MCP 를 못 덮는다 {#cross-process-lock}
- [ ] 해시 비교(tools/mod.rs:1387)와 write_atomic(:1419) 사이 TOCTOU 창 닫기 {#cas-toctou}

## 유출 경계 원장 {#egress-ledger}
- [ ] src-tauri/tests/egress_inventory.rs — 기기 밖으로 나가는 호출(llm 진입점·mobile_bridge 핸들러·github·updater·notion)이 가드를 지나거나 사유가 적힌 면제 목록에 있거나, 새 자리면 빌드 실패 {#egress-inventory-test}
- [ ] redact.rs 모듈 독 정정 (문서 3 vs 현실 19파일) + 면제 개수 자체를 세어 보고 {#redact-doc-truth}
- [ ] 모델 호출이 있는 자동화 정의에 이 자동화는 프로젝트 내용을 <provider> 로 보냅니다 배지. 로컬 모델이면 안 붙는다 — 그 구분이 제품 약속의 핵심인데 지금 화면에 없다 {#automation-egress-badge}
- [ ] 자동화 스텝별 조건(열거형, 자유 표현식 금지) — 지금 일지 3건 이상일 때만 주간 요약 이 안 되고 빈 요약을 만들고 성공했다고 말한다 {#automation-step-if}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
