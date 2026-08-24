---
oculpm_plan: v1
id: three-features-round
title: "세 기능 라운드 — 멀티 창 · 모바일(Tailscale) · 영어화"
status: active
created: 2026-08-11
updated: 2026-08-24
owner: claude-code
---

docs/20260811_three-features/ 가 SSOT. 순서는 i18n 뼈대 → 멀티 창 → i18n 본 추출. 범위: 창은 메인=런처 전용 모델, 영어화는 UI+백엔드 에러+LLM 프롬프트(디스크 산출물 제외). **모바일(구 Phase 3)은 2026-08-24 [mobile-bridge](mobile-bridge.md) 로 이관** — 3조건 바인드·페어링 코드·정적 서빙 가드·검증 게이트 결정은 이관처가 흡수했고, 설계 문서 02-mobile-tailscale.md 는 참조로 남긴다.

## Phase 0 — i18n 뼈대 (v2.9.0 동승) {#p0-i18n-skeleton}
- [x] src/i18n/{index,ko,en}.ts + useT() 훅 — en 을 typeof ko 로 제약해 키 누락이 typecheck 에러가 되게 {#i18n-core}
- [x] Settings.language("system"|"ko"|"en") 필드 + SettingsContext 연동 + 설정 모양 탭 UI {#i18n-setting}
- [x] scripts/check-no-hardcoded-korean.mjs + pnpm lint 편입 + 현재 133파일 allowlist 등재 (역방향 게이트) {#i18n-lint}
- [x] 파일럿 번역 — navRegistry.ts (label + alias 이중언어 정책 확정: alias 는 양 언어 합집합 유지) {#i18n-pilot}

## Phase 1 — 멀티 프로젝트 창 (v2.9.0) {#p1-multi-window}
- [x] capabilities/default.json 에 글롭 "project-*" 추가 — 없으면 새 창의 모든 IPC 가 무음 실패 (R2) {#mw-capability}
- [x] 런처 닫기 = 앱 종료 계약 재작성 (tray.rs:498) — 열린 project-* 창이 있으면 숨김만. 마지막 프로젝트 창 닫힘 시 대칭 판정 (R1) {#mw-exit-policy}
  - [x] should_exit_on_launcher_close(open_windows, keep_running) 순수 함수로 분리 + 단위 테스트 {#mw-exit-pure}
- [x] localStorage 키를 aipm:workspace:v2:p<id> 로 분리 + WORKSPACE_SCHEMA_VERSION 3→4 + v1 레코드 1회 이관 (R3) {#mw-storage}
  - [x] allowlist 의 테스트 6개(lite_w6_safety_net·a11y_screens·journal_v2·diff_v2·tools_v2·workday_rollover) 키 갱신 {#mw-storage-tests}
  - [x] currentProjectId/Name/Root 를 영속 대상에서 제외 — 창 URL 이 단일 진실 {#mw-storage-drop}
- [x] main.tsx 3갈래 분기(?tray / ?project=<id> / 무파라미터) + App.tsx 563줄을 LauncherWindow / ProjectWindow 로 분해 {#mw-entry}
- [x] open_project_window / list_open_project_windows 커맨드 + ProjectWindowsChanged 이벤트 + macOS TitleBarStyle::Overlay 적용 {#mw-commands}
- [x] PTY sid 에 창 접두사(p<id>-) 부여 + 창 CloseRequested 에서 해당 창 세션 전량 kill (R4) {#mw-pty}
- [x] 트레이 딥링크 재배선 — TrayNavigate.project_id 로 대상 창 지정 emit (전역 emit 금지) {#mw-tray}
- [x] 죽고 깨진 open_terminal_window 제거 (commands/window.rs:20 · lib.rs:262 · bindings 노출) {#mw-dead-code}
- [x] 런처 '열림' 배지 · 프로젝트 창 사이드바 '런처 열기' · ⌘P/팔레트를 창 포커스 의미로 전환 {#mw-ux}
- [x] 수동 검증 9종 (01-multi-window.md §7) — 특히 런처 닫기로 앱이 안 죽는지, 동일 프로젝트 재클릭이 포커스인지 {#mw-manual}
## Phase 1b — 크롬식 탭 (v2.9.0) {#p1b-chrome-tabs}
- [x] 백엔드 탭 레지스트리 WindowTabs(창→탭 집합) + 전역 유일성 심판 — 라벨 project-<id> → win-<n> {#tab-registry}
- [x] 탭 커맨드 8종 + WindowTabsChanged 이벤트 + capability 글롭 win-* {#tab-commands}
- [x] 창 닫힘 시 그 창의 **모든 탭** PTY/watcher 정리 + 마지막 창 판정 유지 {#tab-cleanup}
- [x] TabbedWindow — 탭마다 WorkspaceProvider, 한 번 연 탭은 언마운트 안 함(미방문은 지연 마운트) {#tab-window}
- [x] TabStrip — 클릭/닫기/드래그 순서 변경/창 밖으로 떼어내기 + macOS 신호등 인셋 + 드래그 리전 {#tab-strip}
- [x] 활성 탭 게이팅 — useGlobalShortcuts(enabled) · NAV_BUS 2종 · 팔레트/설정 {#tab-gating}
- [x] 트레이 딥링크를 **창 단위 1회 배달**로 (탭마다 넘기면 나중 탭도 같은 목적지로 점프) {#tab-deeplink}
- [x] a11y — tablist/tab/tabpanel 연결 · 좌우 화살표 · Delete 닫기 · axe 0 위반 {#tab-a11y}
- [x] 시작 탭 — 프로젝트 메인 화면을 탭으로. + 는 시작 탭, 프로젝트 고르면 그 자리에서 승격. '런처 전용 창' 제거 {#tab-start}
- [x] 창 가로지르는 설정 동기 — SettingsChanged 이벤트. 상단바(트레이 팝오버) 테마 미반영의 진짜 원인 {#tab-settings-sync}
- [x] 상단바 '앱 열기' 가 고른 프로젝트를 열게 {#tab-tray-open}
- [x] UX — ⌘T·⌃Tab·⌘⌥←→ · 빈 스트립 더블클릭 · + 우클릭 지름길 · 탭 오버플로 · 세션 활동 점 {#tab-ux}
- [x] 탭 스트립 CSS 를 styles/tabs.css 로 분리 — index.css 계열은 ShellV2(lazy)만 임포트라 시작 탭 창에서 무스타일이었다 {#tab-css-chunk}
- [x] 시작 화면 대격변 — 벤토 3티어 제거, 프로젝트 전부를 같은 크기 격자로 + 페이지 무스크롤 {#home-grid}
- [x] 빌드 산출물 CSS 가드 — 창 엔트리 청크에 핵심 선택자 8개 (lazy 청크 오배치·편집 미반영 둘 다 잡음) {#home-css-guard}
- [x] 디자인 폴리시 — 액센트 세로줄·글로우 링·배경 광원·채운 배지 제거, 서체 한 벌로 통일(EB Garamond 삭제) {#home-polish}
- [x] 프로젝트 겉모습 — 카드 전체 클릭 · 색 8종 · 아이콘 10종 (id 저장, 테마가 해석. 탭에도 반영) {#project-appearance}
  - [x] 아이콘을 도구형 → 성격 글리프 10종으로 (고양이·유령·로켓…). 이모지 불가 = currentColor 미상속 {#project-icons-cute}
- [x] 트레이 회전 애니메이션 제거(위상 인자까지) · 프로젝트 아이콘을 lucide 검증본으로 · 모션 곡선 재조율 {#tray-static-motion}
- [x] 상단바가 열린 프로젝트만 감지하던 문제 — watcher 를 탭 수명에서 떼어내 전체 프로젝트 백그라운드 감시 {#tray-detect-all}
- [x] 수동 검증 11종 (01b-chrome-tabs.md §7) — 백그라운드 탭 터미널 생존, 떼어내기 후 스크롤백, 테마 전파 {#tab-manual}
- [ ] 2차 — 다른 창 스트립에 드롭해서 합치기 (Rust 화면좌표 히트테스트) {#tab-merge}
- [x] ⌘W 를 탭 닫기로 — 앱 메뉴 직접 구성(Edit 메뉴 포함). ⇧⌘W = 창 닫기, 마지막 탭이면 창도 닫힘 {#tab-cmdw}

## Phase 2 — i18n 본 추출 (v2.10.0) {#p2-i18n-extract}
- [x] 묶음1 설정 — SettingsPanel 184 + OculpmSettings 176 {#i18n-settings}
- [x] 묶음2 스킬·규칙 — skillsGallery/SkillsScreenV2/RulesTab/skillsCatalog/SkillShopTab/pluginDocs/PluginDocsTab (521줄) {#i18n-skills}
- [x] 묶음3 플래너 — PlannerScreenV2/planList/PlanRail (232줄) {#i18n-planner}
- [x] 묶음4 회고·토의 — RetroScreenV2/DiscussionScreenV2/SkillCandidates (203줄) {#i18n-retro}
- [x] 묶음5 터미널 — TerminalInstanceImpl/imeBridge/TerminalScreenV2/oscShell (303줄) {#i18n-terminal}
- [x] 묶음6 온보딩·런처 — StartScreen/GreenfieldWizard/homeModel/tiles/atoms (307줄) {#i18n-onboarding}
- [x] 묶음7 셸·공용 — WorkspaceContext/CommandPalette/App/TrayPopover (268줄) {#i18n-shell}
- [~] 묶음8 나머지 화면 — AI 패널·diff·그래프·Today·일지·검색·문서 (~500줄) {#i18n-rest}
- [x] 묶음9a Rust 사용자 노출 에러 ~130곳 한글→영어 + 프런트 tError() 매핑 (OculpmError 는 이미 영어 — 무변경) {#i18n-rust-errors}
- [x] 묶음9b LLM 프롬프트 12파일 — 출력 언어 지시 파라미터화. 본문은 한국어 유지(드리프트 방지), 단 plan_dispatch_prompt 는 사용자 산출물이라 본문도 번역 {#i18n-rust-prompts}
- [ ] 영어 모드 12화면 순회 — 248px 사이드바/툴바 칩 오버플로 잡기 + a11y 스위트 양 언어 실행 {#i18n-overflow}
- [ ] 완료 게이트 — check-no-hardcoded-korean allowlist 가 빈 배열 {#i18n-gate}

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
| 2026-08-12T05:32:47+09:00 | #i18n-retro | claude-code | ~→x | .oculpm/journal/20260812/Features_to_add/0532_feature_i18n-retro-promotion-cards.md | RuleCandidates·SkillCandidates·retroGen 완료 — 회고·토의 묶음 종료 |
| 2026-08-12T05:37:58+09:00 | #i18n-skills | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/0537_feature_i18n-plugin-tab-disk-content.md | PluginDocsTab 영어화 + pluginDocs/rulesModel/skillsModel 은 DISK_CONTENT 로 분류 |
| 2026-08-12T06:03:47+09:00 | #i18n-rust-errors | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/0603_feature_i18n-rust-errors-terror.md | Rust 114곳 영어화 + tError 역매핑 24개 + 자리표시자 정합성 게이트 |
| 2026-08-12T06:22:40+09:00 | #i18n-onboarding | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/0622_feature_i18n-last-source-files-content-lang.md | StartScreen·GreenfieldWizard·home/* 완료 + contentLanguage 축 배선. 소스 전량 종료 |
| 2026-08-12T20:00:34+09:00 | #mw-capability | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2000_feature_multi-project-windows.md | 글롭 "project-*" — tauri-build 스키마 검증 통과 |
| 2026-08-12T20:00:36+09:00 | #mw-exit-pure | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2000_feature_multi-project-windows.md | 진리표 5줄. 대칭 판정 handle_last_project_window_closed 동승 |
| 2026-08-12T20:00:38+09:00 | #mw-storage-tests | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2000_feature_multi-project-windows.md | 실제로는 10개 마운트 — 키 하드코딩 2개는 storageKeyFor() 로 |
| 2026-08-12T20:00:40+09:00 | #mw-storage-drop | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2000_feature_multi-project-windows.md | setProject→setProjectMeta 로 I3 을 타입 강제. resetWorkspace 제거 |
| 2026-08-12T20:00:42+09:00 | #mw-entry | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2000_feature_multi-project-windows.md | parseWindowRoute 순수 분리. App.tsx 삭제 + src/windows/ 4파일 |
| 2026-08-12T20:00:44+09:00 | #mw-commands | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2000_feature_multi-project-windows.md | focus_launcher_window 추가(사이드바 '런처 열기'용) |
| 2026-08-12T20:00:46+09:00 | #mw-pty | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2000_feature_multi-project-windows.md | 창 0개면 접두사 없는 레거시 sid 까지 회수 |
| 2026-08-12T20:00:48+09:00 | #mw-tray | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2000_feature_multi-project-windows.md | 신규 창은 emit 유실 — 목적지를 URL 로. 기존 창은 emit_to(label) |
| 2026-08-12T20:00:50+09:00 | #mw-dead-code | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2000_feature_multi-project-windows.md | 호출처 0 + 호출하면 깨지던 코드 |
| 2026-08-12T20:00:52+09:00 | #mw-ux | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2000_feature_multi-project-windows.md | useOptionalWorkspace() — 런처의 팔레트·설정이 throw 하던 것 해소 |
| 2026-08-12T20:32:14+09:00 | #tab-registry | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2032_feature_chrome-style-tabs.md | 순수 자료구조로 분리 — Tauri 런타임 없이 16테스트 |
| 2026-08-12T20:32:16+09:00 | #tab-commands | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2032_feature_chrome-style-tabs.md | window:None = 마지막 포커스 창(1차에 '합치기'가 없어서) |
| 2026-08-12T20:32:18+09:00 | #tab-cleanup | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2032_feature_chrome-style-tabs.md | PTY sid 가 프로젝트 기준이라 탭 이동에도 유효 |
| 2026-08-12T20:32:20+09:00 | #tab-window | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2032_feature_chrome-style-tabs.md | 미방문 탭 지연 마운트 — 창 열자마자 N개 init 폭발 방지 |
| 2026-08-12T20:32:22+09:00 | #tab-strip | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2032_feature_chrome-style-tabs.md | 산술은 tabOrder.ts 순수 함수 + 포인터 배선 14테스트 |
| 2026-08-12T20:32:24+09:00 | #tab-gating | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2032_feature_chrome-style-tabs.md | 터미널 refit 은 기존 ResizeObserver 가 이미 처리 |
| 2026-08-12T20:32:26+09:00 | #tab-deeplink | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2032_feature_chrome-style-tabs.md | URL 이 창 수명 내내 남아 나중 탭도 점프하던 함정 |
| 2026-08-12T20:32:28+09:00 | #tab-a11y | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2032_feature_chrome-style-tabs.md | axe 가 2번 걸었다 — 최종은 VS Code 구조(닫기는 aria-hidden + Delete) |
| 2026-08-12T21:01:31+09:00 | #tab-start | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2101_feature_start-tab-and-theme-sync.md | Tab{id, project_id?} 로 모델 교체 — 탭 id 는 프로젝트 id 와 별개 네임스페이스 |
| 2026-08-12T21:01:33+09:00 | #tab-settings-sync | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2101_feature_start-tab-and-theme-sync.md | 원인은 CSS 가 아니라 팝오버 창의 수명(마운트 1회 조회) |
| 2026-08-12T21:01:35+09:00 | #tab-tray-open | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2101_feature_start-tab-and-theme-sync.md | 선택을 무시하고 앱만 앞으로 가져오던 것 |
| 2026-08-12T21:01:37+09:00 | #tab-ux | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2101_feature_start-tab-and-theme-sync.md | 활동 점 = 백그라운드 탭에서 에이전트가 도는 유일한 신호 |
| 2026-08-12T21:28:27+09:00 | #tab-css-chunk | claude-code | ☐→x | .oculpm/journal/20260812/Bugs/2128_bug_tabstrip-css-in-lazy-chunk.md | 번들 경계를 넘는 스타일 의존은 타입·테스트 사각지대 |
| 2026-08-12T21:30:00+09:00 | #home-grid | claude-code | ☐→x | .oculpm/journal/20260812/Refactors/2130_refactor_home-grid-overhaul.md | 크기 위계 → 순위 위계. 커서 평면 예외도 함께 사라짐 |
| 2026-08-12T21:39:43+09:00 | #home-css-guard | claude-code | ☐→x | .oculpm/journal/20260812/Refactors/2130_refactor_home-grid-overhaul.md | 하루에 같은 유형 사고 2번 — 타입·테스트가 못 보는 층 |
| 2026-08-12T21:51:51+09:00 | #home-polish | claude-code | ☐→x | .oculpm/journal/20260812/Refactors/2130_refactor_home-grid-overhaul.md | 액센트는 카드 안에서 '오늘' 한 의미만. 순위는 깊이가 말한다 |
| 2026-08-12T22:03:36+09:00 | #tab-cmdw | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2203_feature_cmd-w-closes-tab.md | 메뉴 직접 구성 시 Edit 서브메뉴 누락 = 웹뷰 ⌘C/⌘V 사망 |
| 2026-08-12T22:24:06+09:00 | #project-appearance | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2224_feature_project-appearance.md | 마이그레이션은 파일만 만들면 안 돌아간다 — MIGRATIONS 등록 필수 |
| 2026-08-12T22:32:06+09:00 | #project-icons-cute | claude-code | ☐→x | .oculpm/journal/20260812/Features_to_add/2224_feature_project-appearance.md | 15px 실루엣 구별이 '귀여움'만큼 중요한 선택 기준 |
| 2026-08-12T22:44:47+09:00 | #tray-static-motion | claude-code | ☐→x | .oculpm/journal/20260812/Refactors/2244_refactor_tray-static-icon-and-motion.md | 검증 수단 없는 영역(픽셀 좌표)은 직접 만들지 말 것 — 두 번 만에 되돌림 |
| 2026-08-12T23:27:26+09:00 | #tray-detect-all | claude-code | ☐→x | .oculpm/journal/20260812/Bugs/2327_bug_tray-detects-open-projects-only.md | 표시 버그가 아니라 제품 약속과 어긋난 지점이었다 |
<!-- oculpm:plan-log end -->
