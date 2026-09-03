---
schema_version: 1
type: feature
slug: "planner-rail-tidy-and-resize"
status: done
difficulty: medium
created_at: "2026-09-03T20:29:47+09:00"
session_id: "20260903-013"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/planner/planList.ts"
    op: update
  - path: "src/features/planner/PlanRail.tsx"
    op: update
  - path: "src/features/planner/PlanRailDock.tsx"
    op: create
  - path: "src/features/planner/PlanItemRow.tsx"
    op: create
  - path: "src/features/planner/planMeta.ts"
    op: create
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/contexts/workspaceDefaults.ts"
    op: create
  - path: "src/styles/screens.css"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/plan_list.test.ts"
    op: update
  - path: "src/__tests__/tools_v2.test.tsx"
    op: update
related: []
tags:
  - "planner"
  - "ui"
  - "scale"
  - "mcp-tool"
---
[x] 계획이 쌓여도 목록은 짧게 — 월별 접기·묶어 보관·레일 폭/좌우

## 추가 기능

에이전트는 작업 단위마다 계획을 새로 만든다 (AGENTS.md 가 "끝난 계획은 얼리고 새 계획으로 옮기라"고 시킨다). 그래서 '완료' 는 하루 한 개꼴로 자라 39개가 됐고, 펼치면 39줄짜리 벽이라 무엇이 언제 끝났는지 읽을 수 없었다. 게다가 '보관(archived)' 상태는 백엔드에만 있고 UI 경로가 없어, 한 번 완료된 계획은 영원히 완료 섹션에 남았다.

**정리 — 세 층으로 나눠 풀었다.**

1. **월별로 접는다** (`planList.ts`). `status` 축의 완료·보관 묶음이 12개를 넘으면 `touchedAt` 의 연-월로 다시 쪼갠다 — `완료 · 2026.08` / `완료 · 2026.07` / `완료 · 기록 없음`. 최신 달이 위, 전부 기본 접힘. 진행 중은 몇 개든 쪼개지 않는다 (지금 하는 일은 한눈에 다 보여야 한다).
2. **행 상한 + "N개 더 보기"** (`PlanRail.tsx`). 한 섹션은 10행까지만 그린다. 검색 중에는 상한을 걸지 않고(찾은 것을 숨기면 검색이 아니다), ↑/↓ 이동도 실제로 그려진 행만 훑는다.
3. **보관 경로를 열었다.** 완료 섹션 헤더의 아카이브 버튼 → 인라인 확인 → 그 묶음 전체를 보관으로. 계획 헤더에는 단건 `보관` 버튼(완료 상태에서만). 백엔드에 `plan_set_status_bulk` 를 새로 넣었다 — `plan_set_status` 를 N번 부르면 `reproject_all` 이 계획 파일 전체를 N번 다시 파싱한다. 계획이 40개인 바로 그 상황이 가장 아픈 자리라, 락 1회·쓰기 N회·재투영 1회로 묶었다.

**레일 폭·좌우.** 제목이 긴 계획이 많아지면 236px 은 전부 말줄임표가 된다 — 폭은 계획 이름 길이에 달린 값이라 상수로 정할 수 없다. `PlanRailDock` 이 폭(드래그·←/→ 키·더블클릭 리셋, 170~460px)과 붙는 쪽을 소유하고, 레일은 목록을 그리는 일만 한다. 좌/우는 코드 화면 트리(`codeSidebarSide`)와 같은 규약이다: `row-reverse` 로 뒤집지 않고 두 자리 중 한 곳에 **DOM 순서 그대로** 렌더해 Tab 이동이 눈에 보이는 차례와 어긋나지 않게 했다. 인라인 width 는 CSS 를 이기지만 `max-width` 에는 지므로, 좁은 칸의 상한(`@container plnbody`)은 그대로 CSS 가 쥔다.

## 동작 흐름

- `plan_set_status_bulk(project_id, plan_ids, status)` → 알 수 없는 id 는 건너뛰고(목록이 디스크보다 늦을 수 있다) 실제로 고쳐 쓴 수를 돌려준다.
- `plannerRailWidth` / `plannerRailSide` 는 `WorkspaceContext` 에 영속. 섹션 펼침(`plannerRailOpen`)은 월 키(`done:2026-08`)로 따로 기억된다.

## 곁다리 — 파일 크기 래칫

`PlannerScreenV2.tsx` 는 1408줄이라 한 줄도 늘릴 수 없었다. 항목 행을 `PlanItemRow.tsx` 로, 공유 어휘(상태 글리프·클릭 순환·날짜 포맷)를 `planMeta.ts` 로 떼어 1090줄로 줄인 뒤 작업했다. `WorkspaceContext.tsx` 도 같은 이유로 `DEFAULT_STATE` 를 `workspaceDefaults.ts` 로 분리했다 — 이때 `WORKSPACE_SCHEMA_VERSION` 을 값으로 되가져오면 두 모듈이 서로를 실행 시점에 기다려 TDZ 로 터지므로, 상수를 defaults 쪽으로 옮기고 컨텍스트가 재수출한다.

## 검증

- `pnpm test` 2119개 통과 (신규 7: 월 분할 4 + `monthKeyOf` 1 은 `plan_list.test.ts`, 레일 상한·묶어 보관·좌우 이동·키보드 리사이즈 5는 `tools_v2.test.tsx`). 레일 axe 스위트도 그대로 통과 — 섹션 헤더를 버튼에서 줄(div + 두 버튼)로 바꾼 뒤라 중첩 인터랙티브가 없다는 근거가 된다.
- `pnpm typecheck` / `pnpm lint` (storage·i18n·bindings·design·filesize 5종) / `pnpm build` 전부 exit 0.
- `cargo test` (bindings 재생성 포함) / `cargo fmt --check` / `cargo clippy --all-targets -D warnings` 전부 exit 0.
- 실기기 육안 확인은 안 했다 — 설치본이 도는 중이라 dev 빌드를 띄우지 않았다.