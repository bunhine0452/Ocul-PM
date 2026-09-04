---
oculpm_plan: v1
id: claude-integration
title: "Claude 직접 연동 + 규칙 플라이휠 라운드"
status: archived
created: 2026-07-20
updated: 2026-09-04
owner: claude-code
---

바이브코딩 보고서(docs/vibe coding/)의 방법론을 제품화하는 라운드. SSOT 는
docs/claude-integration/00-master-plan.md — 결정(D1~D6)·수용 기준은 그 문서가 정답이고,
이 plan 은 진척만 추적한다.

## Phase 0 — 설계 {#design}
- [x] 보고서 분석 + Claude 연동 표면 조사 + 마스터플랜(D1~D6, PR-CI0~8) 작성 {#design-master-plan}

## Phase A — 기록의 결정론화 {#phase-a}
- [x] PR-CI0 훅 브리지 — payload 실측 스파이크, settings.local.json 설치/드리프트, .oculpm/hooks 인박스+watcher 라우팅, SessionActor 정밀 신호 {#ci0-hook-bridge}
- [x] PR-CI0 실기기 확인 — 실앱에서 훅 켜기→실세션 1회: 인박스 3건·앱 소비·세션 1개(agent_label=claude-code, ended=agent_exit)·사용자 permissions 보존 확인 {#ci0-runtime-verify}
- [x] PR-CI1 transcript 일지 초안 — 방어적 파싱, 옵인 LLM 초안→redact→규격 일지, 자필 일지 중복 스킵 {#ci1-transcript-draft}
- [x] PR-CI1 실기기 확인 — auto_journal_draft 켠 실세션 종료 → 초안 일지 생성(자필 일지 있으면 미생성) 확인 {#ci1-runtime-verify}
- [x] PR-CI2 oculpm-mcp v1 — journal_write/plan_status/plan_update stdio 서버, .mcp.json+Desktop 스니펫 등록, 템플릿 v5 {#ci2-mcp-server}
- [~] PR-CI2 실기기 확인 — 앱 UI 등록→실세션 plan_status 호출 성공(라이브 플랜 응답). Claude Desktop 실연결만 잔여 {#ci2-runtime-verify}
- [x] PR-CI2 후속 — .app 번들에 oculpm-mcp sidecar(externalBin) 동봉, 릴리스 빌드에서 검증 {#ci2-sidecar-bundle}

## Phase B — 규칙 플라이휠 {#phase-b}
- [x] PR-CI3 규칙 허브 — 스킬 화면 탭 확장(규칙/훅), CLAUDE.md·.claude/rules CRUD+paths 편집(실측: globs 아님), Cursor 병행 배포 {#ci3-rules-hub}
- [ ] PR-CI3 실기기 확인 — 앱에서 규칙 탭 CRUD·paths 칩·Cursor 배포 토글(.mdc 실생성/충돌 보호)·허브 탭 회귀 실사용 확인 {#ci3-runtime-verify}
- [x] PR-CI4 실패→규칙 승격 루프 — 회고·일지 신호→규칙 초안 제안(paths 추론)→승인 저장 {#ci4-rule-promotion}
- [ ] PR-CI4 실기기 확인 — 실데이터 회고에서 후보 노출→LLM 초안 실호출→승인 저장(.claude/rules 실생성·재등장 억제) 확인 {#ci4-runtime-verify}
- [x] PR-CI5 추천 스킬 갤러리 — self-audit·run-evals·tdd-workflow 원클릭 설치 {#ci5-skill-gallery}

## Phase C — 검증·아웃바운드 {#phase-c}
- [x] PR-CI6 EDD-lite — 플래너 완료 소프트 게이트 + 회고 eval 신호 {#ci6-edd-lite}
- [x] PR-CI7 Notion 내보내기 v1 — internal token 키체인 + REST 페이지 생성, 회고/주간 요약 {#ci7-notion-export}
- [x] PR-CI8 oculpm 플러그인 패키징 — 훅+MCP 번들 배포 골격 {#ci8-plugin-packaging}
- [~] Phase C 실기기 확인 — 플러그인 `--plugin-dir` 실로드 통과(도구 3종 노출·훅 3건·비추적 프로젝트 무동작). 완료 게이트·EVALS.md 추이·Notion 실계정 왕복만 잔여 {#phase-c-runtime-verify}

## Phase D — 리뷰 후속 {#phase-d}
- [x] 적대적 코드 리뷰(PR-CI3~8) + HIGH/MED 5건 수정 — 관리블록 파괴·Notion redact·억제 양방향·URL 프래그먼트·훅 EPIPE {#review-fixes-round1}
- [x] 리뷰 잔여 5건 — Cursor 미러 충돌 안내 문구 오류·sync_mirrors 비fixpoint(rename 1패스 유실)·gather_evidence 누락 삼킴·split_frontmatter 수평선 오인·읽기 크기 상한 부재 {#review-fixes-round2}
- [x] 관리블록 버전 인식 — 구버전 앱이 gitignore 블록을 downgrade 해 민감 경로가 노출될 수 있음(union 병합 또는 버전 가드) {#managed-block-versioning}

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
| 2026-07-20T14:58:06+09:00 | #ci2-mcp-server | claude-code | x→x | journal/20260720/Bugs/1458_bug_tauri-dev-default-run.md | 실기기 확인 중 발견된 회귀 fix — [[bin]] 추가로 cargo run 모호 → default-run="ocul-pm" 고정 |
| 2026-07-20T16:07:05+09:00 | #ci0-runtime-verify | claude-code | ☐→x | journal/20260720/Chores/1607_chore_phase-a-runtime-verify.md | 실앱 검증 통과: 훅 3건→앱 소비→세션 20260720-008(agent_label_guess=claude-code, ended_reason=agent_exit, 중복 0). 기존 permissions 100여 항목 보존 확인. 부수 fix 3건(default-run·optimizeDeps·멱등 config+vite ignore)로 dev 마찰 해소 |
| 2026-07-20T16:07:05+09:00 | #ci2-runtime-verify | claude-code | ☐→~ | journal/20260720/Chores/1607_chore_phase-a-runtime-verify.md | 앱 UI 등록 .mcp.json 으로 실세션 plan_status 호출→라이브 플랜 응답 확인. .mcp.json 은 경로 머신종속이라 이 레포에서 gitignore 결정. Desktop 실연결만 잔여 |
| 2026-07-20T17:34:15+09:00 | #ci3-rules-hub | claude-code | ☐→x | .oculpm/journal/20260720/Features_to_add/1734_feature_rules-hub-tabs-and-cursor-mirror.md | 실측 교정(globs 아님—paths 스키마, 03 스펙 문서) + 허브 3탭(스킬/규칙/훅) + rules.rs CRUD·Cursor 미러(마커 소유·conflict 보호·멱등 sync) + rules_translate 옵인. cargo 364·vitest 154·게이트 그린. 실앱 확인은 신규 #ci3-runtime-verify |
| 2026-07-20T17:47:05+09:00 | #ci4-rule-promotion | claude-code | ☐→x | .oculpm/journal/20260720/Features_to_add/1746_feature_rule-promotion-loop.md | area 클러스터링(≥2, paths·promoted-from 이중 억제)+redact 증거→LLM JSON 초안→회고 "규칙 후보" 승인 카드→rules_save 재사용. 자동 적용 경로 부재를 코드 구조+테스트로 고정. cargo 373·vitest 160 그린. 실사용 확인은 신규 #ci4-runtime-verify |
| 2026-07-20T17:56:38+09:00 | #ci5-skill-gallery | claude-code | ☐→x | .oculpm/journal/20260720/Features_to_add/1756_feature_skill-gallery-one-click.md | 순수 데이터 갤러리(백엔드 무변경)+skills_save 재사용+이중 중복가드. run-evals 템플릿이 EVALS.md ## 기록 표 규약 정의(CI6 이 파싱). vitest 163 그린 |
| 2026-07-20T18:04:14+09:00 | #ci6-edd-lite | claude-code | ☐→x | .oculpm/journal/20260720/Features_to_add/1804_feature_edd-lite-gate-and-eval-trend.md | journal_refs 기반 소프트 게이트(백엔드 무변경)+evals.rs 기록표 파서(CI5 규약 한 쌍, 부풀림 거부)+회고 추이 카드. cargo 377·vitest 168 그린 |
| 2026-07-20T18:25:24+09:00 | #ci7-notion-export | claude-code | ☐→x | .oculpm/journal/20260720/Features_to_add/1825_feature_notion-export-v1.md | notion.rs md→블록(제한 방어·정규화)+커맨드 4종, 토큰은 기존 secret_set 키체인 재사용(검증 후에만 저장), 설정 데이터탭 섹션+회고/산출물 버튼(토큰 없으면 비노출). cargo 382·vitest 173 그린. 실계정 왕복은 Phase C 실기기 확인으로 |
| 2026-07-20T18:29:05+09:00 | #ci8-plugin-packaging | claude-code | ☐→x | .oculpm/journal/20260720/Features_to_add/1828_feature_oculpm-plugin-skeleton.md | 스펙 실측(04 문서)+plugin/oculpm 골격. 훅 .oculpm 가드(비추적 무해 — 샌드박스 실검증)+MCP --root ${CLAUDE_PROJECT_DIR}(머신 종속 해소, 유저 스코프 1개로 전 프로젝트). 실로드 검증은 sidecar 번들 선행 → #phase-c-runtime-verify |
| 2026-07-20T18:48:59+09:00 | #ci8-plugin-packaging | claude-code | x→x | journal/20260720/Bugs/1848_bug_gitignore-anchor-and-block-drift.md | 교차 세션 검토: 플러그인 --plugin-dir 실로드 통과(도구 3종·훅 3건·가드). gitignore 앵커 누락으로 번들 .mcp.json 이 커밋 안 되던 것 + 관리블록에서 .oculpm/hooks 유실(대화내용 노출 위험) fix |
| 2026-07-20T19:01:00+09:00 | #review-fixes-round1 | claude-code | →x | journal/20260720/Bugs/1901_bug_rules-managed-block-and-review-fixes.md | 적대 리뷰 5건 수정: HIGH 규칙허브가 앱 관리블록 파괴(guard_managed_block)·Notion redact 심층방어(project_id)·억제 양방향(넓은 glob)·URL 프래그먼트·훅 EPIPE + 실패불가 테스트 실질화. cargo 384·vitest 176 그린 |
| 2026-07-20T19:01:00+09:00 | #review-fixes-round2 | claude-code | →☐ | journal/20260720/Bugs/1901_bug_rules-managed-block-and-review-fixes.md | 리뷰 잔여 5건(미러 충돌 문구·sync_mirrors 비fixpoint·evidence 삼킴·frontmatter 수평선 오인·읽기 상한) — 데이터 손실 없음, 다음 라운드 |
| 2026-07-20T19:01:00+09:00 | #managed-block-versioning | claude-code | →☐ | journal/20260720/Bugs/1848_bug_gitignore-anchor-and-block-drift.md | 구버전 앱이 관리블록을 downgrade 하는 구조적 위험 — gitignore 의 경우 민감경로 노출로 이어짐 |
| 2026-07-20T18:53:18+09:00 | #design-master-plan | claude-code | x→x | journal/20260720/Refactors/1853_refactor_oculpm-settings-subtabs.md | 설정 ocul-pm 탭 5분할(기록·에이전트·자동화·연동·로그) — PR-CI0~8 누적으로 한 화면 스크롤 과부하. 과금 토글 2개를 '자동화'에 집약 |
| 2026-07-20T20:07:43+09:00 | #ci2-mcp-server | claude-code | x→x | .oculpm/journal/20260720/Features_to_add/2007_feature_claude-desktop-one-click-register.md | D3 잔여분 Desktop 원클릭 등록 구현 — claude_desktop_config.json 직접 머지(프로젝트별 키·멱등·비파괴), 커맨드 3종+UI 행. 실연결 확인은 #ci2-runtime-verify 그대로 |
| 2026-07-20T20:26:51+09:00 | #ci2-mcp-server | claude-code | x→x | .oculpm/journal/20260720/Features_to_add/2026_feature_mcp-hardening-and-desktop-key-collision.md | 보안 하드닝 2건(plan_update redact·stdin 10MiB 상한) + Desktop 동명 폴더 키 충돌 fix(루트 기준 판정·해시 접미) |
| 2026-07-20T21:24:32+09:00 | #ci2-sidecar-bundle | claude-code | ☐→x | .oculpm/journal/20260720/Chores/2124_chore_release-v2-2-0-sidecar-and-promo.md | externalBin+build-sidecar.mjs+build.rs 플레이스홀더(순환 해소). CI 동일조건 로컬 번들에서 .app 동봉·--version 실검증. v2.2.0 태그로 릴리스 가동 |
| 2026-07-31T00:58:14+09:00 | #review-fixes-round2 | claude-code | ☐→x | .oculpm/journal/20260731/Bugs/0058_bug_review-fixes-round2-cleared.md | plugin-round A0c 로 이관 청산 — 5건 전부 수정, 상세는 그 플랜/일지 참조 |
| 2026-07-31T00:58:23+09:00 | #managed-block-versioning | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/0035_feature_managed-block-version-guard.md | plugin-round A0a 로 해결 — 다운그레이드 가드+union 병합 (구버전 downgrade 차단은 forward-only) |
| 2026-07-30T19:51:04.222929+00:00 | #ci1-runtime-verify | user | ☐→~ |  |  |
| 2026-07-30T19:51:06.007905+00:00 | #ci1-runtime-verify | user | ~→x |  |  |
<!-- oculpm:plan-log end -->
