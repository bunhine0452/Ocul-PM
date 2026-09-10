---
schema_version: 1
type: feature
slug: "planner-kanban-board"
status: done
difficulty: medium
created_at: "2026-09-10T21:59:08+09:00"
session_id: "20260910-005"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "ce6e3504-bf40-48a3-95c2-7760471489a8"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/PlanBoard.tsx"
    op: create
  - path: "src/features/planner/StatusMenu.tsx"
    op: create
  - path: "src/features/planner/PlanItemRow.tsx"
    op: update
  - path: "src/features/planner/PlanBody.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/planner/planMeta.ts"
    op: update
  - path: "src/contexts/workspaceState.ts"
    op: update
  - path: "src/contexts/workspaceDefaults.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/__tests__/plan_board.test.tsx"
    op: create
  - path: "src/__tests__/plan_body_upgrade.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - ref: "20260910/Features_to_add/2125_feature_planner-cockpit-upgrade.md"
    kind: "followup"
tags:
  - "planner"
  - "ui"
  - "kanban"
  - "dnd"
  - "mcp-tool"
---
[x] 플래너 보드 보기 — 같은 항목을 상태별 열로, 끌어서 상태를 바꾼다

## 추가 기능

앞 일지(조종석 업그레이드)에 이어, 사용자가 시각적 판 바꾸기 후보 셋 중 **칸반 뷰**를 골랐다. 문서형 체크리스트 옆에 두 번째 배치를 둔다 — 데이터는 `PlanDetail.items` 하나, SSOT 마크다운에는 「열」 개념이 없으므로 새로 저장하는 것은 없다.

- **툴바 `문서 / 보드` 세그먼트** (`.seg` 프리미티브, `plannerView` 프로젝트별 영속). 계획이 없으면 안 뜬다. 보드일 때 `.pln-doc.is-board` 로 읽기폭 상한을 푼다.
- **`PlanBoard.tsx`**: 열은 할 일 · 진행중 · 막힘 · 완료 넷 고정 + 이월·폐기는 항목이 있을 때만. **리프만 카드** (부모는 롤업이라 이중 계산) — 하위 카드에 부모 제목을 빵부스러기(`›`)로 단다. 완료 열은 `BOARD_DONE_PREVIEW`(8) 장만 펼치고 「N개 더 보기」 — 32장짜리 취소선 벽을 보드로 옮겨 오지 않기 위해서다.
- **드래그 = `set_status`**: 카드 `draggable`, 열 `onDragOver/onDrop`, 전용 MIME(`application/x-oculpm-plan-item`)이라 밖에서 떨어지는 텍스트에는 반응하지 않는다. 문서 행의 글리프와 같은 `onSetStatus` 로 가므로 완료 소프트 게이트(검증 일지 없음 확인)도 그대로 거친다. 잠긴 계획은 끌 수 없고 카드 액션도 없다.
- **카드 호버 액션**: 일지(여러 건이면 최근 것을 연다 — 문서 행의 선택기는 안 옮겼다) · 실행(완료·폐기 제외) · ▾ 상태 메뉴.
- **`StatusMenu.tsx` 추출**: 여섯 상태 `menuitemradio` 팝오버와 `useCloseOnOutside` 를 `PlanItemRow` 에서 꺼내 행과 카드가 공유.
- 보드일 때 머리글(쌓인 진척 바·집계)은 그대로, 「남은 것만」 토글과 「다음 할 일」 띠는 접는다 — 열 자체가 그 둘의 답이다.

## 동작 흐름
툴바 탭 → `plannerView` → `PlanBody(view)` → `board ? <PlanBoard> : 단계 카드들`. 카드 드롭 → `onSetStatus(item, column)` → `applyStatus`(done 게이트) → `plan_apply_edit set_status` 낙관적 갱신.

## 검증
- `pnpm typecheck` · `pnpm test` 203 파일 2619 통과 (새 `plan_board` 5: 열 라벨·리프만·빵부스러기 / 빈 열·더 보기 / 카드 액션 / 드래그 drop→상태·같은 열 무시 / 잠금) · `pnpm lint` 6 게이트 초록 · `pnpm build` 성공. 백엔드 무변경.
- jsdom 에 `DataTransfer` 가 없어 테스트는 최소 구현을 얹었다 — 실기기 드래그 감각(고스트 이미지·커서)은 육안 확인 항목으로 남는다.
- **실기기 육안 확인 미완**: 설치본이 도는 중이라 dev 빌드를 안 띄웠다. 볼 것 — 라이트/다크 열 배경 대비, `is-over` 강조, 좁은 폭에서 가로 스크롤, 카드 액션 호버 노출.