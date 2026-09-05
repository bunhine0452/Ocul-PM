---
oculpm_plan: v1
id: v3-record-integrity
title: "기둥 1 — 기록이 진짜로 남는다 (3.0)"
status: done
created: 2026-09-04
updated: 2026-09-05
owner: claude-code
---

제품 약속 1번이 조용히 새고 있다. 배달 게이트·미기록 신호·Today 카드 세 표면이 전부 프로젝트 전역 journal mtime 한 근사에 얹혀 있어 병렬 세션에서 동시에, 전부 미탐 방향으로 무너진다. 고칠 재료(AgentRef.session·Session.agent_sessions)는 v2.40.0 이 이미 넣었는데 읽는 코드가 0곳이다.

## 사실 확인 먼저 {#facts}
- [x] 새 빌드에서 AgentRef.session 이 실제로 채워지는지 확인 — 저장소 일지 537건 중 0건이지만 원인은 낡은 설치 바이너리로 추정된다. 확정 전까지 이 Phase 밖은 진행하지 않는다 {#verify-agent-session}
- [x] 무기록 신호 164건 중 기록했어야 할 세션의 실제 비율 — 세션별 git 변경 대조. 지금 42% 는 상한이고 하한은 게이트 차단 4건이다 {#measure-miss-rate}

## 판정을 하나로 {#verdict-fn}
- [x] 세션 귀속 판정을 순수 함수 하나로 — mcp-lifecycle-hooks 의 verdict-fn 이 옷게 설계해 놓고 하네스가 없어 폐기한 그 함수를 되살린다 {#pure-verdict}
- [x] 판정 입력을 mtime → 세션 귀속으로 (agent.session / agent_sessions / sessions.json) {#verdict-inputs}
- [x] 세 표면이 그 함수 하나를 부르게 — delivery-gate.sh·session-end.sh·claude_hooks.rs:404-448 {#three-surfaces}
- [x] ACP UUID ↔ ocul-pm session_id 매핑 (acp-agent-panel 의 acp2-sid 가 이 축의 나머지 반) {#acp-sid-map}
- [x] 배달 게이트 테스트에 병렬 세션 케이스 추가 — 지금 7개 중 없다 (src-tauri/tests/delivery_gate.rs) {#gate-parallel-test}

## 0을 0이라고 말한다 {#speak-zero}
- [x] 회고에 이번 주 무기록 세션 N건 상시 한 줄 — 자기은닉 카드는 깨끗함과 가려짐을 구조적으로 구별 못 한다 {#retro-standing-line}
- [x] Today 카드가 0건일 때 숨는 대신 0을 말하게 (signals.length === 0 이면 return null 을 걷어낸다) {#card-unhide}
- [x] 게이트를 Claude Code 밖으로 — 앱 안 ACP 세션(client_mcp_servers 가 훅을 안 넘긴다)과 Codex 플러그인 {#gate-beyond-cc}
- [x] client_mcp_servers 의 두 번째 조용한 갈래 — 바이너리를 못 찾으면 빈 Vec 을 돌려 기록 도구 없이 세션이 열린다. 대화 화면에 표시 {#mcp-missing-visible}

## 플래너 병렬 쓰기 {#planner-cas}
- [x] plan_status 응답에 해시 추가 — 지금 base_hash 의 유일한 출처가 직전 plan_update 응답이라 세션의 첫 갱신은 CAS 사용 자체가 불가능하고 그게 가장 흔한 경우다 {#plan-status-hash}
- [x] plan_update 의 base_hash 필수화 + 충돌 시 재시도 프로토콜 — 도구 스키마·플러그인·문서의 모든 호출자를 바꿀다 {#cas-required}
- [x] 크로스프로세스 파일 락 — a2a/leases.rs:326·a2a/mailbox.rs:163 의 create_new 관용구 재사용. 지금 plan_write_lock 은 인프로세스라 MCP 를 못 덮는다 {#cross-process-lock}
- [x] 해시 비교(tools/mod.rs:1387)와 write_atomic(:1419) 사이 TOCTOU 창 닫기 {#cas-toctou}

## 유출 경계 원장 {#egress-ledger}
- [x] src-tauri/tests/egress_inventory.rs — 기기 밖으로 나가는 호출(llm 진입점·mobile_bridge 핸들러·github·updater·notion)이 가드를 지나거나 사유가 적힌 면제 목록에 있거나, 새 자리면 빌드 실패 {#egress-inventory-test}
- [x] redact.rs 모듈 독 정정 (문서 3 vs 현실 19파일) + 면제 개수 자체를 세어 보고 {#redact-doc-truth}
- [x] 모델 호출이 있는 자동화 정의에 이 자동화는 프로젝트 내용을 <provider> 로 보냅니다 배지. 로컬 모델이면 안 붙는다 — 그 구분이 제품 약속의 핵심인데 지금 화면에 없다 {#automation-egress-badge}
- [x] 자동화 스텝별 조건(열거형, 자유 표현식 금지) — 지금 일지 3건 이상일 때만 주간 요약 이 안 되고 빈 요약을 만들고 성공했다고 말한다 {#automation-step-if}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-05T13:29:18+09:00 | #verify-agent-session | claude-code | ☐→x | .oculpm/journal/20260905/Chores/1324_chore_phase0-measure-session-attribution.md | 가설 둘 다 기각 — 채워진다. 필드가 하루 전 생겨서였다 (548중 5건) |
| 2026-09-05T13:29:20+09:00 | #measure-miss-rate | claude-code | ☐→x | .oculpm/journal/20260905/Chores/1324_chore_phase0-measure-session-attribution.md | 164=세그먼트, 고유 대화 117. 진짜 미기록 2건(2%), 오탐 8, 소음 43, 판정불가 64(55%) |
| 2026-09-05T13:29:23+09:00 | #pure-verdict | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1326_feature_verdict-one-function-three-surfaces.md | verdict/ 신설. judge() 순수 + collect() 분리 — 폐기 사유였던 하네스 부재가 같이 풀렸다 |
| 2026-09-05T13:29:25+09:00 | #verdict-inputs | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1326_feature_verdict-one-function-three-surfaces.md | 4단 사다리. 없음=다음 입력으로(≠미기록). 옆 대화 살아있으면 mtime 폴백 자체를 안 쓴다 |
| 2026-09-05T13:29:28+09:00 | #three-surfaces | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1326_feature_verdict-one-function-three-surfaces.md | oculpm-mcp verdict 진입점(셔틀 재사용). 종료코드로 전달, 바이너리 없으면 침묵 |
| 2026-09-05T13:29:31+09:00 | #gate-parallel-test | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1326_feature_verdict-one-function-three-surfaces.md | 골든 케이스는 이 라운드에서 실제로 겪은 것. 고치기 전 코드에서 실패 확인 후 9 passed |
| 2026-09-05T13:29:33+09:00 | #acp-sid-map | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1327_feature_gate-beyond-claude-code-acp.md | UUID는 응답에 와서 못 쓴다 — 세 번째 값을 먼저 발급. SessionId 방언 불변 |
| 2026-09-05T13:29:39+09:00 | #retro-standing-line | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1329_feature_speak-zero-instead-of-hiding.md | loading·오류·빈 기간 분기보다 위에 배치 — 안에 두면 그 자기은닉을 재현한다. 기간은 화면 창을 따름 |
| 2026-09-05T13:29:42+09:00 | #card-unhide | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1329_feature_speak-zero-instead-of-hiding.md | 0건에 초록 체크 대신 한계 문구. 분모는 알 수 없어 지어내지 않음 |
| 2026-09-05T13:29:45+09:00 | #gate-beyond-cc | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1327_feature_gate-beyond-claude-code-acp.md | 흔적 파일 두 개가 크로스에이전트 상호 인식. Codex는 이미 우리 훅을 실행 중이었고 루트 해석만 고침 |
| 2026-09-05T13:29:47+09:00 | #mcp-missing-visible | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1327_feature_gate-beyond-claude-code-acp.md | 덤으로 acp_load_session 이 mcp_servers 를 안 넘겨 재개 시 도구가 사라지던 버그를 잡았다 |
| 2026-09-05T13:29:50+09:00 | #plan-status-hash | claude-code | ☐→x | .oculpm/journal/20260905/Refactors/1327_refactor_planner-parallel-write-cas.md | plan_status·plan_create 응답에 해시. 이제 첫 갱신도 CAS 가능 |
| 2026-09-05T13:29:53+09:00 | #cas-required | claude-code | ☐→x | .oculpm/journal/20260905/Refactors/1327_refactor_planner-parallel-write-cas.md | 강제 우회로 없음 — 계약이 둘이 되면 마찰 만난 쪽이 늘 둘째를 고른다. 오류 문장이 곧 마이그레이션 경로 |
| 2026-09-05T13:29:54+09:00 | #cross-process-lock | claude-code | ☐→x | .oculpm/journal/20260905/Refactors/1327_refactor_planner-parallel-write-cas.md | file_guard.rs 로 공용화, leases.rs 가 자기 구현 폐기. mailbox 는 락이 아니라 제외(사유 주석) |
| 2026-09-05T13:30:02+09:00 | #cas-toctou | claude-code | ☐→x | .oculpm/journal/20260905/Refactors/1327_refactor_planner-parallel-write-cas.md | 락 하나로 닫음. 반증 실험: 상호배제만 빼니 8전이 중 7유실 + 어느 스레드도 실패 안 함 |
| 2026-09-05T13:30:04+09:00 | #egress-inventory-test | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1328_feature_egress-ledger-and-automation-conditions.md | 집합 상등이라 늘릴 수도 줄일 수도 없다. 변이 5건 전부 잡힘. Rust 15곳·웹뷰 7곳·호스트 21 |
| 2026-09-05T13:30:07+09:00 | #redact-doc-truth | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1328_feature_egress-ledger-and-automation-conditions.md | 플랜 숫자(문서3/현실19)가 낡았다 — 실측은 문서22 주장·현실 23파일·면제 4. 테스트가 상수와 대조 |
| 2026-09-05T13:30:10+09:00 | #automation-egress-badge | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1328_feature_egress-ledger-and-automation-conditions.md | 판정이 백엔드 소유 — 로컬 프로바이더가 붙는 날 배지가 저절로 사라진다 |
| 2026-09-05T13:30:12+09:00 | #automation-step-if | claude-code | ☐→x | .oculpm/journal/20260905/Features_to_add/1328_feature_egress-ledger-and-automation-conditions.md | 어휘 3종 열거형·fail-closed. 건너뛴 사실이 이력에 남는다. 빈 정의는 파일 바이트 불변 |
<!-- oculpm:plan-log end -->
