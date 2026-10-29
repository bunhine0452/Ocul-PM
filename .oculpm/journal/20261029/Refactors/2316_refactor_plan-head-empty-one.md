---
schema_version: 1
type: refactor
slug: "plan-head-empty-one"
status: done
difficulty: low
created_at: "2026-10-29T23:16:20+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/PlanDoc.tsx"
    op: update
  - path: "src/features/planner/planner.css"
    op: update
  - path: "src/components/EmptyState.tsx"
    op: update
  - path: "src/styles/empty.css"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/firstrun_honesty.test.tsx"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
related: []
tags:
  - "planner"
  - "design"
  - "ui-audit"
  - "mcp-tool"
---
[x] 계획 제목은 줄바꿈으로 끝까지 · 빈 화면 한 모양(왼쪽 · 문장 하나 · 버튼 하나)

## 동기

화면 검사(ui-audit-20261029) 「나머지 화면」의 #plan-head · #empty-one 이다. 끝난 단계 한 줄 접기는 이미 들어가 있었다(`plan_fold`).

## 변경 요약

- **계획 (#plan-head)**
  - 항목 제목과 「다음」 칸 제목이 줄을 바꿔 끝까지 보인다. 잘린 제목으로는 무엇을 실행하는지 몰랐다. 접힌 끝난 단계의 한 줄만 말줄임을 둔다.
  - 「다음」을 「다음 할 일」로 바꿨다. 내부 이름인 `#항목id` 는 줄에서 빼고 툴팁으로 옮겼다.
  - 여러 줄 제목에서 상태 상자가 첫 줄에 맞도록 baseline 으로 정렬했다.
- **빈 화면 (#empty-one)** — `EmptyState` 에서 아이콘 · 제목을 걷고 기본을 왼쪽 정렬로 바꿨다. 리치 빈 상태는 제목 「…없어요」와 설명으로 같은 말을 두 번 했다.
  - 계획: 「Claude Code 에 하고 싶은 일을 말하면 계획이 생겨요.」
  - 변경: 「커밋되지 않은 변경이 없어요.」 + 「최근 커밋」
  - 일지: 예전 기록이 있으면 「최근 14일에는 일지가 없어요.」 + 「이전 기록 더 보기」, 정말 처음이면 한 문장 + 「git 히스토리에서 가져오기」. 새 일지는 윗줄 단추가 늘 있다. 예전 기록 수를 아직 모르면(null) 처음 쓰는 쪽으로 본다.
  - 쓰는 곳이 없어진 `.es-ico` · `.es-title` CSS 를 걷었다.

## 검증

- `firstrun_honesty.test.tsx` 는 리치 빈 상태가 왼쪽이고 아이콘 · 제목 없이 문장 하나 · 버튼 하나인지 본다. `journal_v2.test.tsx` 는 새 문장과 단추로 바꿨다.
- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 938 passed(전체 두 번), lint · build exit 0.
- 전체 실행 한 번에서 `today_v4` 의 「모두 읽음」 테스트가 한 번 실패했다. 따로 세 번 · 전체 두 번은 통과했다. 이번 변경과 무관한 부하 속 흔들림으로 본다.