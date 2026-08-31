---
oculpm_plan: v1
id: improvement-audit-round
title: "개선점 감사 라운드 — 색인 폭증 · 죽은 표면 · 프로세스 생존"
status: done
created: 2026-08-30
updated: 2026-08-31
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
- [x] PTY 호스트 Kill 이 kill 이 아님 — 자식 보관 → 포그라운드 그룹+셸에 SIGHUP → 1.5초 유예 → SIGKILL → wait, reader 는 gone 동일성으로만 자기 세션 정리 (`ptyhost/host.rs` `_child` 즉시 drop, Kill 은 맵 remove 뿐) {#pty-kill}
- [x] ACP 어댑터가 앱 종료에서 정리 안 됨 — `AcpState::stop_all_blocking`(live 카운터 0 까지 ≤1초) 을 `ExitRequested` 에 (`lib.rs`, `acpStop` 프런트 호출 0). 탭 닫기 경로(`window.rs`) 는 병렬 세션 영역이라 보류 {#acp-exit-cleanup}
- [x] 일지 `relative_path` 경로 탈출 — `resolve_entry_path` 로 절대경로·`..` 거부 + `starts_with` 강제, 6곳 경유, `OculpmError::InvalidPath` (`manager/journal.rs`, 모바일 dispatch 가 노출) {#journal-path-guard}
- [x] diff 백필이 빈 결과를 안 써 열 때마다 git 재실행 — 빈 마커 기록(백필은 건너뛰고 모달 지연복원은 재시도) + `oculpm_init` 2.6/2.7 을 spawn 으로 (`entry_diffs.rs persist`, `oculpm_init` await) {#backfill-marker}
- [x] 자동 화해 LLM·쓰기 오류 무음 — warn + `PlanReconcileResult.error` + 워처가 `OculpmIntegrityWarning(reconcile)` 토스트 (`reconcile.rs` `Err(_) => continue`) {#reconcile-error}
- [x] 사용량 미터 숨김 폴링 — `wrapRef` 가시성 게이트. 플래너 스켈레톤 무한은 **확인 결과 이미 처리돼 있어**(else + 재시도 버튼) 감사 보고가 낡은 것 (`AcpUsageMeter` 8초) {#planner-load-error}
- [>] macOS 혼합 DPI 커서 좌표계 불일치 — 병렬 세션(drag-and-drop-round)의 `window.rs` 작업과 겹쳐 그 라운드로 이월 {#mixed-dpi}

## Phase 3 — 발동 원장(AD-1/2) 리뷰 수정 {#firing-fixes}
- [x] 항상-로드 규칙·CLAUDE.md 를 "한 번도 안 걸림"으로 거짓 표시 — `paths.length===0` 은 배지 없음/「매 세션」 칩, 예산 라벨을 "조건부 규칙" 으로 정정 (`RulesTab.tsx`, nested_memory 는 조건부 규칙만 찍힘) {#fl-always-loaded}
- [x] 가산 UPSERT + 직렬화 없음 + rebuild 없음 → 이중 집계 영구 — 프로젝트별 Mutex · 재개점 CAS · 파일 축소 시 행 삭제 · `firing_rebuild` + 「발동 다시 세기」 · mtime 순 스캔 · 부분 계측 표시 (`db/firings.rs`, `commands/firing_ledger.rs`) {#fl-cas-rebuild}

## Phase 4 — 검토 루프 UI · 죽은 표면 {#review-loop}
- [x] `related` 링크 칩 + `verified_by_user` 토글 — 상세 툴바 「검증」 + 카드 체크 + 칩 클릭 이동(`openByPath` 공유) (`setJournalVerified` 래퍼만 존재, `related` 렌더 0) {#related-verified-ui}
- [x] `journal_committed` 죽은 설정 토글 제거 (`OculpmSettings.tsx`, git commit 호출 0) {#dead-toggle}
- [~] 프런트 미호출 커맨드 정리 — `dapAdapters` 디버그 패널 연결 **완료**. 등록 제거는 `chat` 이 모바일 브리지에서 쓰이고 나머지가 Db 메서드·파이프라인 연쇄라 `ci-and-module-boundaries #dead-command-audit` 로 이관 {#dead-commands}
- [x] MCP `journal_write` 에 `related`·`session_id` 인자 + `language` 를 config 에서 + 마스킹·경고를 응답으로 (`mcp/tools.rs`, AGENTS.md 가 related 를 요구) {#mcp-journal-write-args}

## Phase 5 — CI·DX {#ci-dx}
- [x] `cargo fmt` 1회 정리(154 파일) + `fmt --check` 게이트 (현재 1,090 hunk) {#fmt-gate}
- [x] clippy 50건 → 0, `-D warnings` 게이트(허용 2종만 크레이트 수준) + 잡 timeout 20/40분 {#clippy-gate}
- [x] 로그 브리지 8KB 절단 + 기본 패턴 `redact` 통과, LLM 에러 바디 512B(`llm::error_body`, 4 프로바이더 8곳) (`commands/oculpm.rs oculpm_log`, `llm/*.rs`) {#log-bridge-cap}

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
| 2026-08-30T10:51:00+09:00 | #pty-kill | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1051_bug_pty-kill-was-not-a-kill.md | child 보관·terminate_session(HUP→유예→KILL→wait)·take_sessions 락 밖 종료. 통합 테스트: trap '' HUP; sleep 도 죽고 좀비 없음 |
| 2026-08-30T10:51:00+09:00 | #acp-exit-cleanup | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1051_bug_acp-adapters-orphaned-on-quit.md | live 카운터 + stop_all_blocking ≤1초. 탭 닫기 경로는 window.rs 라 보류 |
| 2026-08-30T10:51:00+09:00 | #journal-path-guard | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1051_bug_journal-path-traversal.md | resolve_entry_path 6곳 경유 + InvalidPath. 4 입력×4 경로 거부 테스트 |
| 2026-08-30T10:51:00+09:00 | #backfill-marker | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1051_bug_backfill-reran-git-on-every-open.md | 빈 마커(sidecar_exists=true, is_current=false) + init 2.6/2.7 spawn. 프런트 시그니처 불변 |
| 2026-08-30T10:51:00+09:00 | #reconcile-error | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1051_bug_reconcile-error-was-silent.md | result.error + warn + IntegrityWarning(reconcile) 토스트 |
| 2026-08-30T10:51:00+09:00 | #planner-load-error | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1051_bug_usage-meter-polled-while-hidden.md | 미터만 수정. 플래너 쪽은 이미 처리돼 있었음 |
| 2026-08-30T11:00:00+09:00 | #fl-always-loaded #fl-cas-rebuild | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1100_bug_firing-ledger-double-count-and-false-dormant.md | CAS 적재 + reset 교체 + scan_lock + firing_rebuild(≤20 라운드) + mtime 순 + partial. 배지는 paths 있는 규칙만 |
| 2026-08-30T11:11:00+09:00 | #related-verified-ui | claude-code | ☐→[x] | .oculpm/journal/20260830/Features_to_add/1111_feature_verified-toggle-and-related-links.md | 검증 토글(툴바)+카드 체크+related 칩 클릭 이동. openByPath 를 Planner 링크와 공유 |
| 2026-08-30T11:11:00+09:00 | #mcp-journal-write-args | claude-code | ☐→[x] | .oculpm/journal/20260830/Features_to_add/1111_feature_mcp-journal-write-related-language-redaction.md | related/session_id 스키마 + language=config + 응답 warnings/redacted. 접두 제거·낯선 kind→followup |
| 2026-08-30T11:11:00+09:00 | #dead-toggle #dead-commands | claude-code | ☐→[x] / ☐→[~] | .oculpm/journal/20260830/Chores/1111_chore_dead-toggle-and-debug-adapters.md | 토글 제거 + dapAdapters 연결. 등록 제거는 chat(브리지 사용)·연쇄 때문에 #dead-command-audit 로 이관 |
| 2026-08-30T11:21:00+09:00 | #fmt-gate #clippy-gate | claude-code | ☐→[x] | .oculpm/journal/20260830/Chores/1121_chore_fmt-clippy-gates.md | fmt 전체 1회(154 파일) · clippy 50→0(--fix 19 + 수동, 허용 2종) · CI fmt --check/clippy -D/timeout |
| 2026-08-30T11:21:00+09:00 | #log-bridge-cap | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1121_bug_log-bridge-unbounded-and-unmasked.md | oculpm_log 8KB+redact · llm::error_body 512B (4 프로바이더 8곳) |
<!-- oculpm:plan-log end -->
