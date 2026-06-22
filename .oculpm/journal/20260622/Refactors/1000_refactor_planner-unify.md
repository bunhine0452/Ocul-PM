---
schema_version: 1
type: refactor
slug: planner-unify
status: done
difficulty: high
created_at: "2026-06-22T10:00:00+09:00"
session_id: "20260622-m08"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/today/useNextTasks.ts
    op: update
  - path: src/features/onboarding/GreenfieldWizard.tsx
    op: update
  - path: src/features/chat/aiContext.ts
    op: update
  - path: src/features/chat/aiActions.tsx
    op: update
  - path: src/__tests__/today_v2.test.tsx
    op: update
related: []
tags: ["refactor", "planner-unify", "structural-debt", "oculpm", "dev-report-followup", "S1"]
---

[x] 플래너 이중화 해소 — Today·AI챗·그린필드를 파일 기반 플랜으로 일원화 (S1)

## 동기

보고서 02 §1. 파일 기반 플래너(`PlannerScreenV2` → `plan.rs` → `.oculpm/planner/*.md`)와 **레거시 SQLite goals/subtasks**가 공존하며, Today "다음 할 일"·AI챗 플래너 액션·그린필드 시드 목표가 **죽은 SQLite sink** 에 읽고/써서 Planner 화면과 갈라졌다. "AI 가 계획을 갱신한다"는 서사가 보이지 않는 sink 로 가 깨져 있었다.

## 변경 요약

세 소비처를 전부 파일 기반 플랜(`plan_list`/`plan_get`/`plan_create`/`plan_apply_edit`)으로 전환:
- **useNextTasks**(Today 다음 할 일): goalList/subtaskList → 활성 플랜의 미완료 item 수집(in_progress 우선). Planner 화면과 같은 SSOT.
- **GreenfieldWizard 시드**: goalCreate → `plan_create("초기 계획")` + item 추가(`add_item`).
- **AI챗(aiActions + aiContext)**: 핵심 재작성. `buildPlannerSystemContext` 가 plan_id/item_id 를 주입하고, json:action 프로토콜을 plan-op(create_plan/add_items/set_status/rename_item/remove_item)로 교체, `handleApply` 가 `plan_apply_edit` 로 적용. 카드 UI 도 plan-op 표시로 변경.
- **결과**: 활성 프런트에서 레거시 goal/subtask 커맨드 호출 0건(grep 확인) — 데이터 흐름 단일화.

## 검증

- 백엔드 무변경(파일플랜 API 기존). typecheck/test/lint/build 전부 exit 0(125 통과, today 다음 할 일 테스트를 플랜 픽스처로 갱신). AI챗 LLM 동작은 게이트로 검증 불가하나, 잘못된 액션은 `handleApply` 가 graceful 에러(크래시 없음).

## 메모

- v1.14.0 으로 배포.
- **후속(deferred)**: 이제 죽은 레거시 goal/subtask 백엔드 커맨드 8개(`commands/planner.rs`) + `src/features/planner/hooks.ts`(useGoals/useSubtasks) 제거 — 소비처가 모두 떠났으므로 안전. goal DB 테이블·`plan_migrate_goals`(직접 db 읽기)는 보존. → 다음 정리 라운드.
