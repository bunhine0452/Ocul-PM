---
schema_version: 1
type: bug
slug: "planner-phase-grid-width"
status: done
difficulty: low
created_at: "2026-10-30T16:14:51+09:00"
session_id: "20261030-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/planner.css"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
related:
  - ref: "20261007/Bugs/1010_bug_automation-device-consent.md"
    kind: "followup"
tags:
  - "계획"
  - "layout"
  - "container-query"
  - "mcp-tool"
---
[x] 계획: 남은 단계가 반쪽 칸에서 꺾이던 것

## 발생 원인

사용자가 「다른 버그도 찾아 고쳐 달라」고 했다. 하네스로 900px 창을 찍다가 찾았다. 계획 화면에서 남은 단계 하나가 두 칸 격자의 왼쪽 반에만 섰고, 항목 글이 247px 에서 꺾였다. 오른쪽 반은 비어 있었다.

- 계획 컨테이너가 레일(260px)까지 품은 `.plv-body` 였다. 그래서 「640 이하면 한 칸」 질의가 960px 창에서도 걸리지 않았다. 글자 125%(웹뷰 줌, 768px) 에서는 단계가 약 215px 두 칸이 된다.
- `@container plan` 안에서 `.plv-body` 자신의 `flex-direction` 을 바꾸던 규칙은 한 번도 적용되지 않았다. 컨테이너 질의는 자기 자신에게 걸리지 않는다. 최소 창 폭(960) 때문에 닿지도 않는다.

## 해결 방법

- 컨테이너를 문서 칸 `.plv-main` 으로 옮겼다. 접힘 선은 셸 규칙(640/460 한 벌)대로 640 을 그대로 썼다. `AppDialog` 는 `.plv-body` 밖에 있어서 `position: fixed` 기준이 바뀌는 영향이 없다.
- 남은 단계가 하나면 `.plv-phase:only-of-type { grid-column: 1 / -1 }` 로 전체 폭을 쓴다.
- 닿지 않던 자기 질의 블록은 걷었다.
- 덤: 오늘 화면 `runPrimary` 의 의존성 배열에 `projectId` 를 넣었다. lint 경고였고, 창이 `key={projectId}` 로 다시 그려져 실제 오동작은 없었다.

## 검증

- 하네스 재측정:
  - 960x700: `.plv-phases` 가 `634px` 한 칸이 되고, 항목 글 폭은 447px 이다.
  - 1440x800: 단계 하나가 전체 폭이라 항목이 모두 한 줄이다(스크린숏 확인).
- `pnpm typecheck` 0 · `pnpm test` 948 passed · `pnpm lint` 0(경고 3 → 2) · `pnpm build` 0