---
oculpm_plan: v1
id: improvement-round-2026-09-14
title: "개선 라운드 (2026-09-14) — 미출시 최적화 합류 · 조용한 실패 표면화 · 잠긴 플랜 이월 63건 수용"
status: active
created: 2026-09-14
updated: 2026-09-14
owner: claude-code
---

2026-09-14 감사(일지 20260914/Chores/1720)의 17건을 실행하고, 잠긴(done/archived) 플랜 20개에 남아 있던 미완 63건을 살아 있는 항목으로 옮겨 적는다 — AGENTS.md v12 「접힌 plan 의 미완은 유실된다」 규칙의 첫 적용. 출처는 각 항목 끝 (← plan #id).

## Phase 1 — 배포 계보 {#lineage}
- [x] 최적화 라운드 4커밋(d429ef4·af009e5·31d5c75·63bcf72)을 origin/main 위로 cherry-pick 해 합류 — 설치본 RSS 2,229MB 실측이 근거. 스냅샷 HEAD 중복(69%)·파일당 git spawn·gitignore 잔존 행은 이 커밋의 index_project 화해가 함께 푼다 {#merge-optimization}
- [x] feat/audit-round-20260911 의 dirty 76파일(전부 main 에 이미 있는 옛 WIP)을 stash 로 치우고 refs/backup 스냅샷, 로컬 main 을 origin 에 맞춤. 유일한 미반영 일지 2건만 새 브랜치로 {#stale-worktree}
- [x] v3.1.0 릴리스 — 6 버전 파일·CHANGELOG·README ko/en·랜딩 ko/en 12곳·build.mjs, 태그 푸시(CI 빌드), landing vercel --prod {#release-310}

## Phase 2 — 조용한 실패를 화면으로 {#silent-failures}
- [x] 색인 후 개요 생성 실패(기본 nim 모델 z-ai/glm-5.2 EOL 410, 3주간 WARN 로그만)를 LlmBackgroundFailed 이벤트 → 토스트로. 같은 서명은 프로세스 수명 동안 재시도하지 않는 백오프 {#model-eol-toast}
- [x] 설정 모델 입력이 받은 목록에 없는 값을 경고한다 (datalist 는 조용했다) {#model-not-in-list}
- [x] ACP Claude 세션마다 oculpm-mcp 가 2개 뜨던 것(앱 주입 + 플러그인 --root, pid 35587/35592 실측) — 어댑터에 OCULPM_ACP_HOST 표식, 신원 없는 두 번째 인스턴스는 빈 도구 목록으로 휴면 {#mcp-dormant}
- [x] 로그 위생 — Generated 스킵은 DEBUG, 파일 로그의 ANSI 누출(스팬 필드 캐시 공유) 제거 {#log-hygiene}
- [x] 설정의 VS Code 마켓플레이스 링크(404, 미발행) 숨김 — Open VSX 만. 발행되면 marketplace_url 을 Some 으로 {#marketplace-404}

## Phase 3 — 제품 신호 {#product}
- [!] verified_by_user 가 699건 중 8건 — 검토 루프가 안 돈다. 결정 필요: 항목별 토글을 v3 「눈으로 본 것」 원장과 합치거나(추천), 필드를 정리하거나. 사용자 결정 뒤 실행 {#verified-loop}
- [x] 죽은 커맨드 감사 — 334개 중 프런트 미호출 0 (oculpm_update_entry_meta 는 모바일 브리지). 항목 종료 (← ci-and-module-boundaries #dead-command-audit, improvement-audit-round #dead-commands) {#dead-command-close}
- [x] allow(dead_code) 42곳 — 대부분 W1~W4 시절 「곧 소비된다」 주석의 모듈 전체 억제. 걷어 내고 진짜 죽은 코드는 삭제, 남은 것은 항목별 억제로 좁힌다 {#dead-code-allow}
- [ ] 800줄 한계 초과 7파일(window.rs 3,028 · code.rs 2,251 · watcher.rs 2,163 · git.rs 1,580 · CodePane 1,555 · CodeScreenV2 1,471 · TerminalSurface 1,445) — 파일 크기 래칫 예외 6건과 함께 라운드 하나로 분할 (← ci-and-module-boundaries #acp-extract-hooks 와 같은 결) {#big-files}

## Phase 4 — 이월: 잠긴 플랜의 진짜 결함·부채 {#carried-bugs}
- [ ] Today 변경 파일 수가 터치 횟수라 43% 과대(117 vs 82) — 백엔드 COUNT(DISTINCT file_path) 신설 (← today-ring-followup #distinct-file-count) {#distinct-file-count}
- [ ] 라인 링 k=400 이면 매일 상한에 붙는다 — 실데이터로 재측정 뒤 결정 (← today-ring-followup #churn-k-value) {#churn-k-value}
- [ ] Today 라인 증감 표시를 검증하는 테스트가 없다 (← today-ring-followup #lines-display-coverage) {#lines-display-coverage}
- [ ] tests/lsp_rust_analyzer.rs 스킵 가드가 rustup shim 에 속는다 — --version 기동 확인으로 (← ci-and-module-boundaries #ra-guard-hardening) {#ra-guard-hardening}
- [ ] src/api/oculpm.ts 파사드 패턴을 code·terminal·git·llm 으로 확장 (← ci-and-module-boundaries #api-facades) {#api-facades}
- [ ] i18n 마감 — 나머지 화면 묶음8, 영어 모드 12화면 오버플로 순회, check-no-hardcoded-korean allowlist 빈 배열 게이트 (← three-features-round #i18n-rest #i18n-overflow #i18n-gate) {#i18n-finish}
- [ ] A2A 앱 쪽 쓰기 경로(수락·거절·메시지)가 멤버십을 검사한다 (← a2a-session-grouping #enforce-app) {#a2a-enforce-app}
- [ ] ACP 턴 종료 → 일지 초안 + UUID↔session_id 매핑 (← acp-agent-panel #acp5-journal #acp2-sid) {#acp-journal-draft}
- [ ] plan_create 시 유사한 활성 계획이 있으면 재사용을 권한다 (← planner-scale-tidy #dedupe-on-create) {#dedupe-on-create}
- [ ] tauri.conf.json csp: null — 정책 초안은 있고 실기기 확인이 막았다 (wasm 포매터·xterm webgl·CodeMirror·GitHub fetch) (← hardening-and-optimization #csp) {#csp}
- [ ] Monaco 대용량 파일 성능 재측정 → 03-performance.md (← monaco-editor-round #fin-perf, 그 플랜은 활성이라 원본 유지) {#fin-perf-monaco}

## Phase 5 — 이월: 기능 백로그 (착수 순서는 사용자 결정) {#carried-features}
- [ ] 터미널 세션을 창 밖으로 떼어내기 · 다른 창 스트립에 드롭해 합치기 (← drag-and-drop-round #session-to-window, three-features-round #tab-merge) {#session-to-window}
- [ ] Notion OAuth 계정 연동 버튼 — oculpm.com 코드 교환 + 딥링크 + 키체인 (← plugin-round #notion-oauth) {#notion-oauth}
- [ ] 플러그인 마켓플레이스 공개 — 택일 UX·훅 계약 문서·버전 스큐 매트릭스·커뮤니티 제출 (← plugin-round #a3-marketplace) {#plugin-marketplace}
- [ ] DAP — attach·launch.json 격 영속, debugpy·dlv 왕복 검증, 무시된 파일 이름 검색 (← ide-completion #dap-config #dap-more-adapters #tree-filter) {#dap-more}
- [ ] LSP 설정 화면 — 언어별 켜기/끄기·서버 경로·미설치 안내 (← lsp-code-intelligence #lsp-settings) {#lsp-settings}
- [ ] 스킬 카탈로그 2차 B1~B8 — 훅 Windows·일지 스키마 2(실패 원장·ADR)·회고 승격 루프·플래너 승인 게이트·비용 텔레메트리·카탈로그 3차·스킬 출처·잡동사니 (← skill-catalog-round-2 #hooks-xplat #journal-schema-2 #evolve-loop #plan-canvas #cost-telemetry #catalog-3rd #skill-provenance #misc-backlog) {#skill-catalog-b}
- [ ] 모바일 브리지 — 데스크톱 브라우저 스모크·폰 E2E·1주 회고 (← mobile-bridge #mb2-smoke #mb3-verify #mb4-retro) {#mobile-bridge-rest}
- [ ] 저장소 topics·Show HN/awesome 런칭 — 사용자 액션 (← skills-star-round #star-outreach) {#star-outreach}
- [ ] 런타임 스케줄링 계측 (← v3-release #scheduling-telemetry, 활성 플랜이라 원본 유지) {#scheduling-telemetry}

## Phase 6 — 이월: 실기기·육안 확인 원장 (설치본 도는 중 dev 빌드 금지) {#carried-eyes}
- [ ] 설치본 진단 탭 「정리」 → DB 크기·의미 검색 정상, 전체 재색인으로 스냅샷 회수 확인 (← optimization-round-2026-09-12 #eyes-compact, 활성) {#eyes-compact}
- [ ] 이 라운드 육안 — 죽은 모델 토스트가 색인 뒤 한 번만 뜨는지 · 설정 모델 칸 경고 · ACP 세션에서 oculpm-mcp 가 하나만(ps) · 파일 로그에 ANSI 없음 · 3.1.0 유휴 RSS {#eyes-round-0914}
- [ ] 탭·창 드래그 7건 — 창 두 개 스트립 왕복·배율 다른 모니터·세손가락 드래그·고스트·떼어낸 창 닫기·붐비는 스트립·재부착 Escape (← drag-and-drop-round #manual-verify-windows #manual-verify-terminal #crowded-strip-verify #feel-manual-verify #detached-close-verify #p8-manual-verify #p9-manual-verify, tab-reattach-regression #manual-verify-reattach) {#eyes-tabs-windows}
- [ ] 터미널 4건 — 밀도 전환 fit/PTY resize·Claude Code BEL·마커/overview ruler·⌘Q 재실행 뒤 셸 유지 (← terminal-identity-round #p1 #p2 #p3-manual-verify, search-and-terminal-survival #pty-manual-verify) {#eyes-terminal}
- [ ] Claude 연동 실기기 5건 — Claude Desktop 실연결·규칙 탭 CRUD/Cursor .mdc·회고 승격 루프·플러그인 게이트/EVALS/Notion 왕복·Codex 라이브 스모크 (← claude-integration #ci2 #ci3 #ci4 #phase-c-runtime-verify, plugin-round #a0-runtime-verify, codex-acp #protocol-fixture #codex-lifecycle #rust-tests #live-smoke) {#eyes-claude-integration}
- [ ] 첫 실행 마법사 한 바퀴(onboarded 삭제) · 스킬 CRUD/토글 · 리스킨 체감(부트 모션·코드 맵 대형 저장소·프리셋) · Today 리플 언마운트 (← first-run-and-english-landing #wizard-eyes, skills-star-round #skills-verify #reskin-verify, today-ring-followup #ripple-manual-verify) {#eyes-first-run}
- [ ] 영문 표면 — 키노트 /keynote · 플러그인 /plugin 영문판 (en-shots·en-deploy 는 3.0 에서 끝남) (← first-run-and-english-landing #en-keynote-plugin) {#eyes-en-surfaces}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-14T17:56:41+09:00 | #merge-optimization | claude-code | ☐→x | 20260914/Chores/1755_chore_dead-code-allow-purge.md | cherry-pick 4커밋 충돌 0 (c113e21·ba374df·79cabff·1452e41) |
| 2026-09-14T17:56:48+09:00 | #stale-worktree | claude-code | ☐→x | 20260914/Chores/1755_chore_dead-code-allow-purge.md | stash + refs/backup/audit-round-20260911-tip, 새 브랜치 feat/improvement-round-20260914 |
| 2026-09-14T17:56:54+09:00 | #model-eol-toast | claude-code | ☐→x | 20260914/Features_to_add/1755_feature_silent-failures-to-screen.md | LlmBackgroundFailed 이벤트 + useLlmBackgroundToast + FAILED_SIGNATURES 백오프 |
| 2026-09-14T17:57:00+09:00 | #model-not-in-list | claude-code | ☐→x | 20260914/Features_to_add/1755_feature_silent-failures-to-screen.md | ModelInput notInList 경고 + 테스트 |
| 2026-09-14T17:57:06+09:00 | #mcp-dormant | claude-code | ☐→x | 20260914/Features_to_add/1755_feature_silent-failures-to-screen.md | OCULPM_ACP_HOST 표식 + McpServer::dormant, 프로토콜 테스트 |
| 2026-09-14T17:57:13+09:00 | #log-hygiene | claude-code | ☐→x | 20260914/Features_to_add/1755_feature_silent-failures-to-screen.md | Generated→DEBUG, stdout 레이어 with_ansi(false) |
| 2026-09-14T17:57:20+09:00 | #marketplace-404 | claude-code | ☐→x | 20260914/Features_to_add/1755_feature_silent-failures-to-screen.md | marketplace_url Option=None, egress 원장 갱신 |
| 2026-09-14T17:57:27+09:00 | #dead-command-close | claude-code | ☐→x | 20260914/Chores/1755_chore_dead-code-allow-purge.md | 334개 중 미호출 0 — 제거 대상 없음 |
| 2026-09-14T17:57:33+09:00 | #dead-code-allow | claude-code | ☐→x | 20260914/Chores/1755_chore_dead-code-allow-purge.md | 40곳 제거, 죽은 심볼 4 + 테스트 헬퍼 1 정리 (6fc4ddc) |
| 2026-09-14T17:57:40+09:00 | #verified-loop | claude-code | ☐→! |  | 사용자 결정 대기 — 추천: 항목별 토글 대신 육안 원장으로 통합 |
| 2026-09-14T17:57:52+09:00 | #release-310 | claude-code | ☐→~ |  | 게이트 4종 exit 0 확인, 5면 갱신 시작 |
| 2026-09-14T19:30:43+09:00 | #release-310 | claude-code | ~→x |  | PR #23 rebase 머지 b1990ce · release.yml 성공(자산 5) · 랜딩 ko/en 3.1.0 라이브 · latest.json 3.1.0 |
<!-- oculpm:plan-log end -->
