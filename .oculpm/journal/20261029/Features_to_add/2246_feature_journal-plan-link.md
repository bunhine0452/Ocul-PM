---
schema_version: 1
type: feature
slug: "journal-plan-link"
status: done
difficulty: verylow
created_at: "2026-10-29T22:46:58+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/oculpm/JournalDetail.tsx"
    op: update
  - path: "src/features/oculpm/journal.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/journal_verified.test.tsx"
    op: update
related: []
tags:
  - "nav"
  - "journal"
  - "ocul-next"
  - "mcp-tool"
---
[x] 일지 머리의 계획 줄을 그 계획 항목으로 건너가는 링크로

## 추가 기능

#nav-links(내용 안에서 건너가기)의 세 방향 가운데 두 방향은 이미 있었다.
- 변경 파일 → 그 일지: 변경 화면 바닥의 「일지 열기」
- 계획 항목 → 일지: 항목 줄의 「일지」

남은 「일지 → 계획」을 붙였다. 일지 상세 머리의 「계획 「…」 #항목」 글자가 그대로 링크가 되어, 누르면 그 계획의 그 항목으로 간다. 길은 팔레트가 쓰는 `NAV_BUS.openEntity` 의 `plan_item` 이다. 버튼 모양을 더하지 않고 글자에 밑줄만 옅게 그었다(화면 검사의 「버튼을 줄인다」).

## 검증

- `journal_verified.test.tsx` 의 머리 테스트에 링크를 누르면 `{ kind: "plan_item", id: "p#drop-app-llm" }` 가 나가는지 더했다.
- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 파일 79개 · 테스트 925개 통과, lint(디자인 게이트의 radius 토큰 포함) · build exit 0.