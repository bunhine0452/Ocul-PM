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
- [x] P0-1 git 변경·활성 플랜·관련 일지 확인, 다른 세션과 겹치는 경로 식별 {#p0-baseline}
- [x] P0-2 현재 첫 실행 → 첫 기록 흐름을 코드로 재현하고 단계·실패 위치를 기록 (docs/product-direction-2026-09-21/PHASE0.md) {#p0-reproduce}
- [x] P0-3 AI 패널·앱 ACP·외부 플러그인·AGENTS.md 전용의 준비/실행/귀속/검색/전달 관측 범위표 {#p0-observability}
- [x] P0-4 첫 검증 경로 하나 확정 + 재사용할 기존 데이터·API 범위 확정 {#p0-path}

## Phase 1 — 첫 기록 성공 연결 {#p1}
- [x] P1-A 백엔드 first_record 원장 — 대화(agent.session) 단위로 마커·sessions.json·캐시 일지·미기록 신호를 합쳐 첫 일지 귀속을 답하는 커맨드 (순수 judge + IO collect, Rust 테스트) {#p1-ledger}
- [x] P1-1 실행 환경별 준비 상태와 실패 복구 동선 — CLI·플러그인·MCP 등록(설정 존재)과 훅 마커(실제 연결)를 구분해 표시 {#p1-readiness}
- [x] P1-2 프로젝트별 첫 기록 확인을 Today 흐름에 연결 — 「첫 기록」카드: 준비/실행 중/기록 확인/기록 없이 종료/귀속 불명 5상태, 해당 대화의 실제 일지 열기 {#p1-card}
- [x] P1-3 재시도·닫기·재실행·기존 기록 보유 프로젝트 처리 — 프로젝트별 armed 상태 영속, 총 일지 수·백필로 성공 처리하지 않음, 기존 사용자 회귀 없음 {#p1-states}
- [x] P1-4 선택한 경로의 안내 문구를 실제 조건과 일치 — 마법사 마무리 판·Today 빈 상태·플러그인 카드 문구 vs 실제 조건 대조 (ko/en) {#p1-copy}
- [~] P1-V 실제 왕복 검증 — 이 경로에서 실제 대화의 첫 일지가 카드에 도착하는지(설치본 재빌드 전이면 미검증으로 명시) {#p1-verify}

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
| 2026-09-22T01:16:20+09:00 | #p0-baseline | claude-code | ☐→x | .oculpm/journal/20260922/Features_to_add/0116_feature_first-record-card-and-ledger.md | PHASE0.md P0-1 — main@9ab966b6, 다른 세션 WIP 미접촉, 겹침은 #acp-journal-draft 뿐(재사용으로 해소) |
| 2026-09-22T01:16:26+09:00 | #p0-reproduce | claude-code | ☐→x | .oculpm/journal/20260922/Features_to_add/0116_feature_first-record-card-and-ledger.md | PHASE0.md P0-2 — 7단계 코드 재현 + 실패 위치 F-A~F-D. 실기기 클릭은 설치본 실행 중이라 미검증 |
| 2026-09-22T01:16:36+09:00 | #p0-observability | claude-code | ☐→x | .oculpm/journal/20260922/Features_to_add/0116_feature_first-record-card-and-ledger.md | PHASE0.md P0-3 표 — recall_touch 는 AI 패널 전용, ACP·외부 MCP 에 검색/읽기/전달 관측 없음 |
| 2026-09-22T01:16:41+09:00 | #p0-path | claude-code | ☐→x | .oculpm/journal/20260922/Features_to_add/0116_feature_first-record-card-and-ledger.md | Claude Code 터미널 + oculpm 플러그인 확정. 재사용: verdict 마커·sessions.json·037 agent_session·ledger 해소 필터. 새 스키마 없음 |
| 2026-09-22T01:16:48+09:00 | #p1-ledger | claude-code | ☐→x | .oculpm/journal/20260922/Features_to_add/0116_feature_first-record-card-and-ledger.md | oculpm::first_record assemble/collect + cache entries_since_workday + 커맨드 first_record_ledger, Rust 테스트 8 (bd728b5f) |
| 2026-09-22T01:16:55+09:00 | #p1-readiness | claude-code | ☐→x | .oculpm/journal/20260922/Features_to_add/0116_feature_first-record-card-and-ledger.md | 카드 준비 상태 — CLI·플러그인 탐침(있음/못 찾음/확인 못 함) + hooks_seen(실제 연결) 분리. 이월: subheadIdle 이 oculpmReady=false 에서도 "없어요"(모름≠없음) |
| 2026-09-22T01:17:04+09:00 | #p1-card | claude-code | ☐→x | .oculpm/journal/20260922/Features_to_add/0116_feature_first-record-card-and-ledger.md | FirstRecordCard 5상태 + firstRecordModel 우선순위 + useFirstRecord(이벤트+분 틱). vitest 17건. 열기는 그 대화의 첫 일지 경로 |
| 2026-09-22T01:17:11+09:00 | #p1-states | claude-code | ☐→x | .oculpm/journal/20260922/Features_to_add/0116_feature_first-record-card-and-ledger.md | workspace firstRecordArmed(프로젝트별 영속) — 일지 0건에 켜고 확인·닫기로 끔. 백필로 숫자 올라도 유지, 기존 프로젝트 미노출, 귀속 불명은 별 상태 |
| 2026-09-22T01:17:20+09:00 | #p1-copy | claude-code | ☐→x | .oculpm/journal/20260922/Features_to_add/0116_feature_first-record-card-and-ledger.md | opus worktree 감사 — ko/en 9키 값 교정(welcome.lang.sub·project.sub/note·ready.li3·today.activated·terminal.hint·plugin.body·firstRun.oculpmDir/gitignore). 새 키·컴포넌트 변경 0 |
| 2026-09-22T01:17:27+09:00 | #p1-verify | claude-code | ☐→~ | .oculpm/journal/20260922/Features_to_add/0116_feature_first-record-card-and-ledger.md | 입력 쪽 실증 완료 — 이 대화의 일지가 agent.session=11374f00-… 로 남았고, 개발 빌드 verdict --transcript 가 파일 7개를 양성 귀속. 카드 화면은 설치본 재빌드·실행 후 확인 필요 |
<!-- oculpm:plan-log end -->
