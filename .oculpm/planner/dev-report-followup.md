---
oculpm_plan: v1
id: dev-report-followup
title: "개발 보고서 후속 — 정리·부채·기능"
status: active
created: 2026-06-22
updated: 2026-06-22
owner: claude-code
---

`docs/20260622_dev-report/` 의 다중 에이전트 감사 보고서를 실행 계획으로 옮긴 살아있는 플랜.
세 갈래(정리 / 구조적 부채 / 기능)로 추적한다.

## Phase 1 — 코드 정리 {#cleanup}
- [x] 프런트 legacy + 비-legacy 죽은 코드 ~13.6k줄 삭제 + 미사용 deps 제거 {#frontend-dead-code}
- [x] 고아 백엔드 커맨드 정리 — "삭제"군 22개 제거, "재활성화"군 분리 {#orphan-commands}
- [x] 마이그레이션 shim(migrate_from_sqlite, 1911줄) 은퇴 vs 버전 게이트 결정 {#migration-shim}
- [ ] WorkspaceContext 죽은 조각·SettingsContext.setMany·에디터 설정 외과적 제거 {#surgical-context-cleanup}

## Phase 2 — 구조적 부채 {#debt}
- [x] redaction(redact_text)을 일지·diff 쓰기/읽기 경로에 연결 (안전 1순위) {#redaction-wire}
- [ ] 플래너 이중화 해소 — Today·AI챗·그린필드를 파일 기반 plan 으로 일원화 {#planner-unify}
- [ ] 자동 일지→플래너 화해 (on-journal-write reconciliation) {#auto-reconcile}

## Phase 3 — 기능 {#features}
- [ ] 정직성 감사 — compare_layers 재활성화로 빠뜨린 변경 탐지 {#honesty-audit}
- [ ] 백엔드 기반 저널 쿼리 + 무한 타임라인 (14일 한계 제거) {#journal-query}
- [ ] 파싱 경고 노출 + frontmatter 자동 보정 {#parse-warnings}
- [ ] Git 히스토리 백필 — 기존 레포 콜드스타트 절벽 제거 {#git-backfill}
- [ ] 회고/인사이트 생성 (overview 파이프라인 재활용) {#retro-insight}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-06-22T01:38:00+09:00 | #frontend-dead-code | claude-code | →x | journal/20260622/Refactors/0138_refactor_legacy-dead-code-removal.md | ~13.6k줄 삭제, 게이트 전부 통과 |
| 2026-06-22T01:40:00+09:00 | #orphan-commands | claude-code | →~ | | 착수 — "삭제"군부터 |
| 2026-06-22T01:57:00+09:00 | #orphan-commands | claude-code | ~→x | journal/20260622/Refactors/0157_refactor_orphan-backend-commands.md | 22개 제거, 게이트 전부 통과 |
| 2026-06-22T05:45:00+09:00 | #redaction-wire | claude-code | →~ | | 착수 — 02 §2 삽입점 확인, 투영/at-write/at-capture 3갈래 설계 |
| 2026-06-22T06:30:00+09:00 | #redaction-wire | claude-code | ~→x | journal/20260622/Bugs/0630_bug_redaction-not-wired-to-journal-diff.md | 본문전용 마스킹·sidecar v3·적대적리뷰 8건 반영, 게이트 전부 통과 |
| 2026-06-22T07:00:00+09:00 | #migration-shim | claude-code | →x | journal/20260622/Refactors/0700_refactor_retire-sqlite-migration-shim.md | 결정 C(코드제거·테이블보존). ~2.9k줄 순삭, slug 크레이트 제거, 게이트 전부 통과 |
<!-- oculpm:plan-log end -->
