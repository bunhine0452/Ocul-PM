---
schema_version: 1
type: feature
slug: "ui-receipt-philosophy"
status: done
difficulty: medium
created_at: "2026-11-04T01:03:23+09:00"
session_id: "mcp-20261104-010323"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "011dde9e-5e7e-4fbe-b351-fec86b11e9b0"
language: "ko"
verified_by_user: false
files_touched:
  - path: "DESIGN.md"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/components/VerdictLine.tsx"
    op: update
  - path: "src/components/verdictLine.css"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/TodayWork.tsx"
    op: update
  - path: "src/features/today/today.css"
    op: update
  - path: "src/features/oculpm/JournalRow.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/journal.css"
    op: update
  - path: "src/features/planner/PlanRail.tsx"
    op: update
  - path: "src/features/planner/PlanItems.tsx"
    op: update
  - path: "src/features/planner/planner.css"
    op: update
  - path: "src/features/diff/ChangeFileList.tsx"
    op: update
  - path: "src/features/diff/DiffNotes.tsx"
    op: update
  - path: "src/features/diff/changes.css"
    op: update
  - path: "src/features/start/StartWindow.tsx"
    op: update
  - path: "src/features/terminal/RacePanel.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/screens-overflow.css"
    op: update
  - path: "src/__tests__/design_tokens.test.ts"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
  - path: "src/__tests__/diff_v2.test.tsx"
    op: update
related: []
tags:
  - "디자인"
  - "ui-audit"
  - "design"
  - "mcp-tool"
---
[x] 디자인: 앱 전체에 영수증 철학을 넣는다

사용자 요청(11-04): 「UI 하나하나 다 완성도 있게 만들어줘 철학을 집어넣어」, 「절대로 구려보이거나 싸보이거나 ai스럽게 보이면 안돼」. 철학 셋(영수증 · 작업대 · 종이 노트) 중 사용자가 **영수증**을 골랐다.

## 추가 기능
- DESIGN.md 에 「App UI — 영수증」 절: 북극성(「다 됐습니다」 대신 영수증 — 조용하고 정확하며 틀린 한 줄만 눈에 띈다)과 여섯 규칙. 코드 주석이 「영수증 규칙 N」 으로 가리키니 번호를 지킨다.
  1 색은 예외에만 · 2 기계 글씨는 고정폭 · 3 채운 단추는 화면에 하나 · 4 같은 뜻은 같은 모양 · 5 접힌 것은 숫자로 · 6 움직임은 응답일 때만
- **결함 하나**: `.chip.outline` 이 Tailwind 의 `outline` 유틸리티(outline-style solid 1px, 색 ring/50)와 이름이 겹쳐 「열림 · 내 차례 · 일지에 있음 · 추천」 에 파란 링이 섰다. 계산값으로 확인(`outline: oklab(... / 0.5) solid 1px`) → `.chip.hairline`, 테스트가 `.chip.outline` 재등장을 막는다.
- 규칙 1: `.chip.ok` 는 투명 + 회색 mono ✓, `.tbadge` 종류 다섯 색 → 중립, 목록의 종류 색 점(일지 · 변경 · 오늘 한 일) → 메타 첫 낱말. 통과 표시의 초록 글자(변경 · 오늘 한 일 · 일지 ✓ · 단계 ✓)를 회색으로.
- 판정 줄(`VerdictLine`): 왼쪽 2px 색 선을 걷고, 통과는 회색 끝 줄, 실패 · 통과 뒤 바뀜만 표시 색 + 본문 잉크. `bare` 로 앞에 칩이 선 행은 표시를 생략.
- 오늘: 「먼저 볼 것」 모든 행이 상태 칩에서 시작(판정 실패도 「실패」 칩), subgrid 로 칩 · 내용 · 동작 세 칸이 같은 선. 「검증 없이 끝난 일지」 도 같은 방식이라 영어 `yesterday 19:39` 가 두 줄로 꺾이던 것이 풀렸다. 단축키 줄은 왼쪽 칸 끝.
- 계획: 레일 · 단계 머리의 진행 막대 제거(숫자만). 「새 일지」 는 보통 단추. 변경: 폴더 · 이름 이중 말줄임(`.chg-base` 는 줄지 않음), `· ! 검증 없음` 의 느낌표. 줄 메모 3px 상태 줄 · 일지 인용 3px 줄 → 1px/없음.

## 검증
하네스(mockIPC + 실제 일지 59건)로 다섯 화면 · 설정 · 시작 창 · ⌘K · 프로젝트 목록 · 새 일지 대화창을 밝게 · 어둡게 · 620px · 영어로 찍어 봤다.
```
impeccable detect --json <바꾼 CSS·TSX> → []
pnpm test → Tests 1049 passed (1049)
pnpm typecheck / pnpm lint / pnpm build → exit 0
```
PR #163.