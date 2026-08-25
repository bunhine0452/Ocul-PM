---
oculpm_plan: v1
id: search-and-terminal-survival
title: "검색 · 터미널 생존 라운드 — 전역 검색/치환 + 업데이트에도 안 끊기는 PTY"
status: active
created: 2026-08-25
updated: 2026-08-25
owner: claude-code
---

사용자 요청 3건에서 출발한 라운드. ① VS Code 식 프로젝트 전역 검색(치환 포함),
② 파일 트리 사이드바 좌/우 전환(→ 이미 v2.18.0 [ide-completion](ide-completion.md)
`#sidebar-side` 로 완료, 여기선 범위 밖), ③ 앱 업데이트/재시작에도 터미널 세션
(Claude Code 등)이 끊기지 않게 — PTY 를 앱 프로세스에서 분리한 호스트 프로세스로
옮기고 Unix 소켓으로 붙는다. 프런트는 기존 attach→miss→start 흐름이라 무변경 재접속.

## Phase 1 — 프로젝트 전역 검색·치환 {#p1-search}
- [x] 백엔드 code_search — ignore 걸음 + regex 줄 단위, UTF-16 좌표, 2,000곳 상한 {#search-backend}
- [x] 백엔드 code_search_replace — 한 매치/파일/전체, EOL 보존, $1 은 정규식 모드만, write_with_lock 경유 {#replace-backend}
- [x] CodeSearchPanel — 사이드바 전환(⇧⌘F)·디바운스·파일 그룹·제외·치환 확인 다이얼로그 {#search-panel}
- [x] 점프 배관 ch/len 확장 — 매치 범위를 CM selection 으로 (Screen→Pane→Editor) {#jump-selection}
- [x] 게이트 — Rust 12종 + vitest 8종 추가, typecheck/test/lint/build 그린 {#search-gates}

## Phase 2 — 터미널 세션 생존 (PTY 호스트) {#p2-pty-host}
- [ ] 프로토콜 + 호스트 코어 — 같은 실행파일 `--pty-host` 모드, Unix 소켓, 세션·스크롤백·nonce 소유 {#pty-host-core}
- [ ] 앱 쪽 클라이언트 — terminal.rs 커맨드를 호스트 호출로, 이벤트 중계(pty-data/exit 재방출) {#pty-client}
- [ ] 호스트 생명주기 — detach 스폰(setsid)·소켓 경쟁/묵은 소켓 정리·유휴 종료·창 닫힘 kill 의미 유지 {#pty-lifecycle}
- [ ] 재접속 검증 — 앱 재시작 후 attach 성공(스크롤백·nonce·seq 연속), 통합 테스트 {#pty-reattach}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | agent | 전이 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-25T11:13:08+09:00 | #search-backend | claude-code | →☐→[x] | 20260825/Features_to_add/1113_feature_project-search-replace.md | code_search 신설 |
| 2026-08-25T11:13:08+09:00 | #replace-backend | claude-code | →☐→[x] | 20260825/Features_to_add/1113_feature_project-search-replace.md | code_search_replace 신설 |
| 2026-08-25T11:13:08+09:00 | #search-panel | claude-code | →☐→[x] | 20260825/Features_to_add/1113_feature_project-search-replace.md | 사이드바 전환 패널 |
| 2026-08-25T11:13:08+09:00 | #jump-selection | claude-code | →☐→[x] | 20260825/Features_to_add/1113_feature_project-search-replace.md | jump ch/len |
| 2026-08-25T11:13:08+09:00 | #search-gates | claude-code | →☐→[x] | 20260825/Features_to_add/1113_feature_project-search-replace.md | 전 게이트 그린 |
<!-- oculpm:plan-log end -->
