---
oculpm_plan: v1
id: first-record-loop
title: "첫 기록 성공 → 다음 세션 재사용 (제품 방향 2026-09-21 실행)"
status: active
created: 2026-09-22
updated: 2026-09-22
owner: claude-code
---

docs/product-direction-2026-09-21/REPORT.md 의 실행 플랜. 검증 경로 하나(Claude Code 터미널 + oculpm 플러그인)에서 프로젝트 열기 → 준비 확인 → 실제 작업 → 그 대화의 첫 일지 확인을 연결하고, 이어서 다음 세션의 재사용 왕복을 검증한다. 보고서는 제안이고 진척은 이 플랜이 갖는다.

## Phase 0 — 기준선과 한 경로 확정 {#p0}
- [ ] P0-1 git 변경·활성 플랜·관련 일지 확인, 다른 세션과 겹치는 경로 식별 {#p0-baseline}
- [ ] P0-2 현재 첫 실행 → 첫 기록 흐름을 코드로 재현하고 단계·실패 위치를 기록 (docs/product-direction-2026-09-21/PHASE0.md) {#p0-reproduce}
- [ ] P0-3 AI 패널·앱 ACP·외부 플러그인·AGENTS.md 전용의 준비/실행/귀속/검색/전달 관측 범위표 {#p0-observability}
- [ ] P0-4 첫 검증 경로 하나 확정 + 재사용할 기존 데이터·API 범위 확정 {#p0-path}

## Phase 1 — 첫 기록 성공 연결 {#p1}
- [ ] P1-A 백엔드 first_record 원장 — 대화(agent.session) 단위로 마커·sessions.json·캐시 일지·미기록 신호를 합쳐 첫 일지 귀속을 답하는 커맨드 (순수 judge + IO collect, Rust 테스트) {#p1-ledger}
- [ ] P1-1 실행 환경별 준비 상태와 실패 복구 동선 — CLI·플러그인·MCP 등록(설정 존재)과 훅 마커(실제 연결)를 구분해 표시 {#p1-readiness}
- [ ] P1-2 프로젝트별 첫 기록 확인을 Today 흐름에 연결 — 「첫 기록」카드: 준비/실행 중/기록 확인/기록 없이 종료/귀속 불명 5상태, 해당 대화의 실제 일지 열기 {#p1-card}
- [ ] P1-3 재시도·닫기·재실행·기존 기록 보유 프로젝트 처리 — 프로젝트별 armed 상태 영속, 총 일지 수·백필로 성공 처리하지 않음, 기존 사용자 회귀 없음 {#p1-states}
- [ ] P1-4 선택한 경로의 안내 문구를 실제 조건과 일치 — 마법사 마무리 판·Today 빈 상태·플러그인 카드 문구 vs 실제 조건 대조 (ko/en) {#p1-copy}
- [ ] P1-V 실제 왕복 검증 — 이 경로에서 실제 대화의 첫 일지가 카드에 도착하는지(설치본 재빌드 전이면 미검증으로 명시) {#p1-verify}

## Phase 2 — 다음 세션에서 이어가기 (검토 후 착수) {#p2}
- [ ] P2-1 기존 기록·활성 플랜을 읽어 이어하기 자료 구성 (결정적 목록·발췌, LLM 불필요) {#p2-resume-data}
- [ ] P2-2 근거 원문 확인과 전달 내용 미리보기 {#p2-preview}
- [ ] P2-3 기존 에이전트 실행 또는 외부 전달 경로 하나에 연결 — AGENTS.md §0 / plan-context.sh 외에 일지 회상 주입 경로 {#p2-deliver}
- [ ] P2-4 검색·읽기·전달의 관측 의미 구분 표시 — recall_touch 는 AI 패널 전용이라는 한계 명시 {#p2-observe}

## Phase 3~4 — 소개 정렬·소규모 관찰 (근거 생긴 뒤) {#p3}
- [ ] P3 README·랜딩·시작 위키를 핵심 경험 중심으로 편집 + 실제 왕복 촬영 — 사용자 결정 후 {#p3-intro}
- [ ] P4 소규모 사용자 관찰 준비·실행 — 사용자가 명시적으로 요청할 때만 {#p4-observe}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
