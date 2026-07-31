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
- [~] A0d 실기기 검증 4건 (ci1 일지 초안·ci3 규칙 탭·ci4 승격 루프·phase-c 게이트/EVALS/Notion — 사용자 확인 포함) {#a0-runtime-verify}
- [x] A1 스키마·경로 정합 — plugin.json hooks/mcpServers 필드 제거(자동발견 위임)+최소 CLI 버전 명시+--plugin-dir 실로드·인벤토리 CI, bin/oculpm-mcp 셔틀(앱 번들→~/.local→target/debug 탐색), 릴리스 CI 버전 스탬프, 플랫폼 스탠스(v1=macOS) {#a1-schema-paths}
- [x] A2 스킬 동봉+활성화 배선 — skills/oculpm-journal(풀 스펙 캐리어, en description)+갤러리 3종 이관(플러그인 SSOT·자기완결 제약)+/oculpm:standup 커맨드+.oculpm/README.md 자동 생성+Stop 훅 stderr 1줄+standup 앱 포인터. 스킬 description 토큰 예산 포함 {#a2-skills-activation}
- [~] A3 마켓플레이스 공개 — 레포 루트 marketplace.json(source ./plugin/oculpm)+앱 설정 택일 UX(훅+MCP — 플러그인 감지 시 register.rs 프로젝트 등록 생략)+훅 계약 문서+버전 스큐 매트릭스+claude-plugins-community 제출·발사 글 {#a3-marketplace}
- [x] A3 선행 — 가격/라이선스 전략 확정: 개인 무료·팀 유료(open-core) 제안 검토 — 현 레포 MIT 전면 공개와의 정합(팀 모듈 분리 vs 라이선스 전환), 외부 기여 받기 전 CLA 여부, 발사 문구("개인 영구 무료") — 사용자 결정 {#pricing-license}
- [~] Notion OAuth 계정 연동(사용자 제안 2026-07-31) — "Notion 계정 연결" 버튼: public integration 등록 + oculpm.com 서버리스 코드 교환(클라 시크릿은 데스크톱에 못 넣음) + 로컬 콜백/딥링크 + 키체인 저장. 기존 internal token 경로는 폴백 유지 {#notion-oauth}

## Phase B — 토큰 다이어트 {#round-b}
- [x] TK0 plan_create MCP 도구 (frontmatter 규격 서버 보장 — §7 슬림화 전제) {#tk0-plan-create}
- [x] TK1 템플릿 v6 — claude-code 어댑터 MCP-first 슬림(~600 tok)/비MCP 어댑터 압축(~1,700 tok) 이원화 + en 변형 동시 설계 + §8 discussion on-demand 분리 + .claude/CLAUDE.md import 1줄화 {#tk1-template-v6}

## Phase C — 플래너를 핸들로 {#round-c}
- [x] 3-depth 플랜 계층(사용자 제안 2026-07-31) — 들여쓰기 중첩 `- [ ]` 서브아이템(최대 3depth 하드캡: phase→item→sub), 상위 글리프=하위 롤업(phase 규칙 재사용), plan_status TSV parent 열 1개, 레일/목록 들여쓰기+접기, 무중첩 기존 plan 완전 호환. 템플릿 §7 반영은 TK1 열차 동승 {#plan-3depth}
- [x] IN2 플래너 디스패치 v1 — 항목 선택→항목 텍스트+관련 일지 2건+해당 rules 프롬프트 조립→기존 터미널로 Claude Code 발화 (자동화·큐잉은 v2). 실행 단위 = 3depth 의 리프 {#in2-dispatch}
- [x] IN0 project-inception 스킬 — STAGE 0~3 산출물을 .oculpm/discussion+planner+EVALS.md 로. 성공 기준 = 기존 파서 3개(discussion 승격·EVALS 표 규약·rule paths)에 무수정 착지 {#in0-inception-skill}
- [x] IN1 GreenfieldWizard 마지막 단계 → IN0 스킬 발화 안내 연결 {#in1-wizard}

## Phase D — 회고 개선 (사용자 피드백 2026-08-01) {#round-d}
- [x] RT1 회고 Claude Code 생성 — `retro_dispatch_prompt`(신호+파일 계약 프롬프트 조립, redact) + `.oculpm/retro/<range_key>.md` 규격(retro_file.rs) + get_retro 파일/DB 병합(newer wins) + 회고 화면 "Claude Code 로" 버튼→터미널 프리필 {#retro-cc-generate}
- [x] RT2 회고 생성 상태 전역화 — 생성 상태를 retroGen 버스(모듈 싱글턴)로 이동: 화면 이탈-복귀에도 "생성 중" 유지(초기화 버그 수정), 경과 초·provider/model 표시, 부재 중 완료 입양+전역 토스트 {#retro-gen-bus}

## Phase E — 사용자 흐름 완결 (사용자 승인 2026-08-01) {#round-e}
- [x] E1 project_init MCP 도구 — 플러그인-온리 그린필드 구멍 해소: A0b 가드의 유일 예외(confirm 강제·선제 호출 금지·심볼릭 링크 거부·추적 중 무변경), 스캐폴드=config·schema-version·gitignore 블록·README·에이전트 어댑터. 계약 문서·도구 5종 표면 스윕·인셉션 스킬 연결 {#mcp-project-init}
- [x] E2 반복 절차→스킬 승격 루프 — ci4 미러: tag 클러스터(≥3, 스톱리스트·기존 스킬 억제) 결정적 후보 + LLM SKILL.md 초안 + 회고 화면 "스킬 후보" 카드(저장은 사람 승인, skills_save 재사용) {#skill-promotion}

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

### Decision 3 — 가격/라이선스 메커니즘 확정 {#d3-pricing-mechanism}
- 잠금 2026-08-01 · claude-code (사용자 "네가 최선의 선택으로 진행해줘" 위임 기록)
- `.oculpm/discussion/pricing-open-core/discussion.md` (resolved) 의 추천안 채택: **코어 영원히 MIT**(README 한/영 명문화) + 팀 기능은 **별도 비공개 repo** + v1 판매는 **호스팅 구독**. CLA 없이 **DCO**(CONTRIBUTING.md). "개인" = 팀 기능 미사용이면 회사 내 사용 포함 무료. 팀 서버는 **E2E 암호화 릴레이 우선** 원칙(평문 저장은 실수요 검증 후 재론). 팀 기능 코드는 본 저장소에 커밋 금지.
- 착수 트리거(팀 수요 신호)는 Decision 2 유지 — 본 결정은 메커니즘 확정이지 착수 명령이 아님.
- 영향: #pricing-license #a3-marketplace(발사 문구 근거 확보)

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
| 2026-07-31T02:33:57+09:00 | #in2-dispatch | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/0233_feature_planner-dispatch-v1.md | 조립기+커맨드+실행버튼→터미널 프리필(Enter는 사용자). rules 미탑재는 의도(네이티브 로드). 실기기는 A0d 동승 |
| 2026-07-31T02:54:33+09:00 | #in0-inception-skill | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/0254_feature_project-inception-skill.md | 플러그인 5종째+갤러리 동기(SSOT=플러그인). 파서 3개 무수정 착지 기준을 본문에 내장. 실사용은 A0d |
| 2026-07-31T02:54:35+09:00 | #in1-wizard | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/0254_feature_greenfield-inception-kickoff.md | 위저드 성공 시 dispatchBus 예약 — 터미널 열면 인셉션 프롬프트 프리필 |
| 2026-07-31T04:01:27+09:00 | #a0-runtime-verify | claude-code | ☐→~ | .oculpm/journal/20260731/Bugs/0401_bug_webgl-addon-dispose-crash-root.md | 실기기 1차에서 터미널 크래시 발견→근본 수정(addon-webgl 0.18 정합+dispose 가드, 관측 3종 동승). 재확인 대기 |
| 2026-07-31T04:10:01+09:00 | #a0-runtime-verify | claude-code | ~→~ |  | 디스패치 E2E 사용자 확인(프리필→Enter→실세션) ✓. 잔여: 템플릿 v7 승인·ci1/ci3/ci4·phase-c·인셉션·3depth 실사용 |
| 2026-07-31T04:15:15+09:00 | #a3-marketplace | claude-code | ☐→~ | .oculpm/journal/20260731/Features_to_add/0415_feature_marketplace-and-exclusivity-ux.md | 코드·문서 표면 완료(marketplace.json·감지·택일 UX·계약/스큐 문서·validate 통과). 잔여 = community 제출·발사 글(사용자) |
| 2026-07-31T04:45:00+09:00 | #notion-oauth | claude-code | →☐ | | 사용자 제안(계정 연동으로 쉽게) 등재 — OAuth 는 서버리스 코드 교환 엔드포인트가 필요(로컬-퍼스트 예외 지점), internal token 은 폴백 유지 |
| 2026-07-31T04:44:34+09:00 | #notion-oauth | claude-code | ☐→~ | .oculpm/journal/20260731/Features_to_add/0444_feature_notion-oauth-account-connect.md | 앱 루프백+서버리스 교환+설정 버튼 구현 완료. 잔여 = Notion public integration 등록·Vercel env·배포(사용자) |
| 2026-07-31T05:03:19+09:00 | #in0-inception-skill | claude-code | x→x | .oculpm/journal/20260731/Features_to_add/0502_feature_inception-interview-web-research.md | v2 업그레이드 — 인터뷰(1차)→웹 리서치(2차) 2단 구체화, 갤러리 패리티 유지 |
| 2026-07-31T05:03:27+09:00 | #a3-marketplace | claude-code | ~→~ | .oculpm/journal/20260731/Chores/0503_chore_landing-v2-5-0-redesign.md | 홍보 표면 갱신 — README 한/영 v2.5.0+설치 안내, 랜딩 리뉴얼(시작하기 2경로). 잔여: 커뮤니티 제출·런치 포스트 |
| 2026-07-31T05:15:54+09:00 | #notion-oauth | claude-code | ~→~ | .oculpm/journal/20260731/Chores/0515_chore_release-v2-5-1.md | v2.5.1 로 출시 — 잔여: Notion 공개 통합 등록 + Vercel env 설정 후 실기기 E2E 확인 |
| 2026-07-31T13:58:14+09:00 | #a3-marketplace | claude-code | ~→~ | .oculpm/journal/20260731/Chores/1358_chore_launch-pricing-notion-round.md | 발사 글 최종본(ko/en)+채널 조사 문서화, 토픽 4종 스왑, awesome-claude-plugins PR #385. 잔여: Anthropic Console 폼·GeekNews/reddit 게시(사용자 직접) |
| 2026-07-31T13:58:22+09:00 | #pricing-license | claude-code | ☐→~ | .oculpm/journal/20260731/Chores/1358_chore_launch-pricing-notion-round.md | 결정 자료 완성(discussion pricing-open-core) — 추천 A+C 조합·DCO. 사용자 결정 질문 3건(경계 고정·개인 정의·팀 서버 데이터 스탠스) 대기 |
| 2026-07-31T13:58:29+09:00 | #notion-oauth | claude-code | ~→~ | .oculpm/journal/20260731/Chores/1358_chore_launch-pricing-notion-round.md | 에러 페이지 안내형 개선·배포 + Developer portal 절차 문서화(docs/notion-oauth-setup.md). 잔여: 사용자의 public connection 생성·Vercel env 2종·재배포 후 E2E |
| 2026-07-31T14:15:07+09:00 | #pricing-license | claude-code | ~→x | .oculpm/journal/20260731/Chores/1415_chore_pricing-decision-execute.md | Decision 3 — A+C 조합·DCO 확정 실행 (README 약속 명문화·CONTRIBUTING·discussion resolved). 팀 착수는 수요 신호 대기 |
| 2026-07-31T14:15:28+09:00 | #notion-oauth | claude-code | ~→~ |  | 사용자 등록·env·재배포 완료 — start 엔드포인트 302(실 client_id) 확인. 잔여: 앱 버튼 1회 클릭 E2E 확인만 |
| 2026-07-31T16:28:39+09:00 | #retro-cc-generate | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/1628_feature_retro-claude-code-generate.md | 디스패치+파일 규격+병합 구현, 적대 리뷰 HIGH(경로 탈출)·MED(redact-signature 파괴) 반영. 실기기 확인은 A0d 동승 |
| 2026-07-31T16:28:47+09:00 | #retro-gen-bus | claude-code | ☐→x | .oculpm/journal/20260731/Bugs/1628_bug_retro-gen-state-survives-nav.md | 전역 버스+경과 표시+부재중 입양. 리뷰 MED(스톨 영구잠금→3분 시효) 등 4건 반영, 자정 경계는 한계 명시 |
| 2026-07-31T16:42:18+09:00 | #in0-inception-skill | claude-code | x→x | .oculpm/journal/20260731/Features_to_add/1642_feature_inception-v3-research-first.md | v3 — 사용자 표준 흐름 반영: 리서치 선행→근거 실린 대화로 사양 확정, 기능 추가=계획→구현 반복 루프 명시 |
| 2026-07-31T17:08:45+09:00 | #mcp-project-init | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/1708_feature_mcp-project-init.md | confirm 3중 게이트+스캐폴드+계약 문서·5종 스윕·인셉션 연결. 리뷰는 스킬 승격과 합산 진행 중 |
| 2026-07-31T17:20:24+09:00 | #skill-promotion | claude-code | ☐→x | .oculpm/journal/20260731/Features_to_add/1707_feature_skill-promotion-loop.md | ci4 미러 구현 + 적대 리뷰 5건 반영(HIGH: 증거가 frontmatter 만 담기던 문제 — 벗기고 1600자, 마커 전수 제거·조건부 펜스·해시 폴백·소문자 클러스터). lib 482 그린 |
| 2026-07-31T17:20:32+09:00 | #mcp-project-init | claude-code | x→x |  | 적대 리뷰 4건 반영 — ensure 수렴(반쪽 초기화 고착 해소, 특히 gitignore 무보호 훅 커밋 경로)·create_dir 원자 선점(TOCTOU)·홈/루트 가드·block_on 함정 주석. mcp 33 그린 |
| 2026-07-31T18:02:21+09:00 | #mcp-project-init | claude-code | x→x | .oculpm/journal/20260731/Features_to_add/1802_feature_project-init-command-and-restart-note.md | 후속: /oculpm:project_init 커맨드(사용자 요청)+MCP 등록 변경 재시작 안내 토스트. 예산 테스트 커맨드 전수 스캔화 |
<!-- oculpm:plan-log end -->
