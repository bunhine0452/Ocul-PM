---
oculpm_plan: v1
id: plugin-round
title: "Claude 플러그인 라운드 — 슬림 플러그인 + 토큰 다이어트 + 디스패치"
status: active
created: 2026-07-31
updated: 2026-07-31
owner: claude-code
---

`.oculpm/discussion/claude-plugin-strategy/discussion.md` 의 방안 A(2026-07-31 사용자 승인)를
실행하는 라운드. 전략 근거·조사 실측은 그 문서가 SSOT — 이 plan 은 진척만 추적한다.

## Phase 0 — 즉시 체크리스트 {#quick}
- [x] cargo clean — src-tauri/target 빌드 캐시 183.7GiB 회수 {#target-clean}
- [x] 검색 CodeSnippet hljs 풀빌드 → lib/common 통일 (808KB lazy 청크 소멸) {#hljs-common}

## Phase A — 플러그인 v1 "앱 없이도 기록이 시작된다" {#round-a}
- [x] A0a managed-block 버전 인식 — 구버전 앱의 블록 downgrade 차단(특히 gitignore 의 .oculpm/hooks 노출 경로) + 회귀 테스트 {#a0-managed-block}
- [x] A0b MCP 비추적 프로젝트 가드 — journal_write/plan_update 에 .oculpm 존재 검사(무가드 create_dir_all 제거, 미추적 시 명시적 에러) {#a0-mcp-guard}
- [x] A0c 리뷰 잔여 5건 청산 (claude-integration #review-fixes-round2 이관: 미러 충돌 문구·sync_mirrors 비fixpoint·evidence 삼킴·frontmatter 수평선 오인·읽기 상한) {#a0-review-fixes}
- [ ] A0d 실기기 검증 4건 (ci1 일지 초안·ci3 규칙 탭·ci4 승격 루프·phase-c 게이트/EVALS/Notion — 사용자 확인 포함) {#a0-runtime-verify}
- [x] A1 스키마·경로 정합 — plugin.json hooks/mcpServers 필드 제거(자동발견 위임)+최소 CLI 버전 명시+--plugin-dir 실로드·인벤토리 CI, bin/oculpm-mcp 셔틀(앱 번들→~/.local→target/debug 탐색), 릴리스 CI 버전 스탬프, 플랫폼 스탠스(v1=macOS) {#a1-schema-paths}
- [x] A2 스킬 동봉+활성화 배선 — skills/oculpm-journal(풀 스펙 캐리어, en description)+갤러리 3종 이관(플러그인 SSOT·자기완결 제약)+/oculpm:standup 커맨드+.oculpm/README.md 자동 생성+Stop 훅 stderr 1줄+standup 앱 포인터. 스킬 description 토큰 예산 포함 {#a2-skills-activation}
- [ ] A3 마켓플레이스 공개 — 레포 루트 marketplace.json(source ./plugin/oculpm)+앱 설정 택일 UX(훅+MCP — 플러그인 감지 시 register.rs 프로젝트 등록 생략)+훅 계약 문서+버전 스큐 매트릭스+claude-plugins-community 제출·발사 글 {#a3-marketplace}
- [ ] A3 선행 — 가격/라이선스 전략 확정: 개인 무료·팀 유료(open-core) 제안 검토 — 현 레포 MIT 전면 공개와의 정합(팀 모듈 분리 vs 라이선스 전환), 외부 기여 받기 전 CLA 여부, 발사 문구("개인 영구 무료") — 사용자 결정 {#pricing-license}

## Phase B — 토큰 다이어트 {#round-b}
- [x] TK0 plan_create MCP 도구 (frontmatter 규격 서버 보장 — §7 슬림화 전제) {#tk0-plan-create}
- [x] TK1 템플릿 v6 — claude-code 어댑터 MCP-first 슬림(~600 tok)/비MCP 어댑터 압축(~1,700 tok) 이원화 + en 변형 동시 설계 + §8 discussion on-demand 분리 + .claude/CLAUDE.md import 1줄화 {#tk1-template-v6}

## Phase C — 플래너를 핸들로 {#round-c}
- [x] 3-depth 플랜 계층(사용자 제안 2026-07-31) — 들여쓰기 중첩 `- [ ]` 서브아이템(최대 3depth 하드캡: phase→item→sub), 상위 글리프=하위 롤업(phase 규칙 재사용), plan_status TSV parent 열 1개, 레일/목록 들여쓰기+접기, 무중첩 기존 plan 완전 호환. 템플릿 §7 반영은 TK1 열차 동승 {#plan-3depth}
- [ ] IN2 플래너 디스패치 v1 — 항목 선택→항목 텍스트+관련 일지 2건+해당 rules 프롬프트 조립→기존 터미널로 Claude Code 발화 (자동화·큐잉은 v2). 실행 단위 = 3depth 의 리프 {#in2-dispatch}
- [ ] IN0 project-inception 스킬 — STAGE 0~3 산출물을 .oculpm/discussion+planner+EVALS.md 로. 성공 기준 = 기존 파서 3개(discussion 승격·EVALS 표 규약·rule paths)에 무수정 착지 {#in0-inception-skill}
- [ ] IN1 GreenfieldWizard 마지막 단계 → IN0 스킬 발화 안내 연결 {#in1-wizard}

## 결정

### Decision 1 — 방안 A 채택 + 미결 3건 확정 {#d1-plan-a}
- 잠금 2026-07-31 · claude-code (사용자 승인 기록)
- 방안 A(슬림 플러그인+활성화 배선+디스패치 병행) 승인. Desktop .mcpb 는 백로그(재개 조건: 실사용자 요청 2건+). 신규 화면 금지 유지(예외: 기존 화면이 본 라운드의 소비처가 되는 배선).
- 오픈소스·무료 확정 — 회수는 채택(스타·커뮤니티)·포트폴리오. 유료화 없음 전제로 A3 발사 문구 작성.
- 성공 프록시 = GitHub star·릴리스 다운로드 수·이슈 유입, 월 1회 수동 스냅샷(텔레메트리 없음 유지). 팀 읽기 전용 뷰 = 백로그(재론 트리거: 플러그인 배포 후 팀 수요 신호).
- 영향: 전 항목

### Decision 2 — 가격 방향 전환 + 3-depth 확정 {#d2-pricing-3depth}
- 잠금 2026-07-31 · claude-code (사용자 "진행해" 승인 기록)
- 가격: Decision 1 의 "전부 무료" 를 **개인 무료 / 팀 유료** 로 갱신 (사용자 제안 2026-07-31). 메커니즘은 open-core 분리(팀 모듈 비공개) 권고 채택 — 세부(모듈 경계·CLA·결제 인프라)는 {#pricing-license} 작업에서, 착수 트리거는 팀 수요 신호 유지. A3 발사 문구 = "개인 영구 무료(Free forever for individuals), 팀 플랜 준비 중".
- 3-depth 플랜 계층: oculpm-native 형태(들여쓰기 중첩 체크박스·상위=하위 롤업·리프가 디스패치 실행 단위·3depth 하드캡) 확정 — {#plan-3depth} 를 IN2 보다 먼저 착수.
- 영향: #pricing-license #a3-marketplace #plan-3depth #in2-dispatch

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-07-31T00:07:00+09:00 | #d1-plan-a | claude-code | →☐ | .oculpm/journal/20260730/Chores/2354_chore_claude-plugin-strategy-research.md | discussion claude-plugin-strategy 방안 A 사용자 승인 → plan 승격. 전 항목 등재 |
| 2026-07-31T00:07:30+09:00 | #target-clean | claude-code | →x | | cargo clean 실행 — 217,873 파일·183.7GiB 회수 (레포 무변경이라 일지 없음) |
| 2026-07-31T00:08:00+09:00 | #hljs-common | claude-code | →x | .oculpm/journal/20260731/Chores/0005_chore_codesnippet-hljs-lib-common.md | PatchView 와 경로 통일. 게이트 4종 그린, 808KB 청크 소멸(최대 청크 452KB) |
| 2026-07-31T00:36:11+09:00 | #a0-managed-block | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/0035_feature_managed-block-version-guard.md | 다운그레이드 가드(SkippedNewer)+union 병합+드리프트 정합. 신규 테스트 5, 리뷰 MEDIUM 2건 반영 |
| 2026-07-31T00:36:18+09:00 | #a0-mcp-guard | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/0036_feature_mcp-untracked-project-guard.md | call_tool 일괄 가드(실디렉터리+심볼릭 링크 거부, 리뷰 HIGH 반영). 테스트 계약 4곳 갱신 |
| 2026-07-31T00:39:00+09:00 | #plan-3depth | claude-code | →☐ | | 사용자 제안(Jira 식 3depth 설계) 등재 — oculpm-native 형태(중첩 체크박스·롤업·리프 디스패치)로 구체화, 착수 전 형태 확정 필요 |
| 2026-07-31T00:58:07+09:00 | #a0-review-fixes | claude-code | ☐→x | .oculpm/journal/20260731/Bugs/0058_bug_review-fixes-round2-cleared.md | 5건 전부 수정+테스트 5. 리뷰 2차 Warning(HIGH 0) — 후속 4건은 보이스카웃 백로그 |
| 2026-07-31T01:06:13+09:00 | #a1-schema-paths | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/0106_feature_plugin-schema-paths-alignment.md | validate 통과·인벤토리(Hooks3/MCP1/v2.3.1/~0tok) 실측·셔틀 핸드셰이크 확인. 불변식 테스트 4 |
| 2026-07-31T01:28:58+09:00 | #a2-skills-activation | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/0128_feature_plugin-skills-and-activation.md | 스킬4+standup+README자동생성+SessionEnd안내. Always-on ~407tok 실측·예산 테스트 잠금. 동기 vitest 3 |
| 2026-07-31T01:38:33+09:00 | #tk0-plan-create | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/0138_feature_plan-create-mcp-tool.md | 파서 자기검증 내장·id 4규칙·redact. 실바이너리 E2E 통과. instructions 강화 동승 |
| 2026-07-31T01:53:08+09:00 | #tk1-template-v6 | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/0153_feature_template-v6-token-diet.md | 8,031→3,229 chars(−60%). spec 분리·wrapper 탈임포트·en+template_language. 크기 가드 테스트로 회귀 차단. 실기기 업그레이드 확인은 A0d 동승 |
| 2026-07-31T02:20:08+09:00 | #plan-3depth | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/0219_feature_plan-3depth-rollup.md | 롤업·리프 집계·중첩 생성·UI 가드·템플릿 v7. 적대 검증 HIGH3/MED5/LOW3 전부 반영. 접기 UI 는 후속 |
<!-- oculpm:plan-log end -->
