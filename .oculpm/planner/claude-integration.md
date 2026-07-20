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
- [x] PR-CI0 훅 브리지 — payload 실측 스파이크, settings.local.json 설치/드리프트, .oculpm/hooks 인박스+watcher 라우팅, SessionActor 정밀 신호 {#ci0-hook-bridge}
- [ ] PR-CI0 실기기 확인 — pnpm tauri dev + 훅 켠 실제 Claude Code 세션 1회 → 세션 1개 정확 생성·AgentExit 종료(중복·유령 0) 확인 후 릴리스 판단 {#ci0-runtime-verify}
- [x] PR-CI1 transcript 일지 초안 — 방어적 파싱, 옵인 LLM 초안→redact→규격 일지, 자필 일지 중복 스킵 {#ci1-transcript-draft}
- [ ] PR-CI1 실기기 확인 — auto_journal_draft 켠 실세션 종료 → 초안 일지 생성(자필 일지 있으면 미생성) 확인 {#ci1-runtime-verify}
- [x] PR-CI2 oculpm-mcp v1 — journal_write/plan_status/plan_update stdio 서버, .mcp.json+Desktop 스니펫 등록, 템플릿 v5 {#ci2-mcp-server}
- [ ] PR-CI2 실기기 확인 — 설정에서 등록 후 실세션 도구 호출 + Claude Desktop 실연결 확인 {#ci2-runtime-verify}
- [ ] PR-CI2 후속 — .app 번들에 oculpm-mcp sidecar(externalBin) 동봉, 릴리스 빌드에서 검증 {#ci2-sidecar-bundle}

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
| 2026-07-20T14:11:28+09:00 | #ci0-hook-bridge | claude-code | →x | journal/20260720/Features_to_add/1411_feature_claude-hooks-bridge.md | 스파이크 실측(01 문서, payload 3필드 확인·local.json 발화 확인) + 설치기(서명 식별·깨진 파일 불변)+인박스(오프셋 SQLite 026)+watcher 1.5 라우팅+SessionActor AgentExit/실측 라벨+설정 UI. cargo 333·게이트 4종 그린, 훅측 E2E 3이벤트 적재 확인 |
| 2026-07-20T14:11:28+09:00 | #ci0-runtime-verify | claude-code | →☐ | journal/20260720/Features_to_add/1411_feature_claude-hooks-bridge.md | 인박스→세션 반영은 단위 테스트 커버 — 앱 실구동 세션 정확성(중복·유령 0)·AgentExit 라벨 UI 확인만 남음 |
| 2026-07-20T14:30:42+09:00 | #ci1-transcript-draft | claude-code | →x | journal/20260720/Features_to_add/1430_feature_claude-transcript-journal-draft.md | transcript.rs 방어 파서(사이드체인·tool 블록 제외, 접기)+journal_draft.rs(자필 스킵·강등 경로·타입별 헤더 결정적 조립·redact 이중방어)+agents.auto_journal_draft 옵인+설정 토글. ManualEntryDraft agent/verified 오버라이드. cargo 344·게이트 그린. 부수: 캐시 agent_version 소실 잠복버그 fix(Bugs/1431) |
| 2026-07-20T14:30:42+09:00 | #ci1-runtime-verify | claude-code | →☐ | journal/20260720/Features_to_add/1430_feature_claude-transcript-journal-draft.md | LLM 호출부만 실기기 미검증 — 옵인 켠 실세션 1회로 초안 생성·자필 스킵 확인 필요 |
| 2026-07-20T14:49:18+09:00 | #ci2-mcp-server | claude-code | →x | journal/20260720/Features_to_add/1449_feature_oculpm-mcp-server.md | 최소 JSON-RPC 직접 구현(D3 수정 — rmcp 은 도구 확장 시), 디스크 SSOT·앱 IPC 없음, .mcp.json 머지+Desktop 스니펫, 템플릿 v5(MCP 도구 우선). cargo 355·게이트 그린. **실 Claude Code E2E**: 3 도구 왕복 — 규격 일지·글리프·plan-log 전부 확인(앱 미실행) |
| 2026-07-20T14:49:18+09:00 | #ci2-runtime-verify | claude-code | →☐ | journal/20260720/Features_to_add/1449_feature_oculpm-mcp-server.md | 헤드리스 E2E 는 통과 — 앱 설정 UI 경유 등록 + Desktop 실연결만 남음 |
| 2026-07-20T14:49:18+09:00 | #ci2-sidecar-bundle | claude-code | →☐ | journal/20260720/Features_to_add/1449_feature_oculpm-mcp-server.md | externalBin 번들 배선은 릴리스 빌드에서만 검증 가능 — 다음 릴리스 준비 시 처리 |
<!-- oculpm:plan-log end -->
