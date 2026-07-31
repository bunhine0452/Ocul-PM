---
oculpm_plan: v1
id: ponytail-round
title: "ponytail 벤치마킹 라운드 — 카나리·부채 원장·컨텍스트 주입"
status: active
created: 2026-07-31
updated: 2026-07-31
owner: claude-code
---

DietrichGebert/ponytail 조사(2026-07-31, 리서치 에이전트 실코드 확인)에서 채택한
3건 + 백로그 2건. 제품 방향(코드 스타일 강제)은 불채택 — 배포 공학만 이식한다.

## Phase 1 — 규칙 사본 카나리 {#round-1}
- [x] C1 불변 문구 카나리 테스트 — 하중 규칙 문구(.oculpm/index 금지·secrets 금지·frontmatter 필수 키·plan-log append·부모 롤업 금지)가 정본(master_ko/en)·MCP instructions·플러그인 oculpm-journal 스킬에 전부 존재하는지 cargo 테스트로 핀 고정 {#rule-canary}

## Phase 2 — 미룬 것의 원장 (defer ledger) {#round-2}
- [x] D1 템플릿 v8 — "의도적으로 미룬 지름길은 `// oculpm-defer: <천장>; <재방문 트리거>` 주석" 규칙 1줄 (ko/en, 크기 가드 내), template_version 8 {#defer-template}
- [x] D2 defer 신호 백엔드 — 프로젝트 파일에서 oculpm-defer 주석 수확(결정적, gitignore 존중, 상한), 트리거 없는 마커 no-trigger 태깅. eval_signals 처럼 독립 커맨드(회고 signature 비오염) {#defer-signals}
- [x] D3 회고 "미룬 지름길" 카드 — EvalTrend 결로 자기은닉 패널: 마커 목록+no-trigger 배지+클릭 시 에디터 열기. 플래너 원클릭 승격은 후속 {#defer-panel}

## Phase 3 — 훅 컨텍스트 주입 {#round-3}
- [x] H1 SessionStart 플랜 요약 주입 — 활성 플랜의 진행중/막힘/다음 항목을 캡(≤1,200자) 걸어 additionalContext 로 주입. 절대 블록 금지(타임아웃 폴백·silent-fail·네트워크 없음 유지) {#hook-inject}
- [x] H2 SubagentStart 재주입 — 서브에이전트에 SessionStart 컨텍스트가 안 닿는 구멍(ponytail #252 발견) 대응: 같은 요약을 서브에이전트에도. 매니페스트 훅 계약 테스트·계약 문서·플러그인 문서 페이지 갱신 동승 {#hook-subagent}

## Phase 4 — 벤치 후속 (실측 근거, 사용자 승인 2026-07-31) {#round-4}
- [x] H3 미기록 세션 신호 — 세션 마커(create-only)+SessionEnd 판정: 미작성이면 stderr 경고+journal-missing.jsonl(상한 트림). 근거=헤드리스 준수 0/12 실측 {#journal-missing-signal}

## 백로그 (착수 트리거 명시)
- [x] B1 statusline 배지 — 디스패치된 플랜 항목 `[OCULPM: …]` 표시 + 1회성 넛지 (사용자 승인으로 착수) {#statusline-badge}
- [x] B3 H3b 앱 소비자 — journal-missing.jsonl 을 워처가 소비해 Today 에 "일지 없이 끝난 세션" 카드 + 초안 안내 (사용자 승인으로 착수) {#journal-missing-consumer}
- [x] B2 에이전틱 A/B 벤치마크 — AGENTS.md 주입 비용/효과 측정, ponytail 방법론(오염 격리 --setting-sources/--plugin-dir) 재사용 (트리거: 랜딩 수치 필요 시) {#agentic-bench}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-07-31T18:17:00+09:00 | #round-1 | claude-code | →☐ | | ponytail 조사 보고 기반 라운드 개설 — 채택 3(카나리·defer·주입)/백로그 2(statusline·벤치), 불채택(사다리·모드)은 계획 서문에 |
| 2026-07-31T18:58:00+09:00 | #rule-canary | claude-code | ☐→x | .oculpm/journal/20260731/Chores/1855_chore_rule-canary.md | 5표면 카나리 테스트. 리뷰 반영: instructions 상수 추출로 서빙 문자열 검증 |
| 2026-07-31T18:58:10+09:00 | #defer-template | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/1856_feature_defer-ledger.md | v8 규칙 1줄, ko 3,504/en 5,116 chars 가드 내 |
| 2026-07-31T18:58:20+09:00 | #defer-signals | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/1856_feature_defer-ledger.md | 리뷰 HIGH(템플릿 자기수확→문서 확장자 제외)·MED(인접 게이트) 반영. walk 비용은 후속 캐시 후보 |
| 2026-07-31T18:58:30+09:00 | #defer-panel | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/1856_feature_defer-ledger.md | 자기은닉 카드+no-trigger 배지+에디터 열기. 플래너 승격은 후속 |
| 2026-07-31T18:58:40+09:00 | #hook-inject | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/1857_feature_hook-plan-context.md | 리뷰 HIGH: JSON additionalContext 로 교체(plain stdout 은 서브에이전트에 안 닿음). 프레이밍·frontmatter 스코프·절단 표식 |
| 2026-07-31T18:58:50+09:00 | #hook-subagent | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/1857_feature_hook-plan-context.md | 같은 스크립트 재주입, 매니페스트 4이벤트 계약 테스트 |
| 2026-07-31T19:05:00+09:00 | #agentic-bench | claude-code | ☐→~ | | 사용자 "진행해" — 착수 트리거 격상. 하네스(benchmarks/agentic: 합성 타깃+티켓 6·2팔 러너·격리 플래그·준수 채점기) 구축+스모크 진행 중 |
| 2026-07-31T19:36:00+09:00 | #agentic-bench | claude-code | ~→x | .oculpm/journal/20260731/Chores/1935_chore_agentic-ab-benchmark.md | 24세션 완주 — 무손상(성공률 동률·cost 동률) + 헤드리스 단발 준수 0/12(→CI1 초안 기능의 존재 근거). 리포트 results/2026-07-31-agentic.md |
| 2026-07-31T20:12:00+09:00 | #journal-missing-signal | claude-code | →x | .oculpm/journal/20260731/Features_to_add/2010_feature_journal-missing-signal.md | 리뷰 HIGH(compact 재터치 오탐→create-only)·LOW3 수정, MED(동시 세션 미탐)는 보수적 수용. 앱 소비자(H3b)는 백로그 |
| 2026-07-31T20:35:00+09:00 | #statusline-badge | claude-code | ☐→~ | | 사용자 "나머지도 진행해" — B1·H3b 동시 착수 |
| 2026-07-31T21:15:00+09:00 | #statusline-badge | claude-code | ~→x | .oculpm/journal/20260731/Features_to_add/2110_feature_statusline-badge.md | 플래그(ttl·살균)+스크립트(-F 매치·perl 절단)+1회 넛지. 리뷰 4건 반영 |
| 2026-07-31T21:15:10+09:00 | #journal-missing-consumer | claude-code | ~→x | .oculpm/journal/20260731/Features_to_add/2111_feature_journal-missing-consumer.md | Today 카드+해소 필터(거짓 경고 자동 정리)+크로스 계약 테스트. 리뷰 8건 전수 처리 — ponytail 라운드 전 항목 완료 |
<!-- oculpm:plan-log end -->
