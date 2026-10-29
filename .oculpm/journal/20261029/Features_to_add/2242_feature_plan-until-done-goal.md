---
schema_version: 1
type: feature
slug: "plan-until-done-goal"
status: done
difficulty: medium
created_at: "2026-10-29T22:42:44+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/goal.ts"
    op: create
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/terminal/runPrompt.ts"
    op: update
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/plan_goal.test.ts"
    op: create
  - path: "src/__tests__/planner_v4.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "planner"
  - "terminal"
  - "ocul-next"
  - "mcp-tool"
---
[x] 계획의 「끝까지」를 Claude Code 의 /goal 로 — 완료 조건 · 확인 명령을 그대로

## 추가 기능

사용자가 고른 「「끝까지」를 /goal 로」를 만들었다. 지금까지 계획의 「끝까지」는 프롬프트 뒤에 「이어 가라」는 문장을 붙였다. Claude Code 의 `/goal <조건>` 은 조건이 참이 될 때까지 턴마다 따로 판정하므로, 계획 파일의 완료 조건과 확인 명령을 그대로 넘긴다.

- **조건** — `features/planner/goal.ts`. 문장은 `/goal 계획 .oculpm/planner/<id>.md 의 완료 조건 「…」 이 참이고, 확인 명령 `…` 이 통과한다` 꼴이다. 하나만 있으면 그 하나로 쓰고, 줄바꿈은 한 줄로 편다. 4000자(문서의 한도)를 넘으면 완료 조건부터 줄이고, 판정 근거인 확인 명령은 자르지 않는다. 둘 다 없으면 `null` 이고, 그때는 예전처럼 「이어 가라」는 문장을 붙인다.
- **넣는 법** — `claude "/goal …"` 처럼 시작 인자로 넘기는 슬래시 명령은 문서에 없어 쓰지 않았다. 대신 다음 순서로 간다.
  1. 새 세션에서 그냥 `claude` 를 띄운다. 백엔드의 `run_line("")` 이 빈 프롬프트면 `claude` 만 친다.
  2. 이번 라운드의 상태 신호가 「입력 대기」(OSC 7501 idle)로 오기를 기다린다(`termStore.waitForTermStatus`).
  3. 「Claude 에게 보내기」와 같은 붙여넣기 + Enter 로 넣는다.
- **신호가 안 오면** — 1분 안에 없으면(옛 Claude Code · 미설치) 그 문장을 클립보드에 두고 붙여 넣으라고 알린다.
- 버튼은 「끝까지 (/goal)」이고, 무엇을 하는지 title 로 말한다.

## 검증

- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 파일 79개 · 테스트 925개 통과, lint · build exit 0.
  - `plan_goal.test.ts` 는 조건 넷(둘 · 하나씩 · 없음)과 4000자 줄이기를 본다.
  - `planner_v4.test.tsx` 는 「끝까지」가 /goal 로 가고 프롬프트를 짜지 않는 것, 조건이 없으면 예전 문장으로 가는 것을 본다.
- `cargo test --lib terminal::` → 6 passed(빈 프롬프트는 그냥 claude).
- 실제 claude 가 붙여넣은 `/goal` 을 슬래시 명령으로 받는지는 설치본에서 봐야 한다(#eyes-installed).