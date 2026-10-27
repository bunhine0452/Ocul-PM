---
oculpm_plan: v1
id: optimize-round-20261024
title: "최적화 라운드 (2026-10-24) — 주변 기능 걷기 · 감시·색인 · 의존성·ACP 보안"
status: active
created: 2026-10-24
updated: 2026-10-24
owner: claude-code
---

PR #90 (main 6e42ea61). 병렬 레인 5개 합류. 아래는 실기기 확인과 이월 항목.

**완료 조건:** 합류는 끝났다. 육안 8건은 확인 날(polish-round-20261027 `{#sweep-optimize}`)에, `carry-*` 는 각각 다음 라운드 플랜으로 옮겨 `[>]`, 사용자 액션(`{#carry-vscode-market}`)이 처리되면 끝. 「보류 유지」 항목은 그 근거가 바뀔 때 다시 보는 것이지 이 플랜을 여는 사유가 아니다.

## 합류 (끝남) {#merged}
- [x] 레인 5개 합류 → 일직선 17커밋 → PR #90 CI 초록 → rebase 머지 6e42ea61 {#lanes-merged}

## 실기기 확인 (이 판 설치 뒤) {#eyes}
- [~] 업데이트 뒤 재시작 — tauri 2.12 open -n 경로로 새 판이 뜨고 트레이·창 복원 · updater 2.14 원자적 교체 {#eyes-restart}
- [ ] macOS 27 트레이 왼쪽 클릭 팝오버 · 오른쪽 클릭 메뉴 → 되면 tray.rs show_context_menu 우회 걷기 판정 {#eyes-tray}
- [ ] 새 창·분리 터미널 직후 키 입력 즉시 · Finder 끌어다 놓기 (wry 0.57) {#eyes-focus-drop}
- [ ] 다이얼로그·메뉴·툴팁·select·scroll-area 모양과 포커스, 아이콘 (React 19.3 · radix 1.8.1 · lucide 1.61) {#eyes-ui-react193}
- [x] 큰 앱 DB 로 기동 — 마이그레이션·vec0 다지기 정상 (SQLite 3.53.2) {#eyes-sqlite353}
- [ ] Claude Code·Codex 화면 첫 실행 — 어댑터 0.93.0·1.13.1 자동 재설치, 세션·모델 셀렉터·권한 카드·압축 카드 토큰 수 {#eyes-acp}
- [ ] 걷은 기능의 빈자리 — 설정 10탭·⌘6~⌘0 재배정 안내·코드 화면 툴바·딥링크 open, 죽은 버튼 없음 {#eyes-removals}
- [ ] 프로젝트 안 worktree 사본이 의미 검색·로컬 히스토리에서 빠짐 · 기동 화해 뒤 DB 크기 감소 {#eyes-worktree-index}

## 이월 (근거 있음) {#carry}
- [ ] notify 8 / debouncer 0.7 — Debouncer::watch 가 FileIdMap 을 루트부터 WalkDir 로 채움, OrderedFileIdCache 시그니처 이식 + perf_baseline 재측정 {#carry-notify8}
- [ ] xterm 6 전환 (6.1 안정판 뒤) — viewportResync 전제 재검토, addon 5종이 이미 6.0 세대와 섞여 있음 {#carry-xterm6}
- [ ] 라이브 풋프린트 Malloc Small 511MB 원인 — MallocStackLogging 으로 재측정 {#carry-malloc-small}
- [ ] 이미 쌓인 worktree 사본 로컬 히스토리 236MB — 디스크에 없는 경로의 판 정리 {#carry-history-purge}
- [ ] 남은 빈 테이블 mobile_devices · graph_nodes · graph_edges · symbol_relations — 다음 마이그레이션 라운드에서 DROP 판단 {#carry-dead-tables}
- [ ] [사용자 액션] VS Marketplace·Open VSX 의 oculpm.ocul-pm 지원 중단/게시 취소 · 저장소 시크릿 OPEN_VSX_TOKEN·VSCE_PAT 삭제 {#carry-vscode-market}

## 다음 후보 (2026-10-24 조사 — 근거 있음, 사용자 결정 대기) {#next}
- [x] 죽은 PTY 세션에 입력하는 페인 — 오늘 옛 호스트 kill 뒤 `PTY 입력 거절 unknown pty session` 31건. write 가 그 오류를 받으면 페인이 「세션 끝남 · 다시 시작」으로 바뀌어야 (bug-opt-round #carry-ptyhost-death-silent 의 실증) {#next-dead-pane}
- [-] 일지 변경 한 번에 화면들이 한꺼번에 다시 불러옴 — `task queue exceeded allotted deadline` 22건(최대 +81ms)이 Stop 훅·일지 fs 이벤트 직후에 몰림. 무효화 합치기(디바운스) {#next-refetch-storm}
- [x] 고아 의존성 — `tokio-stream`(모바일과 함께 들어옴, 이제 미사용) · 직접 의존 `objc2`(코드는 objc2-app-kit/foundation 만 씀) 걷기 {#next-orphan-deps}
- [x] Rust 1.98.0 → 1.99.1 (2026-10-13 안정판) — rust-toolchain.toml 핀, 새 clippy lint 정리 {#next-rust-199}
- [x] Vite 8 + @vitejs/plugin-react 6 + vitest 5 (rolldown) — 빌드 속도. 툴체인 통째 교체라 중간 위험 {#next-vite8}
- [x] agent-client-protocol 2.2 → 3.5 — claude 어댑터 0.94+ 가 ACP SDK 2.0(프로토콜 v2). 지금은 v1 협상으로 0.93 에 머묾, 어댑터가 v1 을 버리기 전에 {#next-acp-v2}
- [>] fastembed 5.17 → 7.5 (+ ort·hf-hub 짝) — 메이저 둘, 변경 내용·메모리 실측부터 {#next-fastembed7}
- [x] Linux E2E 「사이드카 일지 → 일지 화면 60초」 간헐 실패 1회(재실행 통과) — 감시 변경 뒤 처음, 다시 나면 inotify 경로 타이밍 조사 {#next-e2e-linux-flake}
- [ ] 보류 유지(근거): TypeScript 7 — typescript-eslint 8.72 의 peer 가 `<6.1.0` · xterm 6.1 아직 beta · notify 9 rc · specta rc.27 · keyring 4 기존 키 호환 불명 {#next-hold}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-24T19:00:43+09:00 | #lanes-merged | claude-code | ☐→x | .oculpm/journal/20261024/Refactors/1900_refactor_remove-periphery-four-features.md | PR #90 → 6e42ea61 |
| 2026-10-24T22:48:51+09:00 | #next-e2e-linux-flake | claude-code | ☐→x | .oculpm/journal/20261024/Bugs/2248_bug_linux-inotify-new-dir-backfill.md | 간헐이 아니라 inotify 새 폴더 경합 — 컨테이너 재현 70~87%→0, 새 폴더 따라잡기 |
| 2026-10-25T00:18:15+09:00 | #next-dead-pane | claude-code | ☐→x | .oculpm/journal/20261024/Bugs/2300_bug_dead-pane-orphan-deps-rust-199.md | PR #93 |
| 2026-10-25T00:18:26+09:00 | #next-orphan-deps | claude-code | ☐→x | .oculpm/journal/20261024/Bugs/2300_bug_dead-pane-orphan-deps-rust-199.md | PR #93 |
| 2026-10-25T00:18:35+09:00 | #next-rust-199 | claude-code | ☐→x | .oculpm/journal/20261024/Bugs/2300_bug_dead-pane-orphan-deps-rust-199.md | PR #93 — clippy 새 lint 없음 |
| 2026-10-25T00:18:41+09:00 | #next-vite8 | claude-code | ☐→x | .oculpm/journal/20261024/Chores/2325_chore_vite8-rolldown-vitest5.md | PR #94 — 번들 7.38s→1.85s |
| 2026-10-25T00:18:47+09:00 | #next-acp-v2 | claude-code | ☐→x | .oculpm/journal/20261024/Chores/2334_chore_acp-crate-3-5.md | PR #95 — 3.5, v2 는 아직 초안(전제 정정) |
| 2026-10-25T00:18:54+09:00 | #next-fastembed7 | claude-code | ☐→> | .oculpm/journal/20261025/Chores/0018_chore_fastembed-7-deferred-linux-gcc.md | PR #96 닫음 — ort rc.15 가 ubuntu-22.04(GCC 11)에서 링크 실패, 24.04 이전 또는 load-dynamic 결정 필요 |
| 2026-10-25T00:19:01+09:00 | #next-refetch-storm | claude-code | ☐→- | .oculpm/journal/20261024/Bugs/2300_bug_dead-pane-orphan-deps-rust-199.md | 전제 틀림 — 경고는 xterm TaskQueue(터미널 출력), 재조회 아님 |
| 2026-10-27T19:48:27+09:00 | #eyes-sqlite353 | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | 로그 확인: 837MB DB 로 3.13.6~3.14.0 기동, vec0 partition repacked 10-24(1881)·10-27(3612), sqlite/마이그레이션 ERROR 0 (마지막 마이그레이션 41 은 10-14) |
| 2026-10-27T19:49:00+09:00 | #eyes-restart | claude-code | ☐→~ | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | 3.13.4→5→6→7→3.14.0 네 번 updater 로 교체·재기동돼 지금 3.14.0 이 돈다(기계 확인). 남은 것: 재시작 직후 트레이·창 복원은 눈 |
| 2026-10-27T19:49:29+09:00 | #eyes-acp | claude-code | ☐→☐ |  | 사전 조사: app-data/acp 에 깔린 어댑터는 아직 0.81.0 · 1.8.0 (핀 0.93.0 · 1.13.1) — 10-24 이후 로그에 ACP 줄이 없어 화면을 한 번도 안 열었다. 첫 열기 때 재설치가 도는지가 곧 이 항목 |
<!-- oculpm:plan-log end -->
