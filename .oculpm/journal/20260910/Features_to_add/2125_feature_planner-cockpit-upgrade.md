---
schema_version: 1
type: feature
slug: "planner-cockpit-upgrade"
status: done
difficulty: medium
created_at: "2026-09-10T21:25:41+09:00"
session_id: "20260910-005"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "ce6e3504-bf40-48a3-95c2-7760471489a8"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/parse.rs"
    op: update
  - path: "src/features/planner/planMeta.ts"
    op: update
  - path: "src/features/planner/NextUp.tsx"
    op: create
  - path: "src/features/planner/PlanBody.tsx"
    op: update
  - path: "src/features/planner/PhaseCard.tsx"
    op: update
  - path: "src/features/planner/PlanItemRow.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/planner/usePlanDocument.ts"
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
  - path: "src/__tests__/plan_meta.test.ts"
    op: create
  - path: "src/__tests__/plan_body_upgrade.test.tsx"
    op: create
  - path: "src/__tests__/tools_v2.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "planner"
  - "ui"
  - "progress"
  - "a11y"
  - "mcp-tool"
---
[x] 플래너 업그레이드 — 숫자 셋이 맞고, 남은 일이 위로 올라오고, 여섯 상태를 손으로 고른다

## 추가 기능

스크린샷 한 장(monaco-editor-round 플랜)에서 출발했다. 머리글이 **「32/35 완료 · 진척 100% · 완료 34 · 막힘 2 · 이월 1」** 을 동시에 말하고 있었고, 완료 32개가 취소선 벽을 이뤄 남은 셋을 찾으려면 스크롤해야 했고, UI 에는 막힘·이월·폐기로 보낼 방법이 없었다.

### 1. 숫자 셋이 같은 모수를 센다
- **백엔드 `ItemStatus::weight`**: blocked 를 `None`(분모 제외)에서 `Some(0.0)` 으로. 막힘은 `lifecycle.rs` 의 「미완」 정의대로 아직 이 계획에 남은 일이다 — 분모에서 빼면 막힌 항목이 둘인 계획이 100% 로 찍히고 단계 상태도 `done` 으로 파생됐다. 이월·폐기는 계획을 떠난 일이라 그대로 제외.
- **프런트 `counts`**: 부모 항목까지 세던 것을 리프 기준(`leafItems`)으로. 「완료 34」 가 「완료 32」 가 된다.
- **쌓인 진척 바**: 한 색 바 대신 done · in_progress(연하게) · blocked(빨강) · todo(빈 칸) 조각. 조각은 백엔드 진척 분모와 같은 네 상태만. `role="img"` + 집계 문장 aria-label.
- 단계 머리에 `done/total` 과 막힘 배지 — 펼치지 않고도 어디가 막혔는지 안다.

### 2. 다음 할 일 띠 (`NextUp.tsx`)
머리글 아래에 막힘 → 진행중 → 할 일 순으로 최대 5개. 누르면 그 행으로 뛴다(`data-item-id` + `scrollIntoView` + 1.8초 `is-target` 강조, 접힌 단계는 먼저 펼침). 실행 버튼은 행의 것과 같은 디스패치. 열린 계획에 남은 것이 없으면 「완료·잠금으로 마무리하세요」 를 알린다. 순서·상한은 순수 함수 `nextUp()` 이 소유.

### 3. 「전체 / 남은 것만」 (`plannerHideDone`, 프로젝트별 영속)
`.seg` 프리미티브 탭. 켜지면 완료·폐기 행이 숨고(부모는 롤업이라 하위가 다 끝나면 같이), 단계 발치에 「완료 N개 숨김 · 전체 보기」.

### 4. 상태 메뉴
글리프 클릭은 여전히 앞으로 한 칸. 글리프 **우클릭** 또는 호버 액션의 ▾ 가 여섯 상태 전부를 `menuitemradio` 로 연다. 부모 행에는 없다(롤업). 일지 선택기와 바깥클릭·Escape 닫기를 `useCloseOnOutside` 로 공유.

## 동작 흐름
`plan_get` → `PlanBody` 가 `progressSegments / nextUp / leafItems` 로 파생 → `PhaseCard` 가 `hideDone` 으로 행을 거르고 숨긴 수를 적음 → `PlanItemRow` 상태 메뉴 → `onSetStatus` (기존 완료 소프트 게이트 그대로 통과).

## 검증
- `cargo fmt` · `cargo clippy --all-targets -D warnings` · `cargo test` 전부 초록 (lib 1433 + 통합 스위트, `progress_rollup_counts_blocked_excludes_deferred_dropped` 로 1/4 단언). bindings.ts 무변경.
- `pnpm typecheck` · `pnpm test` 202 파일 2613 통과 (새 `plan_meta` 4 + `plan_body_upgrade` 10) · `pnpm lint` 6 게이트 초록 (parse.rs 는 래칫 1308 아래로 주석을 줄여 맞춤) · `pnpm build` 성공.
- 기존 `tools_v2` 플래너 스위트는 같은 제목이 띠에도 실리게 되어 `.sub-title` 셀렉터로 좁혔다.
- **실기기 육안 확인은 안 했다** — 설치본이 도는 중이라 dev 빌드를 띄우지 않았다 (락 경합). 다음 앱 종료 뒤 라이트/다크에서 바 조각 색과 상태 메뉴 위치를 볼 것.