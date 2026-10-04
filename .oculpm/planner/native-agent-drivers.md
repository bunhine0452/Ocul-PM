---
oculpm_plan: v1
id: native-agent-drivers
title: "네이티브 에이전트 드라이버 — Claude stream-json · codex app-server"
status: active
created: 2026-10-05
updated: 2026-10-05
owner: claude-code
---

Claude Code·Codex 를 ACP 어댑터 대신 각 CLI 의 네이티브 통로로 구동한다. 화면 계약(AcpEvent)은 그대로, 버전은 고정 대신 감시. 설계 SSOT: docs/20261005_native-agent-drivers/00-master-plan.md

## P0 — 드라이버 trait 추출 + 버전 감시 {#p0-trait}
- [ ] AgentDriver trait 추출, 지금 코드를 AcpDriver 로 이동 — 동작 변화 0, 기존 ACP 테스트 전부 초록 (D2) {#trait-extract}
- [ ] 드라이버 계약 테스트 하네스 — 드라이버들이 같은 AcpEvent 열을 내는지 픽스처로 대조 (D1) {#driver-contract-harness}
- [ ] 스케줄 CI agent-cli-drift — 최신 claude·codex 설치 → Codex 스키마 재생성 diff · Claude initialize 핸드셰이크 대조 · 깨지면 이슈 (D8). CI 에서 initialize 가 로그인 없이 응답하는지 확인 {#cli-drift-ci}
- [ ] 앱 진단 — PATH 의 claude·codex 버전 감지 + 최소 버전 게이트(낮으면 ACP 로) + 기능 감지 결과 표시 (D5·D8) {#cli-version-gate}

## P1 — Codex app-server 드라이버 {#p1-codex}
- [ ] 최소 지원 버전에서 생성한 JSON 스키마로 타입 생성·커밋 — 손으로 안 고침 (D3) {#codex-schema-types}
- [ ] CodexAppServer 드라이버 — 대화·스트림·승인 3종(commandExecution·fileChange·permissions) → AcpEvent {#codex-driver}
- [ ] 목록·재생(thread/list·thread/read·thread/turns/list) + 사용량·한도(tokenUsage·rateLimits) {#codex-sessions}
- [ ] 앱에서 승인 대기 중 재시작 → thread/resume 재개 실측 {#codex-resume-verify}
- [ ] P1b — review/start · thread/fork · turn/diff/updated 를 이벤트 추가로만 노출 (기존 변형 불변) {#codex-native-extras}

## P2 — Claude stream-json 드라이버 {#p2-claude}
- [ ] ClaudeStreamJson 드라이버 — stream-json 기동 + 제어 프로토콜, can_use_tool → Permission (D4) {#claude-driver}
- [ ] set_permission_mode · set_model · interrupt 연결 {#claude-config}
- [ ] 목록·재생은 기존 transcript.rs·transcript_sessions.rs 재사용, --resume 재개 {#claude-sessions}
- [ ] --permission-prompt-tool stdio 와 사용자 권한 규칙·훅이 겹치는 순서 실측 → 설계 문서 §2 에 추가 (R8) {#claude-permission-order}
- [ ] 승인 대기 중 끊긴 대화를 --resume 후 재시도로 끝내는지 실측 (D6 미검증분) {#claude-resume-verify}

## P3 — 앱 안 /rc {#p3-rc}
- [x] 원격(폰·브라우저) → 헤드리스 프로세스 메시지 왕복 실측 (R7) — 안 되면 URL 표시 + 터미널 이어받기로 축소 {#rc-roundtrip}
- [ ] remote_control 요청 → session_url 링크·QR · 끄기 보장 · 기능 감지 실패 시 터미널 폴백 · 명령으로만 켬 (결정 3) {#rc-ui}

## P4 — 승인 대기 영속 + 무인 실행 {#p4-durable}
- [ ] 권한 요청 SQLite 영속 + 재시작 시 「승인을 기다리던 대화」 복구 → 승인 시 재개 (D6) {#durable-approvals}
- [ ] 자동화 러너 "에이전트 실행" 스텝 — 승인 대기 시 슬롯을 비우고 기록만 {#automation-agent-step}
- [ ] 위험 등급 정책(읽기 자동·쓰기 대기·외부 거부) + 결정을 그 실행의 일지에 기록 {#risk-tier-policy}

## P5 — 기본값 전환 {#p5-switch}
- [ ] 기본 드라이버를 네이티브로 전환 + ACP 되돌림 스위치 한 릴리스 (D7·결정 2) {#default-native}
- [ ] Acp* → Agent* 이름 정리 (기계적 변경만, 배관 변경과 분리) {#rename-agent-events}
- [ ] 회귀 0 확인 후 Claude·Codex 의 ACP 경로와 Node 의존 제거 판단 {#drop-node}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-05T02:21:24+09:00 | #rc-roundtrip | claude-code | ☐→x | .oculpm/journal/20261005/Chores/0221_chore_rc-remote-roundtrip-verified.md | 폰 발화 → 헤드리스 턴 실행 확인. 본문은 stdout 에 없고 트랜스크립트에. 원격 턴 권한 경로는 rc-ui 에서 |
<!-- oculpm:plan-log end -->
