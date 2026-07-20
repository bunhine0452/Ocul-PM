---
oculpm_plan: v1
id: claude-integration
title: "Claude 직접 연동 + 규칙 플라이휠 라운드"
status: active
created: 2026-07-20
updated: 2026-07-20
owner: claude-code
---

바이브코딩 보고서(docs/vibe coding/)의 방법론을 제품화하는 라운드. SSOT 는
docs/claude-integration/00-master-plan.md — 결정(D1~D6)·수용 기준은 그 문서가 정답이고,
이 plan 은 진척만 추적한다.

## Phase 0 — 설계 {#design}
- [x] 보고서 분석 + Claude 연동 표면 조사 + 마스터플랜(D1~D6, PR-CI0~8) 작성 {#design-master-plan}

## Phase A — 기록의 결정론화 {#phase-a}
- [ ] PR-CI0 훅 브리지 — payload 실측 스파이크, settings.local.json 설치/드리프트, .oculpm/hooks 인박스+watcher 라우팅, SessionActor 정밀 신호 {#ci0-hook-bridge}
- [ ] PR-CI1 transcript 일지 초안 — 방어적 파싱, 옵인 LLM 초안→redact→규격 일지, 자필 일지 중복 스킵 {#ci1-transcript-draft}
- [ ] PR-CI2 oculpm-mcp v1 — journal_write/plan_status/plan_update stdio 서버, sidecar 번들, .mcp.json+Desktop 등록, 템플릿 v5 {#ci2-mcp-server}

## Phase B — 규칙 플라이휠 {#phase-b}
- [ ] PR-CI3 규칙 허브 — 스킬 화면 탭 확장(규칙/훅), CLAUDE.md·.claude/rules CRUD+globs, 크로스툴 번역 {#ci3-rules-hub}
- [ ] PR-CI4 실패→규칙 승격 루프 — 회고·일지 신호→규칙 초안 제안(globs 추론)→승인 저장 {#ci4-rule-promotion}
- [ ] PR-CI5 추천 스킬 갤러리 — self-audit·run-evals·tdd-workflow 원클릭 설치 {#ci5-skill-gallery}

## Phase C — 검증·아웃바운드 {#phase-c}
- [ ] PR-CI6 EDD-lite — 플래너 완료 소프트 게이트 + 회고 eval 신호 {#ci6-edd-lite}
- [ ] PR-CI7 Notion 내보내기 v1 — internal token 키체인 + REST 페이지 생성, 회고/주간 요약 {#ci7-notion-export}
- [ ] PR-CI8 oculpm 플러그인 패키징 — 훅+MCP 번들 배포 골격 {#ci8-plugin-packaging}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-07-20T13:40:46+09:00 | #design-master-plan | claude-code | →x | journal/20260720/Chores/1340_chore_claude-integration-master-plan.md | 조사 2건(연동 표면·코드베이스 매핑) 종합 → D1~D6 결정 + PR-CI0~8 분해. 훅 payload 는 PR-CI0 실측 스파이크로 재검증 예정 |
<!-- oculpm:plan-log end -->
