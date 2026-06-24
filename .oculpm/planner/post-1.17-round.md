---
oculpm_plan: v1
id: post-1.17-round
title: "1.17 후속 — deferred 정리 + 백로그"
status: active
created: 2026-06-24
updated: 2026-06-24
owner: claude-code
---

dev-report-followup 플랜(전 항목 완료, 잠금) 이후의 후속. deferred 정리와
`docs/20260622_dev-report/03-next-features.md` 백로그에서 고른 항목을 추적한다.

## Phase 1 — deferred 정리 {#cleanup}
- [x] 고아 goal/subtask db 메서드 5개 제거 (안전망 테스트 슬림) {#orphan-db-methods}
- [x] F7a-B 한계 후속 (기존 캐시행 재보정·한글 slug·원본 1회 기록) {#f7a-b-followups}
- [ ] auto-reconcile 후속 (N4 공유락·완료 토스트·다중 활성 플랜) {#auto-reconcile-followups}

## Phase 2 — 백로그 기능 {#features}
- [x] 공유 가능한 일지 내보내기 (.md 번들, C2) {#export-digest}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-06-24T17:35:00+09:00 | #orphan-db-methods | claude-code | →x | journal/20260624/Refactors/1735_refactor_orphan-goal-subtask-db-methods.md | Db::update_goal/delete_goal/create_subtask/toggle_subtask/delete_subtask 제거(호출처 0 grep 확인). invariant_06 슬림(delete 단언→list_subtasks 가드, stale 주석 갱신). create_goal/list_goals/get_goal/list_subtasks+테이블 보존. cargo 284 통과, bindings 무변경. 표면0→C2와 묶음 |
| 2026-06-24T17:41:00+09:00 | #export-digest | claude-code | →x | journal/20260624/Features_to_add/1741_feature_export-digest.md | C2 완료: 회고 화면 "내보내기"→oculpm_export_digest(range_entries 재사용, 워크데이별 .md 평탄화, get_entry 본문). 네이티브 저장 다이얼로그+write_atomic 백엔드, 마스킹 캐시(R1)라 안전, dialog:allow-save 명시. 백엔드 286·프런트 게이트 통과. orphan-db-methods 와 묶어 v1.18.0 |
| 2026-06-24T18:05:00+09:00 | #f7a-b-followups | claude-code | →~ | journal/20260624/Features_to_add/1805_feature_f7a-b-coercion-coverage.md | Unit A(①②): Unicode-aware normalize_slug(한글 보존+구분자/대소문자 정규화) + coercion_version(migration 023) 으로 기존 캐시행 재보정(증분 패스가 버전 stale 행 1회 재투영+도장, upsert 빠른경로 drift self-heal). 캐시/표시 전용·디스크 불변. 백엔드 288 테스트(신규 3), bindings 불변. ③ 원본고치기는 Unit B |
| 2026-06-24T18:18:00+09:00 | #f7a-b-followups | claude-code | ~→x | journal/20260624/Features_to_add/1818_feature_coerce-entry-on-disk.md | Unit B(③): "원본 고치기" — 명시적 옵인 버튼+인라인 확인으로 tz 보정을 원본 .md 에 1회 기록(coerce_journal_entry_timestamps_on_disk, update_journal_entry_meta 패턴 재사용). 타임스탬프만(slug=파일명 결합이라 디스크 미반영). 디스크 불변 원칙을 사용자 의도시에만 깸. 백엔드 289(신규 1)·프런트 게이트 통과. F7a-B 3서브태스크 완료 |
<!-- oculpm:plan-log end -->
