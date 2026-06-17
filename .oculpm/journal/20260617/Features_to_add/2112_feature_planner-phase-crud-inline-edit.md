---
schema_version: 1
type: feature
slug: planner-phase-crud-inline-edit
status: done
difficulty: medium
created_at: "2026-06-17T21:12:36+09:00"
updated_at: "2026-06-17T21:12:36+09:00"
session_id: "20260617-002"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/planner/plan_edit.rs
    op: update
    bytes_added: 8890
    bytes_removed: 0
  - path: src-tauri/src/commands/plan.rs
    op: update
    bytes_added: 840
    bytes_removed: 138
  - path: src/features/planner/PlannerScreenV2.tsx
    op: update
    bytes_added: 10539
    bytes_removed: 5386
  - path: src/styles/screens.css
    op: update
    bytes_added: 4383
    bytes_removed: 0
related: []
tags: ["planner", "ui_v2", "crud", "inline-edit", "phase", "dogfooding-finding"]
---

[x] Planner 단계(Phase) CRUD + CRUD UI 인라인 편집 재설계

## 추가 기능

사용자 피드백 2건(① 계획 수정 시 단계 헤더(goal-title)를 바꿀 수 없음 ② plan CRUD UI 가 구림 — 단, 전체화면 블러+모달 방식은 금지)에 대응. 선택지 질문으로 ① "goal-title=단계 제목", ② "제자리 인라인 편집", ③ "단계 이름변경·삭제·순서변경"을 확정한 뒤 구현.

1. **단계 CRUD 백엔드** — `PlanEditOp` 에 `RenamePhase{from,to}` · `RemovePhase{phase}` · `MovePhase{phase,up}` 3종 추가. markdown 수술 함수(`plan_edit.rs`)는 순수 함수: `rename_phase`(`{#id}` 마커·하위 항목 보존), `remove_phase`(헤딩+다음 `## `/plan-log 전까지 본문 삭제), `move_phase`(인접 phase 블록 스왑 — 블록 경계는 헤딩~다음헤딩이라 후행 빈줄까지 함께 이동, Decisions/plan-log 는 region_end 로 제외해 끌려가지 않음). phase 이름 매칭은 파서와 동일하게(`{#id}` 제거 후 trim) 산출. 구조 변경이라 plan-log 행은 append 하지 않음.
2. **제자리 인라인 편집 + 단계 액션 UI** — phase 헤더를 단일 `<button className="goal-head">` 에서 `goal-head-row`(접기 토글 버튼 + 인라인 rename 입력 + 호버 노출 액션 + %)로 재구성(`PhaseCard` 컴포넌트 추출). 단계 펜슬→제자리 입력, ↑/↓ 순서, 🗑 인라인 확인 삭제. 계획 제목도 클릭→인라인 편집(`plan-title-btn`, 펜슬 페이드인). 항목 행 액션(✎🗑)은 호버/포커스 시에만 노출(`item-actions`/`phase-actions` opacity+pointer-events, 공간 예약으로 리플로우 없음). 재사용 버튼 클래스 `pln-iconbtn`/`pln-textbtn`(+danger=`--t-bug-soft`).

## 동작 흐름

UI rename/delete/move → `editPhase(op, failMsg)` 헬퍼 → `commands.planApplyEdit(projectId, planId, op, "user")` → 백엔드 lock 가드 후 해당 markdown 수술 → 갱신된 `PlanDetail` 반환 → `setDetail`+`refreshPlans`. `phases` 는 항목을 phase 별로 묶은 것이라 헤딩 없는 항목은 합성 버킷 `NO_PHASE("(기타)")` 로 모이는데, 이 버킷엔 실제 `## ` 헤딩이 없어 phase 액션을 숨김(`canEdit`). 순서 이동 가능 여부는 합성 버킷을 뺀 실제 phase 목록 인덱스로 산출해, 끝 phase 뒤에 기타 버킷이 있어도 마지막 phase 의 ↓ 가 잘못 활성화되지 않음.

## 검증

- `cargo test --lib planner` 37 passed (신규 phase 수술 테스트 6개 포함: rename 항목·id 보존, 빈제목/미존재 에러, brace-id 보존, remove 헤딩+항목 삭제, move 인접 스왑·경계 no-op, Decisions 불변).
- `cargo test export_bindings_typescript` 로 `bindings.ts` 재생성 — `PlanEditOp` 에 rename/remove/move_phase 3종 반영 확인.
- `pnpm typecheck` / `pnpm lint`(no-localStorage) / `pnpm test`(114 passed·3 todo) / `pnpm build` 전부 exit 0.
- 런타임 시각 검증(앱 실사용)은 미수행 — `verified_by_user: false`.

## 메모

- phase 는 **이름으로** 매칭하므로 rename 은 정확히 1회만 커밋해야 함(Enter→blur 이중 호출 시 두번째는 이미 바뀐 옛 이름을 못 찾아 거짓 "not found" 토스트). PhaseCard 는 Enter 가 입력을 blur 시키고 단일 onBlur 가 커밋, Escape 는 `cancelEditRef` 로 커밋 skip 하는 패턴으로 해결. 항목/계획 rename 은 안정 id 로 매칭이라 이 문제 없음(기존 패턴 유지).
- 온디스크 레이아웃(`## Phase` 헤딩)은 불변 — schema_version 불변, AGENTS.md 변경 없음. 단계는 기존엔 add_item 으로 암묵 생성만 가능했고, rename/delete/reorder 가 비어 있던 구멍을 메움.
- 모달 금지 제약 준수: 모든 편집이 제자리(in-place)·호버 노출, 백드롭/블러 없음.
- 후속 후보(이번 미포함): 항목 드래그 재정렬·단계 간 이동, 항목 메모 인라인 편집, 계획 설명 본문.
