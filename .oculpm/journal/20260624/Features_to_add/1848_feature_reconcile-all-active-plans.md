---
schema_version: 1
type: feature
slug: reconcile-all-active-plans
status: done
difficulty: high
created_at: "2026-06-24T18:48:55+09:00"
session_id: "20260624-m07"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
files_touched:
  - path: src-tauri/src/oculpm/reconcile.rs
    op: update
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
related:
  - ref: 20260624/Features_to_add/1709_feature_auto-reconcile.md
    kind: followup
tags: ["feature", "auto-reconcile", "planner", "oculpm", "post-1.17-round", "F1"]
---

[x] auto-reconcile 후속 ③ 다중 활성 플랜 화해 (Unit E)

## 추가 기능

auto-reconcile 가 "활성 플랜 정확히 1개일 때만" 동작하던 제약 해소. 사용자 결정(모든 활성 플랜에 화해)에 따라, 새 일지마다 **모든 활성 플랜 각각**에 LLM 1회씩 호출해 그 플랜 항목이 진전됐는지 독립 판단한다(오귀속 없음, 비용은 플랜 수 N배 — 옵인이라 허용).

## 동작 흐름

- `reconcile_entry`: 단일-플랜 분기 → **활성 플랜 루프**로 재작성. 엔트리 컨텍스트(journal_block)·provider/model/client 는 1회만 준비, 플랜마다 read md→파싱(잠금/빈/소실 plan 은 continue, 다른 플랜에 영향 없음)→LLM(한 플랜 에러도 continue)→유효 status flip 적용→N4 락 잡고 CAS 재독→write→reproject. 결과는 `ReconcileOutcome::Ran(Vec<PlanReconcileResult{plan_id, applied}>)`.
- watcher: applied>0 인 플랜마다 `OculpmPlanReconciled` emit(프런트 dedup 키가 plan별이라 변경된 플랜 수만큼 토스트).
- git-backfill 가드는 루프 전(엔트리 로드 직후)이라 백필이 N×commits LLM 호출을 유발하지 않음. reconcile_lock try_lock 으로 프로젝트당 동시 1건 유지.

## 검증 (적대적 리뷰 반영)

- 7개 리스크(데드락/락스코프/루프정확성/비용/이벤트/CAS/락상호작용) 단독 적대리뷰 — **blocker·should-fix 0**. 락 순서 비순환(reconcile_lock→plan_write_lock 단일 중첩), CAS 는 pre-LLM 스냅샷 대조로 건전, 플랜 간 변수 누수 없음, 비용 정확히 N콜. 지적된 nit 반영: stale 주석 3건(watcher "단일 플랜"/"CAS 미보장—N4") 갱신, CAS yield 시 info 로그 추가(드롭된 화해 진단 가능).
- 백엔드 cargo build clean + test 290. bindings 불변(ReconcileOutcome 은 내부 타입). 프런트 게이트 전부 exit 0.

## 메모

- `#auto-reconcile-followups` 3서브태스크(①완료토스트 ②N4락 ③다중플랜) 전부 완료([~]→[x]). post-1.17-round 플랜 전 항목 완료.
- CAS yield(사용자 편집 중 reconcile 충돌)는 조용히 드롭하고 로그만 — 재시도 안 함(안전 우선). 다음 일지에서 다시 시도됨.
