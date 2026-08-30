---
oculpm_plan: v1
id: improvement-audit-round
title: "개선점 감사 라운드 — 색인 폭증 · 죽은 표면 · 프로세스 생존"
status: active
created: 2026-08-30
updated: 2026-08-30
owner: claude-code
---

2026-08-30 전영역 감사(6 에이전트 + 라이브 DB 실측)에서 코드로 확정한 결함을 체감 큰 순으로 닫는다.
게이트는 전부 초록이었으므로 이 플랜은 "깨진 것"이 아니라 **"돌아가지만 잘못돼 있는 것"** 을 다룬다.
근거 요약은 각 항목 옆 괄호. 병렬 세션이 `drag-and-drop-round`(창·탭 드래그) 를 진행 중이라 `commands/window.rs` 는 이 라운드에서 건드리지 않는다.

## Phase 1 — 색인·검색·DB (사용자 체감 최대) {#index-db}
- [x] 인덱서가 `.git` 없는 프로젝트의 `.gitignore` 를 무시 — `require_git(false)` + 벤더 디렉터리 21종 기본 deny (`indexer.rs walk_text_files`, 라이브 DB 에서 project02 node_modules 21K 청크) {#indexer-gitignore}
- [x] AST 청커가 한 줄에 심볼 N개면 그 줄을 N번 복제 — minified 스킵(줄 4KB 상한) · 청크 16KB 캡 · 동일 범위 중복 제거 · 031 정리 마이그레이션 (`chunk_file`, libktx.js 1개 → 503청크 104MB) {#chunker-dedupe}
- [x] FTS5 025 마이그레이션이 등록된 적 없음 — 실측 뒤 **폐기**(결정 2) + 레지스트리 가드(번호 단조증가·디스크 전수 등록·파일명 번호 일치) (`db/mod.rs:35`, 라이브 DB `chunk_fts` 부재, 검색은 LIKE 폴백) {#fts-register}
- [x] DB 용량 보고(파일·WAL·빈 공간·큰 표) + 압축(VACUUM) + 재구축=비우고 처음부터 + `journal_size_limit` (`clear_project_index` 프런트 호출 0, 앱 DB 558MB+WAL 80MB) {#db-size-ui}

## Phase 2 — 프로세스 생존·보안 {#lifecycle}
- [ ] PTY 호스트 Kill 이 kill 이 아님 — 자식 보관 → SIGHUP → 유예 → SIGKILL → wait, reader 는 세션 제거 플래그로 종료 (`ptyhost/host.rs` `_child` 즉시 drop, Kill 은 맵 remove 뿐) {#pty-kill}
- [ ] ACP 어댑터가 앱 종료·탭 닫기에서 정리 안 됨 — `ExitRequested` 에 stop_all (`lib.rs`, `acpStop` 프런트 호출 0) {#acp-exit-cleanup}
- [ ] 일지 `relative_path` 경로 탈출 — `resolve_entry_path` 로 절대경로·`..` 거부 + `starts_with` 강제, 5곳 경유 (`manager/journal.rs`, 모바일 dispatch 가 노출) {#journal-path-guard}
- [ ] diff 백필이 빈 결과를 안 써 열 때마다 git 재실행 — 빈 마커 기록 + 워처 시작 뒤 백그라운드 (`entry_diffs.rs persist`, `oculpm_init` await) {#backfill-marker}
- [ ] 자동 화해 LLM 오류 무음 — warn + 결과 error + 토스트 (`reconcile.rs` `Err(_) => continue`) {#reconcile-error}
- [ ] 플래너 목록 로드 실패 시 스켈레톤 무한 + 사용량 미터 숨김 폴링 (`PlannerScreenV2 refreshPlans` else 없음, `AcpUsageMeter` 8초) {#planner-load-error}
- [>] macOS 혼합 DPI 커서 좌표계 불일치 — 병렬 세션(drag-and-drop-round)의 `window.rs` 작업과 겹쳐 그 라운드로 이월 {#mixed-dpi}

## Phase 3 — 발동 원장(AD-1/2) 리뷰 수정 {#firing-fixes}
- [ ] 항상-로드 규칙·CLAUDE.md 를 "한 번도 안 걸림"으로 거짓 표시 — `paths.length===0` 은 "매 세션" 고정 라벨 (`RulesTab.tsx`, nested_memory 는 조건부 규칙만 찍힘) {#fl-always-loaded}
- [ ] 가산 UPSERT + 직렬화 없음 + rebuild 없음 → 이중 집계 영구 — 프로젝트별 Mutex · 재개점 CAS · 파일 축소 시 행 삭제 · `firing_rebuild` (`db/firings.rs`, `commands/firing_ledger.rs`) {#fl-cas-rebuild}

## Phase 4 — 검토 루프 UI · 죽은 표면 {#review-loop}
- [ ] `related` 링크 칩 + `verified_by_user` 토글 — EntryDetailView 헤더/카드 (`setJournalVerified` 래퍼만 존재, `related` 렌더 0) {#related-verified-ui}
- [ ] `journal_committed` 죽은 설정 토글 제거 (`OculpmSettings.tsx`, git commit 호출 0) {#dead-toggle}
- [ ] 프런트 미호출 커맨드 18개 정리 — `dapAdapters` 는 디버그 패널 빈 상태에 연결, 나머지는 `collect_commands!` 에서 제거 {#dead-commands}
- [ ] MCP `journal_write` 에 `related`·`session_id` 인자 + `language` 를 config 에서 + 마스킹 발생을 응답으로 알림 (`mcp/tools.rs`, AGENTS.md 가 related 를 요구) {#mcp-journal-write-args}

## Phase 5 — CI·DX {#ci-dx}
- [ ] `cargo fmt` 1회 정리 + `fmt --check` 게이트 (현재 1,090 hunk) {#fmt-gate}
- [ ] clippy 게이트(-W 로 시작) + 잡 timeout {#clippy-gate}
- [ ] 로그 브리지 메시지 절단 + `redact` 통과, LLM 에러 바디 512B (`commands/oculpm.rs oculpm_log`, `llm/*.rs`) {#log-bridge-cap}

## 결정

### Decision 1 — 색인 오염은 코드 수정만으로 안 사라진다 {#d1-clear-index}
잠금 2026-08-30 · claude-code. 색인은 blake3 해시 게이트라 한 번 들어간 파일은 규칙을 고쳐도 재평가되지 않는다.
따라서 #indexer-gitignore · #chunker-dedupe 는 반드시 #db-size-ui 의 "색인 비우기"(기존 `clear_project_index`) 와 함께 나가야 사용자가 오염된 색인을 실제로 되돌릴 수 있다.
영향: #indexer-gitignore #chunker-dedupe #db-size-ui

### Decision 2 — trigram FTS5(v2 U11) 는 등록하지 않고 폐기한다 {#d2-retire-fts}
잠금 2026-08-30 · claude-code. 라이브 DB 사본 실측: trigram 적재 14.7초 · 색인 376MB(본문의 2.1배) vs LIKE 132ms(오염된 178MB 위에서). 색인 소음을 걷어내면 프로젝트당 수십 MB — LIKE 수십 ms. 수십 ms 를 수 ms 로 만들려고 디스크를 2배 내지 않는다. 검색이 느렸던 원인은 FTS 부재가 아니라 색인 오염이었다. `v2-release.md` 는 done 이라 손대지 않으며 U11 의 실제 결말은 이 결정이 정본이다.
영향: #fts-register

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-30T10:36:00+09:00 | #indexer-gitignore #chunker-dedupe | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1036_bug_indexer-gitignore-and-line-duplication.md | require_git(false)+deny 21종 · 줄 4KB/청크 16KB 상한 · 같은 범위 1회 · 031 정리. 사본 실측 청크 70.6K→49.5K, 178→58MB |
| 2026-08-30T10:36:00+09:00 | #fts-register | claude-code | ☐→[x] | .oculpm/journal/20260830/Chores/1036_chore_retire-trigram-fts.md | 결정 2 로 폐기. 레지스트리 가드 + 011 번호 10→11 정정 + journal_size_limit |
| 2026-08-30T10:36:00+09:00 | #db-size-ui | claude-code | ☐→[x] | .oculpm/journal/20260830/Features_to_add/1036_feature_db-size-compact-and-true-rebuild.md | DbHealth 크기 4종 + db_compact + 재구축이 clear→index. 사본 558→382MB |
<!-- oculpm:plan-log end -->
