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

## 합류 (끝남) {#merged}
- [x] 레인 5개 합류 → 일직선 17커밋 → PR #90 CI 초록 → rebase 머지 6e42ea61 {#lanes-merged}

## 실기기 확인 (이 판 설치 뒤) {#eyes}
- [ ] 업데이트 뒤 재시작 — tauri 2.12 open -n 경로로 새 판이 뜨고 트레이·창 복원 · updater 2.14 원자적 교체 {#eyes-restart}
- [ ] macOS 27 트레이 왼쪽 클릭 팝오버 · 오른쪽 클릭 메뉴 → 되면 tray.rs show_context_menu 우회 걷기 판정 {#eyes-tray}
- [ ] 새 창·분리 터미널 직후 키 입력 즉시 · Finder 끌어다 놓기 (wry 0.57) {#eyes-focus-drop}
- [ ] 다이얼로그·메뉴·툴팁·select·scroll-area 모양과 포커스, 아이콘 (React 19.3 · radix 1.8.1 · lucide 1.61) {#eyes-ui-react193}
- [ ] 큰 앱 DB 로 기동 — 마이그레이션·vec0 다지기 정상 (SQLite 3.53.2) {#eyes-sqlite353}
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

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-24T19:00:43+09:00 | #lanes-merged | claude-code | ☐→x | .oculpm/journal/20261024/Refactors/1900_refactor_remove-periphery-four-features.md | PR #90 → 6e42ea61 |
<!-- oculpm:plan-log end -->
