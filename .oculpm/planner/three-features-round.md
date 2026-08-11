---
oculpm_plan: v1
id: three-features-round
title: "세 기능 라운드 — 멀티 창 · 모바일(Tailscale) · 영어화"
status: active
created: 2026-08-11
updated: 2026-08-11
owner: claude-code
---

docs/20260811_three-features/ 가 SSOT. 순서는 i18n 뼈대 → 멀티 창 → i18n 본 추출 → 모바일. 범위: 창은 메인=런처 전용 모델, 모바일은 읽기 전용, 영어화는 UI+백엔드 에러+LLM 프롬프트(디스크 산출물 제외).

## Phase 0 — i18n 뼈대 (v2.9.0 동승) {#p0-i18n-skeleton}
- [x] src/i18n/{index,ko,en}.ts + useT() 훅 — en 을 typeof ko 로 제약해 키 누락이 typecheck 에러가 되게 {#i18n-core}
- [x] Settings.language("system"|"ko"|"en") 필드 + SettingsContext 연동 + 설정 모양 탭 UI {#i18n-setting}
- [x] scripts/check-no-hardcoded-korean.mjs + pnpm lint 편입 + 현재 133파일 allowlist 등재 (역방향 게이트) {#i18n-lint}
- [x] 파일럿 번역 — navRegistry.ts (label + alias 이중언어 정책 확정: alias 는 양 언어 합집합 유지) {#i18n-pilot}

## Phase 1 — 멀티 프로젝트 창 (v2.9.0) {#p1-multi-window}
- [ ] capabilities/default.json 에 글롭 "project-*" 추가 — 없으면 새 창의 모든 IPC 가 무음 실패 (R2) {#mw-capability}
- [ ] 런처 닫기 = 앱 종료 계약 재작성 (tray.rs:498) — 열린 project-* 창이 있으면 숨김만. 마지막 프로젝트 창 닫힘 시 대칭 판정 (R1) {#mw-exit-policy}
  - [ ] should_exit_on_launcher_close(open_windows, keep_running) 순수 함수로 분리 + 단위 테스트 {#mw-exit-pure}
- [ ] localStorage 키를 aipm:workspace:v2:p<id> 로 분리 + WORKSPACE_SCHEMA_VERSION 3→4 + v1 레코드 1회 이관 (R3) {#mw-storage}
  - [ ] allowlist 의 테스트 6개(lite_w6_safety_net·a11y_screens·journal_v2·diff_v2·tools_v2·workday_rollover) 키 갱신 {#mw-storage-tests}
  - [ ] currentProjectId/Name/Root 를 영속 대상에서 제외 — 창 URL 이 단일 진실 {#mw-storage-drop}
- [ ] main.tsx 3갈래 분기(?tray / ?project=<id> / 무파라미터) + App.tsx 563줄을 LauncherWindow / ProjectWindow 로 분해 {#mw-entry}
- [ ] open_project_window / list_open_project_windows 커맨드 + ProjectWindowsChanged 이벤트 + macOS TitleBarStyle::Overlay 적용 {#mw-commands}
- [ ] PTY sid 에 창 접두사(p<id>-) 부여 + 창 CloseRequested 에서 해당 창 세션 전량 kill (R4) {#mw-pty}
- [ ] 트레이 딥링크 재배선 — TrayNavigate.project_id 로 대상 창 지정 emit (전역 emit 금지) {#mw-tray}
- [ ] 죽고 깨진 open_terminal_window 제거 (commands/window.rs:20 · lib.rs:262 · bindings 노출) {#mw-dead-code}
- [ ] 런처 '열림' 배지 · 프로젝트 창 사이드바 '런처 열기' · ⌘P/팔레트를 창 포커스 의미로 전환 {#mw-ux}
- [ ] 수동 검증 9종 (01-multi-window.md §7) — 특히 런처 닫기로 앱이 안 죽는지, 동일 프로젝트 재클릭이 포커스인지 {#mw-manual}

## Phase 2 — i18n 본 추출 (v2.10.0) {#p2-i18n-extract}
- [x] 묶음1 설정 — SettingsPanel 184 + OculpmSettings 176 {#i18n-settings}
- [ ] 묶음2 스킬·규칙 — skillsGallery/SkillsScreenV2/RulesTab/skillsCatalog/SkillShopTab/pluginDocs/PluginDocsTab (521줄) {#i18n-skills}
- [x] 묶음3 플래너 — PlannerScreenV2/planList/PlanRail (232줄) {#i18n-planner}
- [~] 묶음4 회고·토의 — RetroScreenV2/DiscussionScreenV2/SkillCandidates (203줄) {#i18n-retro}
- [x] 묶음5 터미널 — TerminalInstanceImpl/imeBridge/TerminalScreenV2/oscShell (303줄) {#i18n-terminal}
- [ ] 묶음6 온보딩·런처 — StartScreen/GreenfieldWizard/homeModel/tiles/atoms (307줄) {#i18n-onboarding}
- [x] 묶음7 셸·공용 — WorkspaceContext/CommandPalette/App/TrayPopover (268줄) {#i18n-shell}
- [~] 묶음8 나머지 화면 — AI 패널·diff·그래프·Today·일지·검색·문서 (~500줄) {#i18n-rest}
- [ ] 묶음9a Rust 사용자 노출 에러 ~130곳 한글→영어 + 프런트 tError() 매핑 (OculpmError 는 이미 영어 — 무변경) {#i18n-rust-errors}
- [x] 묶음9b LLM 프롬프트 12파일 — 출력 언어 지시 파라미터화. 본문은 한국어 유지(드리프트 방지), 단 plan_dispatch_prompt 는 사용자 산출물이라 본문도 번역 {#i18n-rust-prompts}
- [ ] 영어 모드 12화면 순회 — 248px 사이드바/툴바 칩 오버플로 잡기 + a11y 스위트 양 언어 실행 {#i18n-overflow}
- [ ] 완료 게이트 — check-no-hardcoded-korean allowlist 가 빈 배열 {#i18n-gate}

## Phase 3 — Tailscale 모바일 읽기 전용 (v2.11.0) {#p3-mobile}
- [ ] Tailscale 바인딩 — 대역만 보면 안 됨(100.64/10 은 ISP CGNAT 도 씀). (a)100.64.0.0/10 + (b)/32·broadcast 없음(점대점 터널) + (c)tailscale CLI 교차검증(있을 때만, 불일치면 미기동) 3조건 (R5·R5b) {#mob-bind}
  - [ ] TailscaleBindAddr newtype — private 필드 + 유일 생성자 detect(). serve() 가 SocketAddr 대신 이걸 받아 0.0.0.0/127.0.0.1 폴백이 컴파일 에러가 되게 {#mob-bind-newtype}
  - [ ] 바인딩 후 local_addr() 되읽기 검증 — 불일치면 리스너 폐기·미기동 {#mob-bind-readback}
  - [ ] 심층 방어 — axum 미들웨어에서 요청 출발지 IP 가 100.64.0.0/10 밖이면 거부 {#mob-bind-peer}
  - [ ] 대역 경계 단위 테스트 — 100.64.0.0/100.127.255.255 참, 100.63.255.255/100.128.0.0/10.x/192.168.x/172.16.x 거짓 {#mob-bind-test}
  - [ ] ISP CGNAT 회귀 테스트 — (100.90.1.2, /32, bcast=None) 채택 AND (100.90.1.2, /24, bcast=Some) 거부 {#mob-bind-isp-test}
  - [ ] 후보 0개→None, 후보 여럿→결정적 선택. CLI 부재 시 (a)+(b) 통과, CLI 불일치 시 None {#mob-bind-edge-test}
- [ ] src-tauri/src/mobile/ 모듈 + axum/tower-http/if-addrs 의존성 + MobileServer 관리 상태 + ExitRequested graceful shutdown {#mob-server}
- [ ] 페어링 코드(6자리·TTL 5분·1회용) → 베어러 토큰. 마이그레이션 027_mobile_devices.sql, 토큰은 blake3 해시로만 저장 {#mob-auth}
- [ ] 읽기 전용 API 8종 — 커맨드에서 순수 로직 분리해 axum 핸들러와 공유. 반드시 OculpmManager/JournalCache 경유 (디스크 직독 금지 — R6) {#mob-api}
- [ ] mobile.html 별도 Vite 엔트리 + src/mobile/ 화면 (Tauri 의존 0). 토큰 CSS 만 재사용, 레이아웃은 모바일 전용 {#mob-bundle}
- [ ] resource_dir 기반 ServeDir 정적 서빙 + 경로 탈출 차단 (commands/docs.rs 의 secure_docs_join 패턴 참고) + dev 폴백 {#mob-assets}
- [ ] 설정 '모바일' 탭 — 토글·상태·주소 복사·포트·QR·페어링 코드·연결 기기 목록/해제 {#mob-settings}
- [ ] 검증 게이트 — 폰(tailnet)에서 접속 성공 AND 같은 LAN 비-tailnet 기기에서 접속 실패 확인 (R5) {#mob-verify}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-11T21:44:12+09:00 | #i18n-core | claude-code | ☐→x | journal/20260811/Features_to_add/2144_feature_i18n-phase0-skeleton.md | 모듈 스토어 + flat 키 + en 타입제약 |
| 2026-08-11T21:44:14+09:00 | #i18n-setting | claude-code | ☐→x | journal/20260811/Features_to_add/2144_feature_i18n-phase0-skeleton.md | SQLite 경유 — 창 격리와 무관 |
| 2026-08-11T21:44:22+09:00 | #i18n-lint | claude-code | ☐→x | journal/20260811/Features_to_add/2144_feature_i18n-phase0-skeleton.md | 역방향 allowlist 130개 시딩 (스캐너 판정 기준 — rg 169개와 다름) |
| 2026-08-11T21:44:24+09:00 | #i18n-pilot | claude-code | ☐→x | journal/20260811/Features_to_add/2144_feature_i18n-phase0-skeleton.md | alias 정책 확정 — tAll() 로 양 언어 색인 (합집합 문자열 아님). 129 남음 |
| 2026-08-11T22:35:15+09:00 | #i18n-shell | claude-code | ☐→x | journal/20260811/Features_to_add/2235_feature_i18n-phase2-wave-a-c.md | 셸·공용 10파일 (팔레트 group 을 id 로 분리) |
| 2026-08-11T22:35:17+09:00 | #i18n-settings | claude-code | ☐→~ | journal/20260811/Features_to_add/2235_feature_i18n-phase2-wave-a-c.md | SettingsPanel 154건 완료 · OculpmSettings 146건 남음 |
| 2026-08-11T23:02:22+09:00 | #i18n-rust-prompts | claude-code | ☐→x | journal/20260811/Features_to_add/2302_feature_content-lang-full-wiring-and-journal-i18n.md | 9곳 전부. content_language 를 UI 언어와 분리(되돌릴 수 없는 산출물) |
| 2026-08-11T23:40:10+09:00 | #i18n-settings | claude-code | ~→x | journal/20260811/Features_to_add/2340_feature_i18n-oculpm-settings.md | SettingsPanel 154 + OculpmSettings 146 — 설정 화면 전체 완료 |
| 2026-08-11T23:40:12+09:00 | #i18n-planner | claude-code | ☐→x | journal/20260811/Features_to_add/2322_feature_planner-i18n-and-collapsed-sidebar-gutter.md | PlannerScreenV2·PlanRail·planList. NO_PHASE 를 sentinel 키로 분리 |
| 2026-08-12T03:07:17+09:00 | #i18n-retro | claude-code | ☐→~ | journal/20260812/Features_to_add/0307_feature_i18n-retro-screen.md | RetroScreenV2·DiscussionScreenV2·DeferLedger·EvalTrend 완료 / RuleCandidates·SkillCandidates·retroGen 남음 |
| 2026-08-12T05:11:46+09:00 | #i18n-terminal | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/0511_feature_i18n-terminal-screen.md | 터미널 10파일 + 스캐너 정규식 오독 수정. allowlist 75→66 |
| 2026-08-12T05:24:03+09:00 | #i18n-rest | claude-code | ☐→~ | .oculpm/journal/20260812/Features_to_add/0523_feature_i18n-ai-panel-screen.md | AI 패널 4파일 완료 — 12개 화면 전부 끝. 남은 62개는 테스트·비화면 모듈 |
<!-- oculpm:plan-log end -->
