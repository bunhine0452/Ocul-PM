---
schema_version: 1
type: feature
slug: "planner-plan-rail-scale"
status: done
difficulty: high
created_at: "2026-07-30T18:50:39+09:00"
session_id: "mcp-20260730-185039"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/planList.ts"
    op: create
  - path: "src/features/planner/PlanRail.tsx"
    op: create
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/__tests__/plan_list.test.ts"
    op: create
  - path: "src/__tests__/tools_v2.test.tsx"
    op: update
related: []
tags:
  - "planner"
  - "ui_v2"
  - "scale"
  - "dogfooding-finding"
  - "mcp-tool"
---
[x] Planner 칩 벽을 좌측 계획 레일로 교체 — 검색·정렬·묶기로 다수 계획 정리

## 추가 기능

계획이 늘수록 Planner 가 '정리되지 않는' 문제(사용자 보고, 계획 15개 스크린샷)를
구조로 해결한다.

- **계획 레일 (2-pane)** — `.plan-chip-row` 의 랩되는 칩 벽을 240px 좌측 목록으로
  교체. 칩은 `white-space:nowrap; flex:none` 이라 제목 길이만큼 밀려나고 행 수에
  상한이 없어, 계획이 많아지면 본문을 접힘선 밖으로 밀어냈다. 세로 목록은 계획
  수와 무관하게 높이가 일정하다.
- **검색 / 정렬 / 묶기** — 제목·id 부분일치 검색, 최근순·진척순·남은 일 순·이름순,
  상태별·최근활동별·작성자별·묶지 않음. 전부 `PlanSummary` 의 기존 9개 필드만으로
  계산해 백엔드 변경과 `plan_list` 호출 증가가 0.
- **행 정보** — 제목 + 진행 바 + `완료/전체` + 마지막 활동. 예전 칩은 이 정보를
  `title` 툴팁에만 숨겨 뒀다.
- **영속화** — 정렬·묶기·섹션 접힘·레일 접힘이 `aipm:workspace:v1` 에 남는다.
  기존 완료/보관 펼침 상태는 컴포넌트 로컬이라 ⌘K 점프의 강제 remount 마다
  초기화됐다 — '정리해 둔 것이 안 남는' 체감의 절반이 이것이었다.

## 동작 흐름

1. 파생 로직은 전부 `planList.ts` (순수, React·Tauri import 없음)에 모았다 —
   `facetsOf` / `searchPlans` / `sortPlans` / `groupPlans` / `relDay`. `PlanRail` 은
   그리기만 한다.
2. `PlannerScreenV2` 가 패싯을 한 번 계산해 레일과 툴바 카운트가 공유한다.
3. 계획 2개 미만이면 레일을 렌더하지 않는다 (제목만 되풀이하며 가로폭만 먹는다).
   6개 미만이면 컨트롤 바를, 4개 미만이면 섹션 헤더를 숨긴다.
4. 검색 중에는 접힌 섹션도 강제로 펼친다 — 접힌 완료 섹션 안의 계획이 안 잡히면
   검색이 고장난 것으로 읽힌다.

### '멈춤' 배지를 함부로 달지 않은 이유

`PlanSummary.updated_at` 은 frontmatter `updated:` 인데, 이를 갱신하는 곳은
`set_plan_status` / `set_plan_title` 둘뿐이다. 항목 상태를 바꾸는 7개 `PlanEditOp`
도, `plan_ai_refresh` 도, MCP `plan_update` 도 건드리지 않는다 — 이름을 바꾼 적 없는
계획의 `updated_at` 은 사실상 생성일에 고정돼 있다.

그래서 '최근순'과 '멈춤' 판정의 근거를 plan-log 기반 `plan_recent_updates` 로 잡고,
활동 기록이 없으면 `staleDays = null` 로 둔다 — *오래됐다* 가 아니라 *모른다* 이며
UI 는 아무 주장도 하지 않는다. 화면에서 가장 눈에 띄는 자리에 거짓 경고를 두느니
침묵이 낫다. (`updated:` 미갱신 자체는 사용자 판단으로 다음 라운드로 분리.)

## 검증

- `pnpm test` 259/259 통과 (35 파일). 신규 `plan_list.test.ts` 27개 + `tools_v2` 의
  계획 레일 describe 6개(레일 렌더·검색 필터·접힌 완료 계획 검색·섹션 토글·
  거짓 멈춤 배지 없음·axe 무위반), 계획 1개일 때 레일 미렌더 1개.
- `pnpm typecheck` / `pnpm lint` / `pnpm build` 각각 exit 0.
- 구현 중 발견해 고친 자체 결함: 섹션 접힘을 '닫힌 key 목록'으로 두면 기본이 닫힘인
  섹션(완료·보관)을 여는 방법이 사라진다 — 토글 테스트가 실패로 잡아내, 명시적
  `plannerRailOpen` 오버라이드 맵으로 교체했다.