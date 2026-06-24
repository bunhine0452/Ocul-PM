---
oculpm_plan: v1
id: dev-report-followup
title: "개발 보고서 후속 — 정리·부채·기능"
status: done
created: 2026-06-22
updated: 2026-06-24
owner: claude-code
---

`docs/20260622_dev-report/` 의 다중 에이전트 감사 보고서를 실행 계획으로 옮긴 살아있는 플랜.
세 갈래(정리 / 구조적 부채 / 기능)로 추적한다.

## Phase 1 — 코드 정리 {#cleanup}
- [x] 프런트 legacy + 비-legacy 죽은 코드 ~13.6k줄 삭제 + 미사용 deps 제거 {#frontend-dead-code}
- [x] 고아 백엔드 커맨드 정리 — "삭제"군 22개 제거, "재활성화"군 분리 {#orphan-commands}
- [x] 죽은 레거시 goal/subtask 커맨드 8개 제거 (planner-unify 후속, 테이블·migration 보존) {#legacy-goal-subtask-removal}
- [x] 마이그레이션 shim(migrate_from_sqlite, 1911줄) 은퇴 vs 버전 게이트 결정 {#migration-shim}
- [x] WorkspaceContext 죽은 조각·SettingsContext.setMany·에디터 설정 외과적 제거 {#surgical-context-cleanup}

## Phase 2 — 구조적 부채 {#debt}
- [x] redaction(redact_text)을 일지·diff 쓰기/읽기 경로에 연결 (안전 1순위) {#redaction-wire}
- [x] 플래너 이중화 해소 — Today·AI챗·그린필드를 파일 기반 plan 으로 일원화 {#planner-unify}
- [x] 자동 일지→플래너 화해 (on-journal-write reconciliation) {#auto-reconcile}

## Phase 3 — 기능 {#features}
- [x] 정직성 감사 — compare_layers 재활성화로 빠뜨린 변경 탐지 {#honesty-audit}
- [x] 백엔드 기반 저널 쿼리 + 무한 타임라인 (14일 한계 제거) {#journal-query}
- [x] 파싱 경고 노출 + frontmatter 자동 보정 {#parse-warnings}
- [x] Git 히스토리 백필 — 기존 레포 콜드스타트 절벽 제거 {#git-backfill}
- [x] 회고/인사이트 생성 (overview 파이프라인 재활용) {#retro-insight}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-06-22T01:38:00+09:00 | #frontend-dead-code | claude-code | →x | journal/20260622/Refactors/0138_refactor_legacy-dead-code-removal.md | ~13.6k줄 삭제, 게이트 전부 통과 |
| 2026-06-22T01:40:00+09:00 | #orphan-commands | claude-code | →~ | | 착수 — "삭제"군부터 |
| 2026-06-22T01:57:00+09:00 | #orphan-commands | claude-code | ~→x | journal/20260622/Refactors/0157_refactor_orphan-backend-commands.md | 22개 제거, 게이트 전부 통과 |
| 2026-06-22T05:45:00+09:00 | #redaction-wire | claude-code | →~ | | 착수 — 02 §2 삽입점 확인, 투영/at-write/at-capture 3갈래 설계 |
| 2026-06-22T06:30:00+09:00 | #redaction-wire | claude-code | ~→x | journal/20260622/Bugs/0630_bug_redaction-not-wired-to-journal-diff.md | 본문전용 마스킹·sidecar v3·적대적리뷰 8건 반영, 게이트 전부 통과 |
| 2026-06-22T07:00:00+09:00 | #migration-shim | claude-code | →x | journal/20260622/Refactors/0700_refactor_retire-sqlite-migration-shim.md | 결정 C(코드제거·테이블보존). ~2.9k줄 순삭, slug 크레이트 제거, 게이트 전부 통과 |
| 2026-06-22T07:30:00+09:00 | #parse-warnings | claude-code | →~ | journal/20260622/Features_to_add/0730_feature_expose-parse-warnings.md | 노출(A) 완료: parse_ok/parse_warnings DTO+⚠배지. 자동보정(B) 후속 |
| 2026-06-22T08:00:00+09:00 | #surgical-context-cleanup | claude-code | →~ | journal/20260622/Refactors/0800_refactor_settings-dead-code-cleanup.md | Settings 파트 완료(setMany·에디터설정군). WorkspaceContext reducer 수술은 보류(리스크) |
| 2026-06-22T08:30:00+09:00 | #git-backfill | claude-code | →x | journal/20260622/Features_to_add/0830_feature_git-history-backfill.md | commits_for_backfill+backfill_from_git(멱등·redact·entry_diffs tier-3)+빈화면 트리거. 게이트 전부 통과 |
| 2026-06-22T09:00:00+09:00 | #honesty-audit | claude-code | →x | journal/20260622/Features_to_add/0900_feature_honesty-audit.md | compare_layers 재활성(Today HonestyAudit 카드, only_in_index 노출, 문제시만 렌더). 프런트전용 |
| 2026-06-22T09:30:00+09:00 | #journal-query | claude-code | →x | journal/20260622/Features_to_add/0930_feature_journal-query-full-history.md | all-period 백엔드 쿼리(EntryFilters)로 14일 한계 제거 + 미완료/검증됨 토글 + 더보기. v1.13.0 |
| 2026-06-22T10:00:00+09:00 | #planner-unify | claude-code | →x | journal/20260622/Refactors/1000_refactor_planner-unify.md | 세 소비처(Today useNextTasks·AI챗 aiActions+aiContext·그린필드 시드)를 파일 기반 plan(plan_list/get/create/apply_edit)으로 전환. 레거시 goal/subtask 호출 0건. 백엔드 무변경, 게이트 전부 통과. v1.14.0. 후속: 죽은 레거시 커맨드 8개+hooks.ts 제거 |
| 2026-06-22T12:40:00+09:00 | #legacy-goal-subtask-removal | claude-code | →x | journal/20260622/Refactors/1240_refactor_remove-legacy-goal-subtask-commands.md | 13에이전트 감사(blocked 0)→ planner.rs 전체 삭제 + mod.rs/lib.rs 등록 제거, bindings 재생성(커맨드 8개+미사용 Subtask 타입 드롭). 테이블·migration·plan_migrate_goals·Goal 타입 보존. hooks.ts 는 c59546a 에서 이미 삭제됨. 게이트 전부 통과. 후속: 고아 db 메서드 5개(안전망 테스트 얽힘) |
| 2026-06-22T13:30:00+09:00 | #parse-warnings | claude-code | ~→x | journal/20260622/Features_to_add/1330_feature_frontmatter-tz-slug-coercion.md | B(자동보정) 완료: tz 오프셋 backfill(DST정확)+slug 정규화, 캐시/표시 전용·디스크 불변. parse_ok=구조신호 분리(advisory 경고). 6에이전트 적대리뷰 blocker 0, should-fix 3+nit 2 전부 반영. 백엔드 273+통합·프런트 게이트 전부 통과, bindings 불변 |
| 2026-06-24T00:25:00+09:00 | #retro-insight | claude-code | →x | journal/20260624/Features_to_add/0025_feature_retro-insight.md | F4 완료: 신규 "회고" 화면(5번째 MAIN_NAV). 결정적 신호(출시/저항/노력핫스팟×그래프팬아웃/에이전트/난이도)→retro_signals, blake3 signature 캐시(retro_insights 022 마이그레이션)·오래됨 배지, generate_retro LLM(planner provider/failover 경로). range_entries 범위쿼리+aggregate 순수함수(단위 6)+적대리뷰(should-fix 1 레이스 수정). 백엔드 297 테스트·프런트 게이트 전부 통과. v1.16.0 릴리스 |
| 2026-06-24T16:40:00+09:00 | #surgical-context-cleanup | claude-code | ~→x | journal/20260624/Refactors/1640_refactor_workspace-context-dead-code.md | WorkspaceContext 죽은 조각 제거: 세터 4개(setActiveView/setWorkdayKey/setSidePanel*)+옛 diffTarget 핸드오프(openDiffFor/consumeDiffTarget/diffTarget, diffActivePath로 대체)+clearRecentChanges. 조각마다 grep 검증(보고서 openDiffFor "활성2개"는 오기 확인). 마이그레이션 normalizer·필드 보존. 죽은-동작 safety-net 2블록 삭제. 표면0→단독 릴리스 안 함(auto-reconcile과 묶음). typecheck/lint/build·테스트 121 통과 |
| 2026-06-24T17:09:00+09:00 | #auto-reconcile | claude-code | →x | journal/20260624/Features_to_add/1709_feature_auto-reconcile.md | F1 완료: 옵인(agents.auto_reconcile, 기본off) 백그라운드 화해. watcher inserted→spawn_reconcile(try_lock 동시1건), reconcile.rs(일지1건→단일활성플랜 LLM status flip, agent_id=auto:<provider>+journal_ref 채움). 루프안전+백필(-git)스킵+CAS(사람편집 우선). 설정 토글+과금경고. 적대리뷰 should-fix 3(버스트/레이스/가드중앙화) 반영. 백엔드 284·프런트 게이트 통과. surgical-cleanup과 묶어 v1.17.0 |
<!-- oculpm:plan-log end -->
