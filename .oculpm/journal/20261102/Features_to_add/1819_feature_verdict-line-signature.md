---
schema_version: 1
type: feature
slug: "verdict-line-signature"
status: done
difficulty: medium
created_at: "2026-11-02T18:19:08+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/VerdictLine.tsx"
    op: create
  - path: "src/components/verdictLine.css"
    op: create
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/planner/PlanDoc.tsx"
    op: update
  - path: "src/features/planner/PlanRail.tsx"
    op: update
  - path: "src/features/planner/planner.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/planner_v4.test.tsx"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
related: []
tags:
  - "디자인"
  - "design"
  - "today"
  - "planner"
  - "mcp-tool"
---
[x] 디자인: 확인 명령 결과를 판정 줄 하나로

## 추가 기능
Ocul 의 시그니처로 「판정 줄」을 만들었다. 사용자가 세 안(판정 줄 · 검사 도장 · 영수증 띠) 가운데 골랐다. 확인 명령의 결과가 앱 어디서나 한 모양으로 선다.
- 모양은 왼쪽 2px 결과 선 · ✓/✗ · 명령이 찍은 끝 줄 그대로(mono) · 오른쪽 시각, 그리고 아래 한 줄(명령 · 계획 · 바뀐 파일)이다.
- 색은 통과 초록, 실패 빨강, 통과 뒤 바뀜 호박이다. 통과 뒤 바뀜은 미리보기의 ↻ 대신 호박색 ✓ 로 했다. 기록된 판정이 실제로 ✓ 이기 때문이다.
- 적용한 자리: 오늘 「먼저 볼 것」의 판정 실패 · 통과 뒤 바뀜 행(딱지 대신), 계획 화면 마지막 판정 칸(「✗ 실패」 칩 + meta + summary 세 덩이 대신), 계획 목록 레일(「판정 ✓ · 시각」 대신 끝 줄까지 보이는 한 줄).

## 동작 흐름
- `components/VerdictLine.tsx` + `verdictLine.css`
  - grid 4칸이다. 선은 테두리가 아니라 칸이다. 그래서 아래 줄이 있으면(`has-sub`) 두 줄을 같이 잡는다. 암시적 줄은 `1 / -1` 에 들지 않아서 `span 2` 로 잡는다.
  - 화면 읽기 프로그램에는 상태 말(「확인 명령 실패:」)을 숨김 글로 먼저 읽힌다.
- 용어집을 따랐다. 화면 글에 「판정」을 새로 쓰지 않았다(sr 말은 「확인 명령 통과/실패」).
- 걷은 것: planner.css 의 `.plv-ok` · `.plv-bad` · `.plv-judge-chip` · `.plv-judge-summary`(쓰는 곳 0).

## 검증
- Vite+CDP 하네스로 실제 컴포넌트(TodayExceptions · PlanRail · VerdictLine · TermFindBar)를 밝게/어둡게 찍었다. 오류 0. 첫 장에서 선이 첫 줄만 잡는 것을 보고 고쳐 다시 찍었다.
- impeccable detect: 위반 0. `pnpm lint`(디자인 규율의 radius 리터럴 1건을 `--radius-pill` 로 고침) 0.
- `pnpm test`: 1000 passed ×2. planner_v4 · today_v4 의 칩 기대를 판정 줄 기대로 바꿨다. typecheck · build 0. Rust 변경은 없다.