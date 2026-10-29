---
schema_version: 1
type: refactor
slug: "v4-simpler-today-one-column"
status: done
difficulty: medium
created_at: "2026-10-29T11:03:27+09:00"
session_id: "20261029-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "1988da80-1607-4657-878d-b0a97d938c26"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/TodaySide.tsx"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/todayModel.ts"
    op: update
  - path: "src/features/planner/PlanItems.tsx"
    op: update
  - path: "src/features/settings/AgentsSection.tsx"
    op: update
  - path: "src/features/shell/useNavBadges.ts"
    op: update
  - path: "src/__tests__/plan_fold.test.tsx"
    op: create
related:
  - ref: "20261029/Refactors/1021_refactor_v4-topbar-instead-of-sidebar.md"
    kind: "followup"
tags:
  - "v4"
  - "ui"
  - "simplify"
  - "today"
  - "planner"
  - "mcp-tool"
---
[x] 더 단순하게 — 오늘은 한 칼럼, 끝난 계획 단계는 한 줄, 할 일 없는 설정 행과 예외 아닌 수를 걷는다

## 동기

사용자 요청: 「더욱 심플하게 만들 순 없나」. 윗줄 개편이 #116 으로 main 에 들어간 뒤(85f089b7), 같은 하네스(실제 일지 48건 · 계획 4개)로 화면을 다시 봤다. 남은 복잡함은 세 가지였다.

- 같은 것을 두 번 보여 주는 자리
- 늘 떠 있는 설명 문장
- 할 일이 없는 행

기능은 빼지 않았다.

## 변경 요약

- **오늘**
  - 오른쪽 칼럼을 걷고 한 칼럼으로 만들었다.
  - 「계획」 카드를 걷었다. 계획 탭과 같은 내용이고, 실패한 판정과 사람 몫은 이미 「확인할 것」에 선다.
  - 「다음」은 한 줄과 「프롬프트 복사」 버튼 하나만 남겼다.
  - 요약 줄은 날짜와 기록 수만 남겼다. 증거 수를 두 곳에서 다른 기준으로 세어 32 와 41 이 한 화면에 섰기 때문이다.
  - 일지 행의 버튼은 「확인함」 하나로 줄였다. 일지 열기는 제목 클릭으로 옮겼다.
- **윗줄.** 탭 옆의 수는 예외만 남겼다. 작업 일지의 「오늘 기록 수」와 그 수를 세던 조회 하나를 걷었다.
- **계획.**
  - 끝난 단계는 「engine 4/4 ✓」 한 줄로 접어 남은 단계 아래에 모았다. 누르면 펼쳐진다.
  - 판정 상자 아래의 설명 문장을 걷었다.
- **설정.** 할 일이 없는 행은 세우지 않는다.
  - Codex 가 없는 기기의 Codex 행
  - Windows 밖의 「MCP 직접 등록」. 이미 등록해 둔 경우에는 풀 수 있게 행이 선다.
  - Cursor·Gemini 안내 행
- **문서.** 걷힌 문구 키 21개를 ko/en 사전에서 지웠다. CHANGELOG 와 위키 「오늘」 ko/en 을 새 화면에 맞췄다.
- **하네스 버그(앱 아님).** 하네스가 「다음」 항목으로 진행 중 항목을 먼저 골라 계획 화면과 어긋나 보였다. 백엔드 `digest.rs` 와 `nextLeaf` 는 같은 규칙(사람 몫이 아닌 첫 `[ ]`)이므로 하네스만 고쳤다.

## 검증

- `pnpm typecheck` exit 0
- `pnpm test` → `Test Files 74 passed (74) · Tests 886 passed (886)`. 새 테스트 셋 포함:
  - `plan_fold` 2건
  - MCP 행이 Windows 밖에서 없음 1건
- `pnpm lint` 6 게이트 ✓ · `pnpm build` ✓
- 하네스로 1360px 오늘 · 계획 · 설정 화면을 다시 찍어 봤다. 설정이 한 화면에 들어온다.