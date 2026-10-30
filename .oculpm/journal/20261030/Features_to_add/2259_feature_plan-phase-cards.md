---
schema_version: 1
type: feature
slug: "plan-phase-cards"
status: done
difficulty: low
created_at: "2026-10-30T22:59:25+09:00"
session_id: "20261030-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/PlanItems.tsx"
    op: update
  - path: "src/features/planner/planner.css"
    op: update
related: []
tags:
  - "계획"
  - "design"
  - "layout"
  - "mcp-tool"
---
[x] 계획: 단계마다 카드로 경계를 세운다

## 추가 기능

사용자 요청(10-30, 스크린숏 첨부): 「계획 화면의 디자인을 더욱 업그레이드해 줘. 경계가 잘 안 보여」(계획 `narrow-window-20261030` #plan-bounds).

스크린숏에서 보인 문제:
- 단계 셋이 테두리 없이 두 칸으로 서서, 어디까지가 한 단계인지 안 보였다.
- 항목 사이에 구분이 없었다.
- 가리킨 항목의 「보내기」가 두 칸 사이 가운데에 떠서, 어느 항목의 것인지 몰랐다.

## 동작 흐름

- **카드:** `.plv-phase` 를 카드로 바꿨다(`--border-card` · `--radius-m` · `--shadow-card`).
- **머리 띠**(`--bg-window`): 단계 이름(말줄임) · `n/m` · 진행 막대(`.plv-bar` 를 다시 씀) 순으로 선다.
- **항목:** 줄마다 위에 구분선을 긋고, 가리키면 `--bg-hover` 바탕이다. 「보내기」는 카드 안 그 줄의 오른쪽 끝에 선다.
- **들여쓰기:** 인라인 `paddingLeft` 를 CSS 변수 `--plv-depth` 로 바꿨다. 카드 안 여백과 겹치지 않는다.

## 검증

- 하네스(밝은 ko 1440): 카드 셋, 머리 띠의 진행 막대, 항목 구분선을 스크린숏으로 확인했다.
- `plan_fold.test.tsx` 는 그대로 통과한다(단계 aria-label · 접힌 끝난 단계).
- `node scripts/check-design-discipline.mjs` → clean
- 전체:
  - `pnpm typecheck` 0 · `pnpm test` 972 passed · `pnpm lint` 0 · `pnpm build` 0
  - rust passed 1166 failed 0