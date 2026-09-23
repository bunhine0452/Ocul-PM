---
oculpm_plan: v1
id: mac-app-store
title: "Mac App Store 출시 판단 — 샌드박스와 핵심 기능의 충돌 (결정 게이트 먼저)"
status: active
created: 2026-09-23
updated: 2026-09-23
owner: claude-code
---

App Sandbox 가 내장 터미널·ACP·훅/MCP 등록·자체 업데이터와 부딪혀 MAS 판은 별도 제품(Lite)이 된다. 결정 전 구현 금지. SSOT: docs/20260923_cross-platform/03-mas-feasibility.md

## M0 — 결정 게이트 (문서만, cross-platform-port 와 병렬 가능) {#m0}
- [x] 기능별 샌드박스 호환 표 → 03-mas-feasibility.md (초안 있음 — 실측으로 보강) {#m0-feasibility}
- [-] 샌드박스 안에서 /usr/bin/git(xcode-select 셤) 이 도는지 프로브 앱으로 실측 {#m0-git-probe}
- [-] App Review 2.4.5 위험 목록 — 샌드박스·코드 다운로드·종료 뒤 프로세스·자체 업데이트·private API · 최신 원문 대조 {#m0-review-risks}
- [-] 대안 비교: Homebrew cask(전 기능 유지·저비용) vs MAS Lite {#m0-alternatives}
- [x] [사용자 결정] Lite SKU 진행 / 보류(권고) · 번들 id 분리 여부 {#m0-decision}

## M1 — Lite 빌드 (결정=진행일 때만, cross-platform-port W2 합류 뒤) {#m1}
- [-] cargo feature mas — ptyhost·acp·lsp·dap·claude_hooks·shell_integration·register·updater·plugin install·macos-private-api 컴파일 제외 {#m1-feature}
- [-] 프런트 VITE_MAS 플래그 — navRegistry 화면 숨김·설정 탭 정리·복사해서 붙여 넣기 안내 {#m1-ui}
- [-] 프로젝트 폴더 security-scoped bookmark 저장·복원 (재시작 후 감시 재개) {#m1-bookmarks}
- [-] entitlements(app-sandbox·network.client·user-selected.read-write·bookmarks) + tauri.mas.conf.json {#m1-entitlements}
- [-] 샌드박스 컨테이너 경로 이전: app_data_dir·로그·임베딩 캐시 {#m1-container}
- [-] m0-git-probe 결과에 따라 git 대체(gitoxide) 또는 Diff 제외 {#m1-git}

## M2 — 서명 · 제출 {#m2}
- [-] [사용자 액션] App Store Connect 앱 레코드·Apple Distribution/Mac Installer 인증서·프로비저닝 프로필 {#m2-accounts}
- [-] CI mas 잡: productbuild pkg 서명 + entitlements 검증 + 샌드박스 기동 스모크 {#m2-ci}
- [-] 스토어 자산: 스크린샷·설명 ko/en·개인정보 라벨·개인정보처리방침 URL {#m2-listing}
- [-] TestFlight → 심사 제출 → 반려 대응 {#m2-submit}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-23T23:05:40+09:00 | #m0-decision | claude-code | ☐→x |  | 사용자 결정 2026-09-23: Mac App Store 출시 안 함. 나머지 항목 전부 폐기 |
| 2026-09-23T23:05:46+09:00 | #m0-feasibility | claude-code | ☐→x |  | 초안(03-mas-feasibility.md)이 결정 근거가 됨 — 실측 보강 없이 종결 |
| 2026-09-23T23:05:50+09:00 | #m0-git-probe | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
| 2026-09-23T23:05:54+09:00 | #m0-review-risks | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
| 2026-09-23T23:05:59+09:00 | #m0-alternatives | claude-code | ☐→- |  | MAS 출시 안 함 — Homebrew cask 는 필요하면 별도 판단 |
| 2026-09-23T23:06:05+09:00 | #m1-feature | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
| 2026-09-23T23:06:10+09:00 | #m1-ui | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
| 2026-09-23T23:06:14+09:00 | #m1-bookmarks | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
| 2026-09-23T23:06:20+09:00 | #m1-entitlements | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
| 2026-09-23T23:06:25+09:00 | #m1-container | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
| 2026-09-23T23:06:29+09:00 | #m1-git | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
| 2026-09-23T23:06:35+09:00 | #m2-accounts | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
| 2026-09-23T23:06:40+09:00 | #m2-ci | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
| 2026-09-23T23:06:46+09:00 | #m2-listing | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
| 2026-09-23T23:06:51+09:00 | #m2-submit | claude-code | ☐→- |  | MAS 출시 안 함(사용자 결정) |
<!-- oculpm:plan-log end -->
